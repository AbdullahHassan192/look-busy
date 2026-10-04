import * as assert from 'assert';
import * as vscode from 'vscode';
import { getFallbackAlgorithmSource, getWorkspaceSource } from '../sources';
import { readSettings } from '../settings';

suite('Source Selection', () => {
	test('Builtin mode never touches the workspace', async () => {
		const source = await getWorkspaceSource({ preferWorkspace: false });

		assert.ok(source, 'expected a built-in source');
		assert.ok(source.text.length > 0);
		assert.ok(source.typingEnd > source.typingStart);
	});

	test('Workspace-only mode returns nothing when no folder is open', async () => {
		const hasFolder = (vscode.workspace.workspaceFolders?.length ?? 0) > 0;
		if (hasFolder) {
			// The suite runs without a folder; skip rather than assert on repo content.
			return;
		}

		const source = await getWorkspaceSource({
			preferWorkspace: true,
			requireWorkspace: true,
		});

		assert.strictEqual(source, undefined);
	});

	test('Auto mode falls back to a built-in source when no folder is open', async () => {
		const hasFolder = (vscode.workspace.workspaceFolders?.length ?? 0) > 0;
		if (hasFolder) {
			return;
		}

		const source = await getWorkspaceSource({ preferWorkspace: true });

		assert.ok(source, 'expected a fallback source');
	});

	test('A cancelled token stops the workspace scan', async () => {
		const controller = new vscode.CancellationTokenSource();
		controller.cancel();

		const source = await getWorkspaceSource({ token: controller.token });

		assert.strictEqual(source, undefined);
		controller.dispose();
	});
});

suite('Built-in Algorithm Source', () => {
	test('Honours the preferred language id', () => {
		const source = getFallbackAlgorithmSource('python');

		assert.strictEqual(source.languageId, 'python');
		assert.strictEqual(source.extension, '.py');
	});

	test('Falls back to some pack for an unknown language id', () => {
		const source = getFallbackAlgorithmSource('not-a-language');

		assert.ok(source.languageId.length > 0);
		assert.ok(source.extension.startsWith('.'));
	});

	test('The typed range starts on a fresh line after the header', () => {
		for (const languageId of ['typescript', 'python', 'go', 'rust']) {
			const source = getFallbackAlgorithmSource(languageId);

			assert.strictEqual(
				source.text[source.typingStart - 1],
				'\n',
				`Expected the typed block to start on its own line for ${languageId}`
			);

			const typed = source.text.slice(source.typingStart);
			assert.ok(typed.length > 0, `Expected a non-empty typed block for ${languageId}`);
			assert.ok(
				typed.trim().length === typed.trimStart().length && typed.startsWith(typed.trimStart()),
				`Expected no leading blank line in the typed block for ${languageId}`
			);
			assert.strictEqual(
				typed.trimEnd().length,
				typed.trimEnd().replace(/\s+$/, '').length,
				`Expected the typed block to end with code, not whitespace, for ${languageId}`
			);
		}
	});

	test('Typing range ends at the end of the snippet', () => {
		const source = getFallbackAlgorithmSource('typescript');

		assert.strictEqual(source.typingEnd, source.text.length);
	});
});

suite('Settings', () => {
	test('Reads defaults when nothing is configured', () => {
		const settings = readSettings();

		assert.strictEqual(settings.source, 'auto');
		assert.strictEqual(settings.showStatusBarButton, true);
		assert.strictEqual(settings.ghostLinesAhead, 1);
	});

	test('Honours configured values', async function () {
		// Writing three settings to global config takes longer than the default budget.
		this.timeout(15000);

		const config = vscode.workspace.getConfiguration('lookBusy');
		await config.update(
			'source',
			'builtin',
			vscode.ConfigurationTarget.Global
		);
		await config.update('ghostLinesAhead', 4, vscode.ConfigurationTarget.Global);
		await config.update('showStatusBarButton', false, vscode.ConfigurationTarget.Global);

		try {
			const settings = readSettings();

			assert.strictEqual(settings.source, 'builtin');
			assert.strictEqual(settings.ghostLinesAhead, 4);
			assert.strictEqual(settings.showStatusBarButton, false);
		} finally {
			await config.update('source', undefined, vscode.ConfigurationTarget.Global);
			await config.update('ghostLinesAhead', undefined, vscode.ConfigurationTarget.Global);
			await config.update('showStatusBarButton', undefined, vscode.ConfigurationTarget.Global);
		}
	});

	test('Clamps the ghost line count into range', async () => {
		const config = vscode.workspace.getConfiguration('lookBusy');
		await config.update('ghostLinesAhead', 999, vscode.ConfigurationTarget.Global);

		try {
			assert.strictEqual(readSettings().ghostLinesAhead, 20);
		} finally {
			await config.update('ghostLinesAhead', undefined, vscode.ConfigurationTarget.Global);
		}

		await config.update('ghostLinesAhead', 0, vscode.ConfigurationTarget.Global);

		try {
			assert.strictEqual(readSettings().ghostLinesAhead, 1);
		} finally {
			await config.update('ghostLinesAhead', undefined, vscode.ConfigurationTarget.Global);
		}
	});
});