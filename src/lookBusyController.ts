import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { CharStatus, normalizeTypedText, SessionState, type CharStatusValue } from './sessionState';
import { getWorkspaceSource, type SourceContent } from './sources';
import { readSettings, type LookBusySettings } from './settings';
import { calculateStats, getSnarkyComment } from './stats';
import {
	buildMaskedTargetText,
	commonPrefixLength,
	computeTextWindow,
	type TextWindow,
} from './textWindow';

interface BusySession {
	uri: vscode.Uri;
	document: vscode.TextDocument;
	editor: vscode.TextEditor;
	state: SessionState;
	renderedText: string;
	tempFilePath: string;
}

type SessionExitReason = 'completed' | 'panic' | 'documentClosed' | 'restarted' | 'disposed';

const MIN_ELAPSED_MS = 1500;
const STALE_TEMP_FILE_MS = 12 * 60 * 60 * 1000;
const SAVE_DEBOUNCE_MS = 400;
const SUGGEST_HIDE_THROTTLE_MS = 600;
const ACTIVE_CONTEXT_KEY = 'lookBusy.active';

const IME_COMPOSITION_COMMAND_IDS = [
	'compositionStart',
	'compositionType',
	'compositionEnd',
	'replacePreviousChar',
] as const;

export class LookBusyController implements vscode.Disposable {
	private readonly untypedDecoration: vscode.TextEditorDecorationType;
	private readonly wrongDecoration: vscode.TextEditorDecorationType;
	private readonly emptyLineHintDecoration: vscode.TextEditorDecorationType;
	private readonly eolHintDecoration: vscode.TextEditorDecorationType;
	private readonly sessionStatusBarItem: vscode.StatusBarItem;
	private readonly sessionActiveEmitter = new vscode.EventEmitter<boolean>();
	private readonly disposables: vscode.Disposable[] = [];
	private session: BusySession | undefined;
	private compositionDisposables: vscode.Disposable[] = [];
	private isUpdatingSelection = false;
	private isRevertingDocumentChange = false;
	private isApplyingSessionText = false;
	private isDisposed = false;
	private isStarting = false;
	private hasWarnedAboutIme = false;
	private activeContextValue = false;
	private lastSuggestHideAt = 0;
	private saveTimer: NodeJS.Timeout | undefined;
	private taskQueue: Promise<void> = Promise.resolve();
	private settings: LookBusySettings = readSettings();
	public readonly onDidChangeSessionActive = this.sessionActiveEmitter.event;

	public get hasSession(): boolean {
		return this.session !== undefined;
	}

	/** Lets the host observe configuration changes without re-reading on every keystroke. */
	public refreshSettings(): void {
		this.settings = readSettings();
	}

	public constructor() {
		this.untypedDecoration = vscode.window.createTextEditorDecorationType({
			color: new vscode.ThemeColor('editorGhostText.foreground'),
		});

		this.wrongDecoration = vscode.window.createTextEditorDecorationType({
			color: new vscode.ThemeColor('editorError.foreground'),
			textDecoration: 'underline',
		});

		this.emptyLineHintDecoration = vscode.window.createTextEditorDecorationType({
			after: {
				contentText: '  \u23ce Press Enter',
				color: new vscode.ThemeColor('editorGhostText.foreground'),
				fontStyle: 'italic',
			},
		});

		this.eolHintDecoration = vscode.window.createTextEditorDecorationType({
			after: {
				contentText: ' \u23ce',
				color: new vscode.ThemeColor('editorGhostText.foreground'),
			},
		});

		this.sessionStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 101);
		this.sessionStatusBarItem.tooltip = 'Look Busy active session (Click or Escape to panic)';
		this.sessionStatusBarItem.command = 'look-busy.panic';

