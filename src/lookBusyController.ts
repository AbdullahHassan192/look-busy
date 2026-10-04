import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { getWorkspaceSource, type SourceContent } from './sources';
import { calculateStats, getSnarkyComment } from './stats';

interface BusySession {
	uri: vscode.Uri;
	document: vscode.TextDocument;
	editor: vscode.TextEditor;
	target: string;
	renderedText: string;
	statuses: number[];
	autoFilled: boolean[];
	index: number;
	typingStart: number;
	typingEnd: number;
	lineStarts: number[];
	startedAt?: number;
	lastKeystrokeAt?: number;
	activeElapsedMs: number;
	totalKeystrokes: number;
	errorKeystrokes: number;
	backspaceCount: number;
	tempFilePath: string;
}

type SessionExitReason = 'completed' | 'panic' | 'documentClosed' | 'restarted' | 'disposed';

export class LookBusyController implements vscode.Disposable {
	private readonly untypedDecoration: vscode.TextEditorDecorationType;
	private readonly wrongDecoration: vscode.TextEditorDecorationType;
	private readonly emptyLineHintDecoration: vscode.TextEditorDecorationType;
	private readonly eolHintDecoration: vscode.TextEditorDecorationType;
	private readonly sessionStatusBarItem: vscode.StatusBarItem;
	private readonly sessionActiveEmitter = new vscode.EventEmitter<boolean>();
	private readonly disposables: vscode.Disposable[] = [];
	private session: BusySession | undefined;
	private isUpdatingSelection = false;
	private isRevertingDocumentChange = false;
	private isApplyingSessionText = false;
	public readonly onDidChangeSessionActive = this.sessionActiveEmitter.event;

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
				if (!this.session || this.isUpdatingSelection) {
					return;
				}

				if (event.textEditor.document.uri.toString() !== this.session.uri.toString()) {
					return;
				}

