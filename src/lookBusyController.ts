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
	tempFilePath: string;
}

type SessionExitReason = 'completed' | 'panic' | 'documentClosed' | 'restarted' | 'disposed';

export class LookBusyController implements vscode.Disposable {
	private readonly untypedDecoration: vscode.TextEditorDecorationType;
	private readonly wrongDecoration: vscode.TextEditorDecorationType;
	private readonly hiddenDecoration: vscode.TextEditorDecorationType;
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

		this.hiddenDecoration = vscode.window.createTextEditorDecorationType({
			color: new vscode.ThemeColor('editor.background'),
			backgroundColor: new vscode.ThemeColor('editor.background'),
			opacity: '0',
			textDecoration: 'none; text-decoration-color: transparent; border-bottom: none; outline: none;',
		});

		this.disposables.push(
			this.untypedDecoration,
			this.wrongDecoration,
			this.hiddenDecoration,
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
		const { uri, tempFilePath } = await this.createTempDocument(source);
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
			renderedText: source.text,
			statuses: Array.from({ length: source.text.length }, () => 0),
			autoFilled: Array.from({ length: source.text.length }, () => false),
			index: this.clampIndex(source.typingStart, source.text.length),
			typingStart: this.clampIndex(source.typingStart, source.text.length),
			typingEnd: this.clampIndex(source.typingEnd, source.text.length),
			lineStarts: buildLineStarts(source.text),
			tempFilePath,
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

	private async consumeInput(text: string): Promise<void> {
		if (!this.session || text.length === 0) {
			return;
		}

		await this.hideSuggestions();

		for (const character of Array.from(text)) {
			if (this.session.index >= this.session.typingEnd) {
				break;
			}

			if (this.session.startedAt === undefined) {
				this.session.startedAt = Date.now();
			}

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
				for (let i = 0; i < tabEquivalentLength; i += 1) {
					this.session.statuses[this.session.index + i] = 1;
					this.session.autoFilled[this.session.index + i] = false;
				}
				this.session.index += tabEquivalentLength;
				this.applyAutomaticIndentation();
				continue;
			}

			this.session.statuses[this.session.index] = 2;
			this.session.autoFilled[this.session.index] = false;
			this.session.index += 1;
			this.applyAutomaticIndentation();
		}

		await this.synchronizeSessionDocument();
		this.applyDecorations();
		this.applyCursor();

		if (this.session.index >= this.session.typingEnd) {
			await this.completeSession();
		}
	}

	private async handleBackspace(): Promise<void> {
		if (!this.session || this.session.index <= this.session.typingStart) {
			return;
		}

		this.session.index -= 1;
		if (this.session.index >= this.session.typingStart && this.session.index < this.session.typingEnd) {
			this.session.statuses[this.session.index] = 0;
			this.session.autoFilled[this.session.index] = false;
		}

		await this.synchronizeSessionDocument();
		this.applyDecorations();
		this.applyCursor();
		await this.hideSuggestions();
	}

	private applyDecorations(): void {
		if (!this.session) {
			return;
		}

		const window = this.getVisibleWindow();
		const untypedRanges = this.collectRangesForStatus(0, window.start, window.end);
		const wrongRanges = this.collectRangesForStatus(2, window.start, window.end);
		const hiddenRanges = this.collectHiddenRanges(window.start, window.end);
		this.session.editor.setDecorations(this.untypedDecoration, untypedRanges);
		this.session.editor.setDecorations(this.wrongDecoration, wrongRanges);
		this.session.editor.setDecorations(this.hiddenDecoration, hiddenRanges);
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

	private collectHiddenRanges(visibleStart: number, visibleEnd: number): vscode.Range[] {
		if (!this.session) {
			return [];
		}

		const ranges: vscode.Range[] = [];
		if (visibleEnd < this.session.target.length) {
			ranges.push(
				new vscode.Range(
					this.session.document.positionAt(visibleEnd),
					this.session.document.positionAt(this.session.target.length)
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
			await vscode.commands.executeCommand('setContext', 'lookBusy.active', false);
			this.sessionActiveEmitter.fire(false);
			return;
		}

		const previousSession = this.session;
		this.session = undefined;
		await vscode.commands.executeCommand('setContext', 'lookBusy.active', false);
		this.sessionActiveEmitter.fire(false);

		previousSession.editor.setDecorations(this.untypedDecoration, []);
		previousSession.editor.setDecorations(this.wrongDecoration, []);
		previousSession.editor.setDecorations(this.hiddenDecoration, []);

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

	private async createTempDocument(source: SourceContent): Promise<{ uri: vscode.Uri; tempFilePath: string }> {
		const tempDir = path.join(os.tmpdir(), 'look-busy');
		await fs.mkdir(tempDir, { recursive: true });

		const nonce = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
		const extension = source.extension.startsWith('.') ? source.extension : '.txt';
		const tempFilePath = path.join(tempDir, `look-busy-${nonce}${extension}`);

		await fs.writeFile(tempFilePath, source.text, 'utf8');

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
			if (session.statuses[i] !== 0 && !session.autoFilled[i]) {
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
		const elapsedMs = session.startedAt !== undefined ? Date.now() - session.startedAt : 0;
		const charsTyped = this.countTypedSessionCharacters(session);
		const stats = calculateStats(charsTyped, elapsedMs);
		const reasonLabel = getSessionExitLabel(reason);
		const message = [
			`Session ${reasonLabel}`,
			`WPM: ${stats.wpm.toFixed(1)}`,
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

	let output = '';
	for (let i = 0; i < target.length; i += 1) {
		if (i < visibleEnd) {
			output += target[i];
			continue;
		}

		output += target[i] === '\n' ? '\n' : ' ';
	}

	return output;
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