		this.disposables.push(
			this.untypedDecoration,
			this.wrongDecoration,
			this.emptyLineHintDecoration,
			this.eolHintDecoration,
			this.sessionStatusBarItem,
			this.sessionActiveEmitter,
			vscode.window.onDidChangeTextEditorSelection((event) => {
				const session = this.session;
				if (!session || this.isUpdatingSelection) {
					return;
				}

				if (event.textEditor.document.uri.toString() !== session.uri.toString()) {
					return;
				}

				this.applyCursor(session);
			}),
			vscode.window.onDidChangeActiveTextEditor(() => {
				this.syncEditorScopedState();
			}),
			vscode.workspace.onDidCloseTextDocument((document) => {
				const session = this.session;
				if (!session || document.uri.toString() !== session.uri.toString()) {
					return;
				}

				this.runSafely(this.enqueue(() => this.finalizeSession('documentClosed', false)));
			}),
			vscode.window.tabGroups.onDidChangeTabs(() => {
				const session = this.session;
				if (!session || this.hasOpenTabForUri(session.uri)) {
					return;
				}

				this.runSafely(this.enqueue(() => this.finalizeSession('documentClosed', false)));
			}),
			vscode.workspace.onDidChangeTextDocument((event) => {
				const session = this.session;
				if (
					!session ||
					this.isRevertingDocumentChange ||
					this.isApplyingSessionText
				) {
					return;
				}

				if (event.document.uri.toString() !== session.uri.toString()) {
					return;
				}

				if (event.contentChanges.length === 0) {
					return;
				}

				this.runSafely(this.enqueue(() => this.revertUnexpectedDocumentChange(session)));
			})
		);
	}

	public async start(): Promise<void> {
		if (this.isDisposed || this.isStarting) {
			return;
		}

		this.isStarting = true;

		try {
			if (this.session) {
				await this.enqueue(() => this.finalizeSession('restarted', true));
			}

			await this.pruneStaleTempFiles();

			const { source } = this.settings;
			let cancelled = false;

			const resolved = await vscode.window.withProgress(
				{
					location: vscode.ProgressLocation.Notification,
					title: 'Look Busy: scanning workspace',
					cancellable: true,
				},
				async (_progress, token) => {
					token.onCancellationRequested(() => {
						cancelled = true;
					});

					const found = await getWorkspaceSource({
						token,
						preferWorkspace: source !== 'builtin',
						requireWorkspace: source === 'workspace',
					});

					return cancelled ? undefined : found;
				}
			);

			if (!resolved || this.isDisposed) {
				return;
			}

			await this.enqueue(() => this.beginSession(resolved));
		} catch (error) {
			reportFailure('start a Look Busy session', error);
		} finally {
			this.isStarting = false;
		}
	}

	public async routeType(text: string): Promise<void> {
		if (this.shouldHandleSessionInput()) {
			await this.enqueue(() => this.consumeInput(text));
			return;
		}

		await vscode.commands.executeCommand('default:type', { text });
	}

	public async injectText(text: string): Promise<void> {
		if (this.shouldHandleSessionInput()) {
			await this.enqueue(() => this.consumeInput(text));
			return;
		}

		if (text.length > 0) {
			await vscode.commands.executeCommand('default:type', { text });
		}
	}

	public async blockEdit(action?: string): Promise<void> {
		if (!this.shouldHandleSessionInput()) {
			return;
		}

		if (action === 'backspace') {
			await this.enqueue(() => this.handleBackspace());
			return;
		}

		await this.hideSuggestions(true);
	}

	public async panic(): Promise<void> {
		await this.enqueue(() => this.finalizeSession('panic', true));
	}

	public dispose(): void {
		this.isDisposed = true;
		this.clearPendingSave();
		// finalizeSession clears session state synchronously before its first await,
		// so decorations and the status bar item are still alive at that point.
		this.runSafely(this.finalizeSession('disposed', false));
		for (const disposable of this.disposables) {
			disposable.dispose();
		}
	}

	private async beginSession(source: SourceContent): Promise<void> {
		const state = new SessionState(source.text, source.typingStart, source.typingEnd);
		const initialWindow = computeTextWindow(
			state.target,
			state.lineStarts,
			state.index,
			this.settings.ghostLinesAhead
		);

		const { uri, tempFilePath } = await this.createTempDocument(
			source,
			buildMaskedTargetText(state.target, initialWindow.end)
		);

		try {
			let document = await vscode.workspace.openTextDocument(uri);
			if (document.languageId !== source.languageId) {
				document = await vscode.languages.setTextDocumentLanguage(document, source.languageId);
			}

			const editor = await vscode.window.showTextDocument(document, {
				preview: false,
				preserveFocus: false,
				viewColumn: vscode.ViewColumn.Active,
			});

			this.session = {
				uri: document.uri,
				document,
				editor,
				state,
				renderedText: buildMaskedTargetText(state.target, initialWindow.end),
				tempFilePath,
			};

			this.hasWarnedAboutIme = false;
			this.syncEditorScopedState();
			this.applyDecorations(this.session);
			this.applyCursor(this.session);
			await this.hideSuggestions(true);

			this.sessionStatusBarItem.text = '$(pulse) Looking Busy: Ready';
			this.sessionStatusBarItem.show();

			if (!this.isDisposed) {
				this.sessionActiveEmitter.fire(true);
			}
		} catch (error) {
			await this.cleanupFailedSessionStart(uri, tempFilePath);
			reportFailure('open the Look Busy session document', error);
			void vscode.window.showErrorMessage(
				'Look Busy could not open a session document. Check the Look Busy output for details.'
			);
		}
	}

	private async cleanupFailedSessionStart(uri: vscode.Uri, tempFilePath: string): Promise<void> {
		if (this.session?.uri.toString() === uri.toString()) {
			this.clearSessionDecorations(this.session);
			this.session = undefined;
		}

		await this.closeEditorForUri(uri).catch(() => undefined);
		await fs.unlink(tempFilePath).catch(() => undefined);
	}

	private shouldHandleSessionInput(): boolean {
		const session = this.session;
		if (!session) {
			return false;
		}

		const activeEditor = vscode.window.activeTextEditor;
		if (!activeEditor) {
			return false;
		}

		return activeEditor.document.uri.toString() === session.uri.toString();
	}

	/**
	 * Keeps editor-scoped state in step with which editor has focus.
	 *
	 * The `lookBusy.active` context key gates the contributed keybindings, so it
	 * must only be true while the session document has focus. Leaving it true
	 * would bind Escape, Enter, Backspace, paste, cut, undo and redo to Look Busy
	 * handlers in every other editor, silently swallowing those keys.
	 */
	private syncEditorScopedState(): void {
		const focused = this.shouldHandleSessionInput();
		void this.setActiveContext(focused);

		if (focused) {
			this.registerCompositionHandlers();
		} else {
			this.disposeCompositionHandlers();
		}
	}

	private async setActiveContext(value: boolean): Promise<void> {
		if (this.activeContextValue === value) {
			return;
		}

		this.activeContextValue = value;
		await vscode.commands
			.executeCommand('setContext', ACTIVE_CONTEXT_KEY, value)
			.then(undefined, () => undefined);
	}

	/**
	 * IME composition bypasses the `type` command entirely, so without these
	 * handlers a composed character would write straight into the session
	 * document and then be reverted by the change listener. They are registered
	 * only while the session editor has focus, so input methods keep working
	 * normally everywhere else.
	 */
	private registerCompositionHandlers(): void {
		if (this.compositionDisposables.length > 0) {
			return;
		}

		this.compositionDisposables = IME_COMPOSITION_COMMAND_IDS.map((commandId) =>
			vscode.commands.registerCommand(commandId, (args: unknown) => {
				this.handleCompositionInput(extractCompositionText(args));
			})
		);
	}

	private disposeCompositionHandlers(): void {
		for (const disposable of this.compositionDisposables) {
			disposable.dispose();
		}

		this.compositionDisposables = [];
	}

	private handleCompositionInput(text: string): void {
		if (text.length === 0 || !this.shouldHandleSessionInput()) {
			return;
		}

		if (!this.hasWarnedAboutIme) {
			this.hasWarnedAboutIme = true;
			void vscode.window.showInformationMessage(
				'Look Busy: input method composition is matched against the target text, so accuracy may drop.'
			);
		}

		this.runSafely(this.enqueue(() => this.consumeInput(text)));
	}

	private async consumeInput(text: string): Promise<void> {
		const session = this.session;
		if (!session || text.length === 0) {
			return;
		}

		const normalizedText = normalizeTypedText(text);
		await this.hideSuggestions(/[\n\t]/.test(normalizedText));
		if (this.session !== session) {
			return;
		}

		session.state.consume(normalizedText);

		await this.synchronizeSessionDocument(session);
		if (this.session !== session) {
			return;
		}

		this.applyDecorations(session);
		this.applyCursor(session);
		this.updateLiveStatusBar(session);

		if (session.state.isComplete) {
			await this.finalizeSession('completed', true);
		}
	}

	private async handleBackspace(): Promise<void> {
		const session = this.session;
		if (!session) {
			return;
		}

		session.state.backspace();

		await this.synchronizeSessionDocument(session);
		if (this.session !== session) {
			return;
		}

		this.applyDecorations(session);
		this.applyCursor(session);
		await this.hideSuggestions(true);
		this.updateLiveStatusBar(session);
	}

	private updateLiveStatusBar(session: BusySession): void {
		const { state } = session;

		if (!state.hasTypedAnything || !state.hasRecordedKeystrokes) {
			this.sessionStatusBarItem.text = '$(pulse) Looking Busy: Ready';
			return;
		}

		const stats = calculateStats(state.typedCharacters, state.activeElapsedMs, {
			totalKeystrokes: state.totalKeystrokes,
			errors: state.errorKeystrokes,
			backspaces: state.backspaceCount,
			minElapsedMs: MIN_ELAPSED_MS,
		});

		this.sessionStatusBarItem.text = `$(pulse) Looking Busy: ${stats.wpm.toFixed(0)} WPM (${stats.accuracy}%)`;
	}

	private applyDecorations(session: BusySession): void {
		const window = this.getSessionWindow(session);
		session.editor.setDecorations(
			this.untypedDecoration,
			this.collectRangesForStatus(session, CharStatus.Untyped, window)
		);
		session.editor.setDecorations(
			this.wrongDecoration,
			this.collectRangesForStatus(session, CharStatus.Error, window)
		);

		const emptyLineHints: vscode.Range[] = [];
		const eolHints: vscode.Range[] = [];
		const { state } = session;

		if (state.index < state.typingEnd && state.target[state.index] === '\n') {
			const position = session.document.positionAt(state.index);
			const lineStart = state.target.lastIndexOf('\n', state.index - 1) + 1;
			const lineContentBefore = state.target.slice(lineStart, state.index);

			if (lineContentBefore.trim().length === 0) {
				emptyLineHints.push(new vscode.Range(position, position));
			} else {
				eolHints.push(new vscode.Range(position, position));
			}
		}

		session.editor.setDecorations(this.emptyLineHintDecoration, emptyLineHints);
		session.editor.setDecorations(this.eolHintDecoration, eolHints);
	}

	private collectRangesForStatus(
		session: BusySession,
		status: CharStatusValue,
		window: TextWindow
	): vscode.Range[] {
		const ranges: vscode.Range[] = [];
		const { state } = session;
		let startIndex = -1;

		for (let i = window.start; i < window.end; i += 1) {
			const matches = state.statusAt(i) === status;

			if (matches && startIndex === -1) {
				startIndex = i;
			}

			if (!matches && startIndex !== -1) {
				ranges.push(
					new vscode.Range(
						session.document.positionAt(startIndex),
						session.document.positionAt(i)
					)
				);
				startIndex = -1;
			}
		}

		if (startIndex !== -1) {
			ranges.push(
				new vscode.Range(
					session.document.positionAt(startIndex),
					session.document.positionAt(window.end)
				)
			);
		}

		return ranges;
	}

	private applyCursor(session: BusySession): void {
		const position = session.document.positionAt(session.state.index);
		const selection = new vscode.Selection(position, position);

		this.isUpdatingSelection = true;
		session.editor.selection = selection;
		session.editor.revealRange(
			new vscode.Range(position, position),
			vscode.TextEditorRevealType.InCenterIfOutsideViewport
		);
		this.isUpdatingSelection = false;
	}

	private getSessionWindow(session: BusySession): TextWindow {
		return computeTextWindow(
			session.state.target,
			session.state.lineStarts,
			session.state.index,
			this.settings.ghostLinesAhead
		);
	}

	private clearSessionDecorations(session: BusySession): void {
		session.editor.setDecorations(this.untypedDecoration, []);
		session.editor.setDecorations(this.wrongDecoration, []);
		session.editor.setDecorations(this.emptyLineHintDecoration, []);
		session.editor.setDecorations(this.eolHintDecoration, []);
	}

	private async finalizeSession(reason: SessionExitReason, closeEditor: boolean): Promise<void> {
		const session = this.session;
		this.session = undefined;

		this.disposeCompositionHandlers();
		this.clearPendingSave();

		if (session) {
			this.clearSessionDecorations(session);
		}

		this.sessionStatusBarItem.hide();
		void this.setActiveContext(false);

		if (!this.isDisposed) {
			this.sessionActiveEmitter.fire(false);
		}

		if (!session) {
			return;
		}

		if (closeEditor) {
			try {
				await this.closeSessionEditorWithoutSavePrompt(session);
			} catch (error) {
				reportFailure('close the Look Busy session document', error);
			}
		}

		await fs.unlink(session.tempFilePath).catch(() => undefined);

		if (reason !== 'disposed' && !this.isDisposed) {
			this.showSessionExitStats(session, reason);
		}
	}

	private async closeEditorForUri(uri: vscode.Uri): Promise<void> {
		const uriText = uri.toString();
		const toClose: vscode.Tab[] = [];

		for (const group of vscode.window.tabGroups.all) {
			for (const tab of group.tabs) {
				const input = tab.input;
				if (input instanceof vscode.TabInputText && input.uri.toString() === uriText) {
					toClose.push(tab);
				}
			}
		}

		if (toClose.length > 0) {
			await vscode.window.tabGroups.close(toClose, true);
			return;
		}

		const active = vscode.window.activeTextEditor;
		if (active?.document.uri.toString() === uriText) {
			await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
		}
	}

	private hasOpenTabForUri(uri: vscode.Uri): boolean {
		const uriText = uri.toString();
		for (const group of vscode.window.tabGroups.all) {
			for (const tab of group.tabs) {
				const input = tab.input;
				if (input instanceof vscode.TabInputText && input.uri.toString() === uriText) {
					return true;
				}
			}
		}

		return false;
	}

	private async closeSessionEditorWithoutSavePrompt(session: BusySession): Promise<void> {
		this.clearPendingSave();
		const saved = await session.document.save();
		if (saved) {
			await this.closeEditorForUri(session.uri);
			return;
		}

		await vscode.window.showTextDocument(session.document, {
			preview: false,
			preserveFocus: false,
			viewColumn: session.editor.viewColumn,
		});
		await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
	}

	private async createTempDocument(
		source: SourceContent,
		initialText: string
	): Promise<{ uri: vscode.Uri; tempFilePath: string }> {
		const tempDir = path.join(os.tmpdir(), 'look-busy');
		await fs.mkdir(tempDir, { recursive: true });

		const nonce = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
		const extension = source.extension.startsWith('.') ? source.extension : '.txt';
		const tempFilePath = path.join(tempDir, `look-busy-${nonce}${extension}`);

		await fs.writeFile(tempFilePath, initialText, 'utf8');

		return {
			uri: vscode.Uri.file(tempFilePath),
			tempFilePath,
		};
	}

	private async pruneStaleTempFiles(): Promise<void> {
		const tempDir = path.join(os.tmpdir(), 'look-busy');
		await fs.mkdir(tempDir, { recursive: true });

		const entries = await fs.readdir(tempDir, { withFileTypes: true });
		const now = Date.now();

		const cleanupTasks = entries
			.filter((entry) => entry.isFile() && entry.name.startsWith('look-busy-'))
			.map((entry) => {
				const tempFilePath = path.join(tempDir, entry.name);
				return fs
					.stat(tempFilePath)
					.then((stats) =>
						now - stats.mtimeMs < STALE_TEMP_FILE_MS ? undefined : fs.unlink(tempFilePath)
					)
					.then(undefined, () => undefined);
			});

		await Promise.all(cleanupTasks);
	}

	/**
	 * Hiding the suggest widget costs two command round trips, so it is throttled
	 * for ordinary characters and only forced for input that could accept a
	 * suggestion (newline, tab) or that follows an edit.
	 */
	private async hideSuggestions(force: boolean): Promise<void> {
		const now = Date.now();
		if (!force && now - this.lastSuggestHideAt < SUGGEST_HIDE_THROTTLE_MS) {
			return;
		}

		this.lastSuggestHideAt = now;
		await vscode.commands.executeCommand('hideSuggestWidget').then(undefined, () => undefined);
		await vscode.commands
			.executeCommand('editor.action.inlineSuggest.hide')
			.then(undefined, () => undefined);
	}

	/**
	 * Keeps the session document in step with the state machine.
	 *
	 * The rendered text is always a prefix of the target, so only the tail after
	 * the common prefix is replaced. Advancing a line appends one line instead of
	 * rewriting the whole document, which keeps re-tokenisation and the range
	 * bookkeeping proportional to what actually changed.
	 */
	private async synchronizeSessionDocument(session: BusySession): Promise<void> {
		const window = this.getSessionWindow(session);
		const nextRenderedText = buildMaskedTargetText(session.state.target, window.end);
		if (nextRenderedText === session.renderedText) {
			return;
		}

		const edit = new vscode.WorkspaceEdit();
		const changedFrom = commonPrefixLength(session.renderedText, nextRenderedText);
		edit.replace(
			session.uri,
			new vscode.Range(
				session.document.positionAt(changedFrom),
				getDocumentEndPosition(session.document)
			),
			nextRenderedText.slice(changedFrom)
		);

		this.isApplyingSessionText = true;
		try {
			const applied = await vscode.workspace.applyEdit(edit);
			if (!applied) {
				throw new Error('Failed to apply the Look Busy session text update.');
			}

			session.renderedText = nextRenderedText;
			this.queuePendingSave(session);
		} finally {
			this.isApplyingSessionText = false;
		}
	}

	private queuePendingSave(session: BusySession): void {
		if (this.saveTimer || this.isDisposed) {
			return;
		}

		this.saveTimer = setTimeout(() => {
			this.saveTimer = undefined;
			this.runSafely(this.flushPendingSave(session));
		}, SAVE_DEBOUNCE_MS);
	}

	private async flushPendingSave(session: BusySession): Promise<void> {
		this.clearPendingSave();
		if (this.isDisposed) {
			return;
		}

		if (!session.document.isDirty) {
			return;
		}

		await session.document.save().then(undefined, () => undefined);
	}

	private clearPendingSave(): void {
		if (this.saveTimer) {
			clearTimeout(this.saveTimer);
			this.saveTimer = undefined;
		}
	}

	private async revertUnexpectedDocumentChange(session: BusySession): Promise<void> {
		this.isRevertingDocumentChange = true;
		try {
			// Force a full replacement: the document no longer matches what we rendered.
			session.renderedText = '';
			await this.hideSuggestions(true);
			await this.synchronizeSessionDocument(session);
			if (this.session !== session) {
				return;
			}

			this.applyDecorations(session);
			this.applyCursor(session);
		} finally {
			this.isRevertingDocumentChange = false;
		}
	}

	/**
	 * Serialises every state mutation. Two overlapping keystroke handlers could
	 * otherwise interleave around the awaits in `synchronizeSessionDocument` and
	 * apply edits out of order.
	 */
	private enqueue(task: () => Promise<void>): Promise<void> {
		const result = this.taskQueue.then(task);
		this.taskQueue = result.then(undefined, () => undefined);
		return result;
	}

	private showSessionExitStats(session: BusySession, reason: SessionExitReason): void {
		const reasonLabel = getSessionExitLabel(reason);
		const charsTyped = session.state.typedCharacters;

		if (charsTyped === 0) {
			void vscode.window.showInformationMessage(`Session ${reasonLabel} | No typing recorded`);
			return;
		}

		const stats = calculateStats(charsTyped, session.state.activeElapsedMs, {
			totalKeystrokes: session.state.totalKeystrokes,
			errors: session.state.errorKeystrokes,
			backspaces: session.state.backspaceCount,
			minElapsedMs: MIN_ELAPSED_MS,
		});

		const message = [
			`Session ${reasonLabel}`,
			`WPM: ${stats.wpm.toFixed(1)}`,
			`Acc: ${stats.accuracy}%`,
			getSnarkyComment(stats.wpm),
		].join(' | ');

		void vscode.window.showInformationMessage(message);
	}

	private runSafely(task: Promise<void>): void {
		void task.catch((error) => {
			reportFailure('run a Look Busy session task', error);
		});
	}
}

function getDocumentEndPosition(document: vscode.TextDocument): vscode.Position {
	const lastLineIndex = Math.max(0, document.lineCount - 1);
	return document.lineAt(lastLineIndex).range.end;
}

function extractCompositionText(args: unknown): string {
	if (typeof args === 'object' && args !== null && 'text' in args) {
		const text = (args as { text: unknown }).text;
		if (typeof text === 'string') {
			return text;
		}
	}

	return '';
}

function reportFailure(action: string, error: unknown): void {
	console.error(`Look Busy: failed to ${action}.`, error);
}

function getSessionExitLabel(reason: SessionExitReason): string {
	switch (reason) {
		case 'completed':
			return 'complete';
		case 'panic':
			return 'stopped';
		case 'documentClosed':
			return 'closed';
		case 'restarted':
			return 'restarted';
		case 'disposed':
			return 'ended';
	}
}