				this.applyCursor();
			}),
			vscode.workspace.onDidCloseTextDocument((document) => {
				if (!this.session) {
					return;
				}

				if (document.uri.toString() !== this.session.uri.toString()) {
					return;
				}

				this.runSafely(this.finalizeSession('documentClosed', false));
			}),
			vscode.window.tabGroups.onDidChangeTabs(() => {
				if (!this.session) {
					return;
				}

				if (this.hasOpenTabForUri(this.session.uri)) {
					return;
				}

				this.runSafely(this.finalizeSession('documentClosed', false));
			}),
			vscode.workspace.onDidChangeTextDocument((event) => {
				if (!this.session || this.isRevertingDocumentChange || this.isApplyingSessionText) {
					return;
				}

				if (event.document.uri.toString() !== this.session.uri.toString()) {
					return;
				}

				if (event.contentChanges.length === 0) {
					return;
				}

				this.runSafely(this.revertUnexpectedDocumentChange());
			})
		);
	}

	public async start(): Promise<void> {
		if (this.session) {
			await this.finalizeSession('restarted', true);
		}

		await this.pruneStaleTempFiles();

		const source = await getWorkspaceSource();
		if (!source) {
			return;
		}

		await this.beginSession(source);
	}

	public async routeType(text: string): Promise<void> {
		if (this.shouldHandleSessionInput()) {
			await this.consumeInput(text);
			return;
		}

		await vscode.commands.executeCommand('default:type', { text });
	}

	public async injectText(text: string): Promise<void> {
		if (this.shouldHandleSessionInput()) {
			await this.consumeInput(text);
			return;
		}

		if (text.length > 0) {
			await vscode.commands.executeCommand('default:type', { text });
		}
	}

	public async blockEdit(action?: string): Promise<void> {
		if (this.shouldHandleSessionInput()) {
			if (action === 'backspace') {
				await this.handleBackspace();
				return;
			}

			await this.hideSuggestions();
		}
	}

	public async panic(): Promise<void> {
		await this.finalizeSession('panic', true);
	}

	public dispose(): void {
		void this.finalizeSession('disposed', false);
		for (const disposable of this.disposables) {
			disposable.dispose();
		}
	}

	private async beginSession(source: SourceContent): Promise<void> {
		const lineStarts = buildLineStarts(source.text);
		const safeTypingStart = this.clampIndex(source.typingStart, source.text.length);
		const safeTypingEnd = this.clampIndex(source.typingEnd, source.text.length);
		const currentLine = findLineForIndex(safeTypingStart, lineStarts);
		const initialWindowEndLine = Math.min(currentLine + 1, lineStarts.length - 1);
		const initialEnd = lineStarts[initialWindowEndLine] ?? source.text.length;
		const initialRenderedText = buildMaskedTargetText(source.text, initialEnd);

		const { uri, tempFilePath } = await this.createTempDocument(source, initialRenderedText);
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
			target: source.text,
			renderedText: initialRenderedText,
			statuses: Array.from({ length: source.text.length }, () => 0),
			autoFilled: Array.from({ length: source.text.length }, () => false),
			index: safeTypingStart,
			typingStart: safeTypingStart,
			typingEnd: safeTypingEnd,
			lineStarts,
			tempFilePath,
			activeElapsedMs: 0,
			totalKeystrokes: 0,
			errorKeystrokes: 0,
			backspaceCount: 0,
		};

		for (let i = 0; i < this.session.typingStart; i += 1) {
			this.session.statuses[i] = 1;
		}

		for (let i = this.session.typingEnd; i < this.session.statuses.length; i += 1) {
			this.session.statuses[i] = 1;
		}

		this.applyAutomaticIndentation();
		await this.synchronizeSessionDocument();

		await vscode.commands.executeCommand('setContext', 'lookBusy.active', true);
		this.sessionActiveEmitter.fire(true);
		this.applyDecorations();
		this.applyCursor();
		await this.hideSuggestions();

		this.sessionStatusBarItem.text = '$(pulse) Looking Busy: Ready';
		this.sessionStatusBarItem.show();
	}

	private shouldHandleSessionInput(): boolean {
		if (!this.session) {
			return false;
		}

		const activeEditor = vscode.window.activeTextEditor;
		if (!activeEditor) {
			return false;
		}

		return activeEditor.document.uri.toString() === this.session.uri.toString();
	}

	private recordKeystroke(): void {
		if (!this.session) {
			return;
		}

		const now = Date.now();
		if (this.session.startedAt === undefined) {
			this.session.startedAt = now;
			this.session.lastKeystrokeAt = now;
			this.session.activeElapsedMs = 0;
			return;
		}

		if (this.session.lastKeystrokeAt !== undefined) {
			const delta = now - this.session.lastKeystrokeAt;
			const maxIdlePauseMs = 2500;
			this.session.activeElapsedMs += Math.min(delta, maxIdlePauseMs);
			this.session.lastKeystrokeAt = now;
		}
	}

	private calculateSessionActiveElapsed(session: BusySession): number {
		if (session.startedAt === undefined || session.lastKeystrokeAt === undefined) {
			return 0;
		}

		const trailingDelta = Date.now() - session.lastKeystrokeAt;
		const maxTrailingMs = 1000;
		return session.activeElapsedMs + Math.min(trailingDelta, maxTrailingMs);
	}

	private updateLiveStatusBar(): void {
		if (!this.session) {
			this.sessionStatusBarItem.hide();
			return;
		}

		const charsTyped = this.countTypedSessionCharacters(this.session);
		if (charsTyped === 0 || this.session.startedAt === undefined) {
			this.sessionStatusBarItem.text = '$(pulse) Looking Busy: Ready';
			return;
		}

		const activeElapsedMs = this.calculateSessionActiveElapsed(this.session);
		const stats = calculateStats(charsTyped, activeElapsedMs, {
			totalKeystrokes: this.session.totalKeystrokes,
			errors: this.session.errorKeystrokes,
			backspaces: this.session.backspaceCount,
			minElapsedMs: 1500,
		});

		this.sessionStatusBarItem.text = `$(pulse) Looking Busy: ${stats.wpm.toFixed(0)} WPM (${stats.accuracy}%)`;
	}

	private async consumeInput(text: string): Promise<void> {
		if (!this.session || text.length === 0) {
			return;
		}

		await this.hideSuggestions();

		const normalizedText = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

		for (const character of Array.from(normalizedText)) {
			if (this.session.index >= this.session.typingEnd) {
				break;
			}

			this.recordKeystroke();
			this.session.totalKeystrokes += 1;

			const expected = this.session.target[this.session.index];
			if (character === expected) {
				this.session.statuses[this.session.index] = 1;
				this.session.autoFilled[this.session.index] = false;
				this.session.index += 1;
				this.applyAutomaticIndentation();
				continue;
			}

			const tabEquivalentLength = this.consumeTabEquivalentIndentation(character);
			if (tabEquivalentLength > 0) {
				this.session.statuses[this.session.index] = 1;
				this.session.autoFilled[this.session.index] = false;
				for (let i = 1; i < tabEquivalentLength; i += 1) {
					this.session.statuses[this.session.index + i] = 1;
					this.session.autoFilled[this.session.index + i] = true;
				}
				this.session.index += tabEquivalentLength;
				this.applyAutomaticIndentation();
				continue;
			}

			if (character === '\t') {
				// Absorb tab when not expecting indentation, preserving alignment
				continue;
			}

			// Wrong character typed: mark as error, but do NOT advance index
			this.session.errorKeystrokes += 1;
			this.session.statuses[this.session.index] = 2;
			this.session.autoFilled[this.session.index] = false;
		}

		await this.synchronizeSessionDocument();
		this.applyDecorations();
		this.applyCursor();
		this.updateLiveStatusBar();

		if (this.session.index >= this.session.typingEnd) {
			await this.completeSession();
		}
	}

	private async handleBackspace(): Promise<void> {
		if (!this.session) {
			return;
		}

		this.recordKeystroke();
		this.session.backspaceCount += 1;
		this.session.totalKeystrokes += 1;

		if (this.session.index <= this.session.typingStart) {
			this.updateLiveStatusBar();
			return;
		}

		// If current character has an uncorrected error, clear it without moving back
		if (this.session.index < this.session.typingEnd && this.session.statuses[this.session.index] === 2) {
			this.session.statuses[this.session.index] = 0;
			await this.synchronizeSessionDocument();
			this.applyDecorations();
			this.applyCursor();
			await this.hideSuggestions();
			this.updateLiveStatusBar();
			return;
		}

		// Roll back preceding auto-filled indentation if any
		while (
			this.session.index > this.session.typingStart &&
			this.session.autoFilled[this.session.index - 1]
		) {
			this.session.index -= 1;
			this.session.statuses[this.session.index] = 0;
			this.session.autoFilled[this.session.index] = false;
		}

		if (this.session.index > this.session.typingStart) {
			this.session.index -= 1;
			this.session.statuses[this.session.index] = 0;
			this.session.autoFilled[this.session.index] = false;
		}

		await this.synchronizeSessionDocument();
		this.applyDecorations();
		this.applyCursor();
		await this.hideSuggestions();
		this.updateLiveStatusBar();
	}

	private applyDecorations(): void {
		if (!this.session) {
			return;
		}

		const window = this.getVisibleWindow();
		const untypedRanges = this.collectRangesForStatus(0, window.start, window.end);
		const wrongRanges = this.collectRangesForStatus(2, window.start, window.end);
		this.session.editor.setDecorations(this.untypedDecoration, untypedRanges);
		this.session.editor.setDecorations(this.wrongDecoration, wrongRanges);

		const emptyLineHints: vscode.Range[] = [];
		const eolHints: vscode.Range[] = [];

		if (this.session.index < this.session.typingEnd && this.session.target[this.session.index] === '\n') {
			const pos = this.session.document.positionAt(this.session.index);
			const lineStart = this.session.target.lastIndexOf('\n', this.session.index - 1) + 1;
			const lineContentBefore = this.session.target.slice(lineStart, this.session.index);
			if (lineContentBefore.trim().length === 0) {
				emptyLineHints.push(new vscode.Range(pos, pos));
			} else {
				eolHints.push(new vscode.Range(pos, pos));
			}
		}

		this.session.editor.setDecorations(this.emptyLineHintDecoration, emptyLineHints);
		this.session.editor.setDecorations(this.eolHintDecoration, eolHints);
	}

	private collectRangesForStatus(status: number, start: number, end: number): vscode.Range[] {
		if (!this.session) {
			return [];
		}

		const ranges: vscode.Range[] = [];
		const statuses = this.session.statuses;
		let startIndex = -1;

		for (let i = start; i < end; i += 1) {
			const match = statuses[i] === status;

			if (match && startIndex === -1) {
				startIndex = i;
			}

			if (!match && startIndex !== -1) {
				ranges.push(
					new vscode.Range(
						this.session.document.positionAt(startIndex),
						this.session.document.positionAt(i)
					)
				);
				startIndex = -1;
			}
		}

		if (startIndex !== -1) {
			ranges.push(
				new vscode.Range(
					this.session.document.positionAt(startIndex),
					this.session.document.positionAt(end)
				)
			);
		}

		return ranges;
	}

	private applyCursor(): void {
		if (!this.session) {
			return;
		}

		const position = this.session.document.positionAt(this.session.index);
		const selection = new vscode.Selection(position, position);

		this.isUpdatingSelection = true;
		this.session.editor.selection = selection;
		this.session.editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
		this.isUpdatingSelection = false;
	}

	private async completeSession(): Promise<void> {
		if (!this.session) {
			return;
		}

		await this.finalizeSession('completed', true);
	}

	private async finalizeSession(reason: SessionExitReason, closeEditor: boolean): Promise<void> {
		if (!this.session) {
			this.sessionStatusBarItem.hide();
			await vscode.commands.executeCommand('setContext', 'lookBusy.active', false);
			this.sessionActiveEmitter.fire(false);
			return;
		}

		const previousSession = this.session;
		this.session = undefined;
		this.sessionStatusBarItem.hide();
		await vscode.commands.executeCommand('setContext', 'lookBusy.active', false);
		this.sessionActiveEmitter.fire(false);

		previousSession.editor.setDecorations(this.untypedDecoration, []);
		previousSession.editor.setDecorations(this.wrongDecoration, []);
		previousSession.editor.setDecorations(this.emptyLineHintDecoration, []);
		previousSession.editor.setDecorations(this.eolHintDecoration, []);

		if (closeEditor) {
			await this.closeSessionEditorWithoutSavePrompt(previousSession);
		}

		await fs.unlink(previousSession.tempFilePath).catch(() => undefined);
		if (reason !== 'disposed') {
			this.showSessionExitStats(previousSession, reason);
		}
	}

	private async closeEditorForUri(uri: vscode.Uri): Promise<void> {
		const toClose: vscode.Tab[] = [];
		const uriText = uri.toString();

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

	private async createTempDocument(source: SourceContent, initialText: string): Promise<{ uri: vscode.Uri; tempFilePath: string }> {
		const tempDir = path.join(os.tmpdir(), 'look-busy');
		await fs.mkdir(tempDir, { recursive: true });

		const nonce = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
		const extension = source.extension.startsWith('.') ? source.extension : '.txt';
		const tempFilePath = path.join(tempDir, `look-busy-${nonce}${extension}`);

		await fs.writeFile(tempFilePath, initialText, 'utf8');

		const uri = vscode.Uri.file(tempFilePath);
		return {
			uri,
			tempFilePath,
		};
	}

	private async pruneStaleTempFiles(): Promise<void> {
		const tempDir = path.join(os.tmpdir(), 'look-busy');
		const staleThresholdMs = 12 * 60 * 60 * 1000;
		const now = Date.now();

		await fs.mkdir(tempDir, { recursive: true });
		const entries = await fs.readdir(tempDir, { withFileTypes: true });

		const cleanupTasks: Promise<void>[] = [];
		for (const entry of entries) {
			if (!entry.isFile() || !entry.name.startsWith('look-busy-')) {
				continue;
			}

			const tempFilePath = path.join(tempDir, entry.name);
			const task = fs.stat(tempFilePath)
				.then((stats) => {
					if (now - stats.mtimeMs < staleThresholdMs) {
						return;
					}
					return fs.unlink(tempFilePath).then(undefined, () => undefined);
				})
				.then(() => undefined, () => undefined);
			cleanupTasks.push(task);
		}

		await Promise.all(cleanupTasks);
	}

	private async hideSuggestions(): Promise<void> {
		await vscode.commands.executeCommand('hideSuggestWidget').then(undefined, () => undefined);
		await vscode.commands.executeCommand('editor.action.inlineSuggest.hide').then(undefined, () => undefined);
	}

	private applyAutomaticIndentation(): void {
		if (!this.session) {
			return;
		}

		const { target, typingEnd } = this.session;
		const atLineStart = this.session.index === 0 || target[this.session.index - 1] === '\n';
		if (!atLineStart) {
			return;
		}

		while (this.session.index < typingEnd) {
			const character = target[this.session.index];
			if (character !== ' ' && character !== '\t') {
				break;
			}

			this.session.statuses[this.session.index] = 1;
			this.session.autoFilled[this.session.index] = true;
			this.session.index += 1;
		}
	}

	private getVisibleWindow(): { start: number; end: number } {
		if (!this.session) {
			return { start: 0, end: 0 };
		}

		const currentLine = findLineForIndex(this.session.index, this.session.lineStarts);
		const windowStart = 0;
		const windowEndLine = Math.min(currentLine + 1, this.session.lineStarts.length - 1);
		const windowEnd = this.session.lineStarts[windowEndLine] ?? this.session.target.length;

		return {
			start: windowStart,
			end: Math.max(windowStart, windowEnd),
		};
	}

	private clampIndex(index: number, length: number): number {
		if (index < 0) {
			return 0;
		}

		if (index > length) {
			return length;
		}

		return index;
	}

	private runSafely(task: Promise<void>): void {
		void task.catch((error) => {
			console.error('Look Busy session task failed.', error);
		});
	}

	private countTypedSessionCharacters(session: BusySession): number {
		let typed = 0;
		for (let i = session.typingStart; i < session.typingEnd; i += 1) {
			if (session.statuses[i] === 1 && !session.autoFilled[i]) {
				typed += 1;
			}
		}

		return typed;
	}

	private consumeTabEquivalentIndentation(inputCharacter: string): number {
		if (!this.session || inputCharacter !== '\t') {
			return 0;
		}

		const { target, index, typingEnd } = this.session;
		return getTabEquivalentIndentationLength(target, index, typingEnd);
	}

	private async revertUnexpectedDocumentChange(): Promise<void> {
		this.isRevertingDocumentChange = true;
		try {
			await this.hideSuggestions();
			await this.synchronizeSessionDocument();
			this.applyDecorations();
			this.applyCursor();
		} finally {
			this.isRevertingDocumentChange = false;
		}
	}

	private async synchronizeSessionDocument(): Promise<void> {
		if (!this.session) {
			return;
		}

		const window = this.getVisibleWindow();
		const nextRenderedText = buildMaskedTargetText(this.session.target, window.end);
		if (nextRenderedText === this.session.renderedText) {
			return;
		}

		const edit = new vscode.WorkspaceEdit();
		edit.replace(
			this.session.uri,
			new vscode.Range(
				this.session.document.positionAt(0),
				this.session.document.positionAt(this.session.document.getText().length)
			),
			nextRenderedText
		);

		this.isApplyingSessionText = true;
		try {
			const applied = await vscode.workspace.applyEdit(edit);
			if (!applied) {
				throw new Error('Failed to synchronize Look Busy session text.');
			}
			this.session.renderedText = nextRenderedText;
			const saved = await this.session.document.save();
			if (!saved) {
				throw new Error('Failed to save Look Busy temp session document.');
			}
		} finally {
			this.isApplyingSessionText = false;
		}
	}

	private showSessionExitStats(session: BusySession, reason: SessionExitReason): void {
		const charsTyped = this.countTypedSessionCharacters(session);
		const reasonLabel = getSessionExitLabel(reason);

		if (charsTyped === 0) {
			void vscode.window.showInformationMessage(`Session ${reasonLabel} | No typing recorded`);
			return;
		}

		const activeElapsedMs = this.calculateSessionActiveElapsed(session);
		const stats = calculateStats(charsTyped, activeElapsedMs, {
			totalKeystrokes: session.totalKeystrokes,
			errors: session.errorKeystrokes,
			backspaces: session.backspaceCount,
			minElapsedMs: 1500,
		});

		const message = [
			`Session ${reasonLabel}`,
			`WPM: ${stats.wpm.toFixed(1)}`,
			`Acc: ${stats.accuracy}%`,
			getSnarkyComment(stats.wpm),
		].join(' | ');

		void vscode.window.showInformationMessage(message);
	}
}

