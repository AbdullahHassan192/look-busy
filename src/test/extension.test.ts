import * as assert from 'assert';

import * as vscode from 'vscode';

suite('Extension Test Suite', () => {
	test('VS Code API is available in extension host', () => {
		assert.ok(vscode.env.appName.length > 0);
	});
});