function buildLineStarts(text: string): number[] {
	const starts = [0];

	for (let i = 0; i < text.length; i += 1) {
		if (text[i] === '\n') {
			starts.push(i + 1);
		}
	}

	if (starts[starts.length - 1] !== text.length) {
		starts.push(text.length);
	}

	return starts;
}

function findLineForIndex(index: number, lineStarts: number[]): number {
	let low = 0;
	let high = lineStarts.length - 1;

	while (low < high) {
		const mid = Math.floor((low + high + 1) / 2);
		if (lineStarts[mid] <= index) {
			low = mid;
		} else {
			high = mid - 1;
		}
	}

	return Math.max(0, Math.min(low, lineStarts.length - 2));
}

function buildMaskedTargetText(target: string, visibleEnd: number): string {
	if (visibleEnd >= target.length) {
		return target;
	}

	return target.slice(0, visibleEnd);
}

export function getTabEquivalentIndentationLength(target: string, index: number, typingEnd: number): number {
	if (index < 0 || index >= typingEnd || target[index] === '\n') {
		return 0;
	}

	const lineStart = target.lastIndexOf('\n', index - 1) + 1;
	for (let i = lineStart; i < index; i += 1) {
		const previousCharacter = target[i];
		if (previousCharacter !== ' ' && previousCharacter !== '\t') {
			return 0;
		}
	}

	let consumed = 0;
	while (index + consumed < typingEnd && consumed < 4) {
		const expectedCharacter = target[index + consumed];
		if (expectedCharacter !== ' ' && expectedCharacter !== '\t') {
			break;
		}
		consumed += 1;
	}

	return consumed;
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
		default:
			return 'ended';
	}
}
