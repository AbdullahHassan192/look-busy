import * as assert from 'assert';
import * as vscode from 'vscode';
import {
	chooseSessionTypingStart,
	getFullFileTypingBounds,
	inferLanguageFromPath,
	isLockOrMapFile,
	isLowSignalWorkspaceFile,
	isPathInDefaultIgnoredDirectory,
	isRelativePathIgnoredByGitignore,
	parseGitignoreRules,
	prioritizeWorkspaceFiles,
	scoreWorkspaceFilePath,
	stripLeadingBom,
} from '../sources';

suite('Source Helpers', () => {
	test('Infers language from extension', () => {
		assert.strictEqual(inferLanguageFromPath('demo.tsx').languageId, 'typescriptreact');
		assert.strictEqual(inferLanguageFromPath('demo.cpp').languageId, 'cpp');
		assert.strictEqual(inferLanguageFromPath('demo.c').languageId, 'c');
		assert.strictEqual(inferLanguageFromPath('demo.vue').languageId, 'vue');
		assert.strictEqual(inferLanguageFromPath('demo.svelte').languageId, 'svelte');
		assert.strictEqual(inferLanguageFromPath('demo.astro').languageId, 'astro');
		assert.strictEqual(inferLanguageFromPath('demo.dart').languageId, 'dart');
		assert.strictEqual(inferLanguageFromPath('demo.zig').languageId, 'zig');
		assert.strictEqual(inferLanguageFromPath('demo.lua').languageId, 'lua');
		assert.strictEqual(inferLanguageFromPath('demo.ex').languageId, 'elixir');
		assert.strictEqual(inferLanguageFromPath('demo.erl').languageId, 'erlang');
		assert.strictEqual(inferLanguageFromPath('demo.html').languageId, 'html');
		assert.strictEqual(inferLanguageFromPath('demo.css').languageId, 'css');
		assert.strictEqual(inferLanguageFromPath('demo.scss').languageId, 'scss');
		assert.strictEqual(inferLanguageFromPath('demo.json').languageId, 'json');
		assert.strictEqual(inferLanguageFromPath('demo.yaml').languageId, 'yaml');
		assert.strictEqual(inferLanguageFromPath('demo.prisma').languageId, 'prisma');
		assert.strictEqual(inferLanguageFromPath('demo.graphql').languageId, 'graphql');
		assert.strictEqual(inferLanguageFromPath('demo.ps1').languageId, 'powershell');
		assert.strictEqual(inferLanguageFromPath('demo.sh').languageId, 'shellscript');
		assert.strictEqual(inferLanguageFromPath('demo.unknown').languageId, 'plaintext');
	});

	test('Prioritizes active workspace file over others', () => {
		const active = 'C:\\\\repo\\\\src\\\\main.ts';
		const sameDir = 'C:\\\\repo\\\\src\\\\util.ts';
		const distant = 'C:\\\\repo\\\\test\\\\main.test.ts';
		const fixture = 'C:\\\\repo\\\\fixtures\\\\data.json';
		const activeScore = scoreWorkspaceFilePath(active, active);
		const sameDirScore = scoreWorkspaceFilePath(sameDir, active);
		const distantScore = scoreWorkspaceFilePath(distant, active);
		const fixtureScore = scoreWorkspaceFilePath(fixture, active);

		assert.ok(activeScore > sameDirScore);
		assert.ok(sameDirScore > distantScore);
		assert.ok(distantScore === fixtureScore);
	});

	test('Breaks ties randomly when prioritizing files with equal score', () => {
		const fileA = vscode.Uri.file('C:/repo/src/a.ts');
		const fileB = vscode.Uri.file('C:/repo/src/b.ts');

		const prioritized1 = prioritizeWorkspaceFiles([fileA, fileB], undefined, () => 0);
		assert.strictEqual(prioritized1.length, 2);

		let counter = 0;
		const prioritized2 = prioritizeWorkspaceFiles([fileA, fileB], undefined, () => {
			counter += 1;
			return counter === 1 ? 0.9 : 0.1;
		});
		assert.strictEqual(prioritized2[0].fsPath, fileB.fsPath);
	});

	test('Parses .gitignore file and excludes matching files and folders', () => {
		const rules = parseGitignoreRules([
			'dist/',
			'coverage/',
			'*.log',
			'secret.env',
		].join('\n'));

		assert.ok(isRelativePathIgnoredByGitignore('dist/index.js', rules));
		assert.ok(isRelativePathIgnoredByGitignore('coverage/lcov.info', rules));
		assert.ok(isRelativePathIgnoredByGitignore('app/error.log', rules));
		assert.ok(isRelativePathIgnoredByGitignore('secret.env', rules));
		assert.ok(!isRelativePathIgnoredByGitignore('src/main.ts', rules));
	});

	test('Respects negation rules in .gitignore', () => {
		const rules = parseGitignoreRules([
			'*.log',
			'!keep.log',
		].join('\n'));

		assert.ok(isRelativePathIgnoredByGitignore('build/error.log', rules));
		assert.ok(!isRelativePathIgnoredByGitignore('keep.log', rules));
	});

	test('Excludes known tooling and dependency directories by default', () => {
		assert.ok(isPathInDefaultIgnoredDirectory('C:\\\\repo\\\\.vscode\\\\settings.json'));
		assert.ok(isPathInDefaultIgnoredDirectory('C:\\\\repo\\\\.venv\\\\Lib\\\\site.py'));
		assert.ok(isPathInDefaultIgnoredDirectory('C:\\\\repo\\\\node_modules\\\\left-pad\\\\index.js'));
		assert.ok(isPathInDefaultIgnoredDirectory('C:\\\\repo\\\\.nuxt\\\\types.d.ts'));
		assert.ok(!isPathInDefaultIgnoredDirectory('C:\\\\repo\\\\src\\\\feature\\\\main.ts'));
	});

	test('Strips UTF-8 BOM to keep typing alignment intact', () => {
		const text = '\uFEFFfunction demo() {\n\treturn 1;\n}';
		assert.strictEqual(stripLeadingBom(text), 'function demo() {\n\treturn 1;\n}');
	});

	test('Full-file typing bounds skip leading header/import boilerplate', () => {
		const text = [
			"import fs from 'fs';",
			"import path from 'path';",
			'',
			'// startup',
			'',
			'function main() {',
			'\treturn 1;',
			'}',
		].join('\n');

		const bounds = getFullFileTypingBounds(text);
		assert.strictEqual(text.slice(bounds.typingStart), ['function main() {', '\treturn 1;', '}'].join('\n'));
		assert.strictEqual(bounds.typingEnd, text.length);
	});

	test('Full-file typing bounds skip multiline imports and comments properly', () => {
		const text = [
			'/*',
			' * License header',
			' * Multi-line without leading asterisks on some lines',
			' Extra text',
			' */',
			'',
			'import {',
			'  useState,',
			'  useEffect,',
			"} from 'react';",
			'',
			'export function App() {',
			'  return null;',
			'}',
		].join('\n');

		const bounds = getFullFileTypingBounds(text);
		assert.strictEqual(text.slice(bounds.typingStart), ['export function App() {', '  return null;', '}'].join('\n'));
	});

	test('Full-file typing bounds skip Go-style multiline imports', () => {
		const text = [
			'package main',
			'',
			'import (',
			'\t"fmt"',
			'\t"os"',
			')',
			'',
			'func main() {',
			'\tfmt.Println("ok")',
			'}',
		].join('\n');

		const bounds = getFullFileTypingBounds(text);
		assert.strictEqual(text.slice(bounds.typingStart), ['func main() {', '\tfmt.Println("ok")', '}'].join('\n'));
	});

	test('Full-file typing bounds falls back to 0 if entire file is boilerplate', () => {
		const text = [
			'// Line 1',
			'// Line 2',
			'// Line 3',
		].join('\n');

		const bounds = getFullFileTypingBounds(text);
		assert.strictEqual(bounds.typingStart, 0);
	});

	test('isLockOrMapFile identifies various lockfile types', () => {
		assert.strictEqual(isLockOrMapFile('pnpm-lock.yaml'), true);
		assert.strictEqual(isLockOrMapFile('package-lock.json'), true);
		assert.strictEqual(isLockOrMapFile('yarn.lock'), true);
		assert.strictEqual(isLockOrMapFile('Cargo.lock'), true);
		assert.strictEqual(isLockOrMapFile('poetry.lock'), true);
		assert.strictEqual(isLockOrMapFile('bundle.js.map'), true);
		assert.strictEqual(isLockOrMapFile('sitemap.ts'), false);
		assert.strictEqual(isLockOrMapFile('block.ts'), false);
		assert.strictEqual(isLockOrMapFile('clock.dart'), false);
	});

	test('isLowSignalWorkspaceFile filters low-value files while permitting Tailwind, Markdown, and active files', () => {
		const sampleCode = Array.from({ length: 20 }, (_, i) => `const step${i} = ${i};`).join('\n');

		// Valid files that should NOT be considered low signal
		assert.strictEqual(isLowSignalWorkspaceFile(vscode.Uri.file('C:/repo/src/sitemap.ts'), sampleCode), false);
		assert.strictEqual(isLowSignalWorkspaceFile(vscode.Uri.file('C:/repo/src/block.ts'), sampleCode), false);
		assert.strictEqual(isLowSignalWorkspaceFile(vscode.Uri.file('C:/repo/src/clock.dart'), sampleCode), false);
		assert.strictEqual(isLowSignalWorkspaceFile(vscode.Uri.file('C:/repo/src/interlock.rs'), sampleCode), false);

		// Component with long Tailwind lines (e.g. 260-280 characters) should NOT be rejected
		const tailwindLines = [
			'export function Component() {',
			'  return (',
			`    <div className="${'a'.repeat(260)}">`,
			`      <button className="${'b'.repeat(270)}">Click</button>`,
			`      <span className="${'c'.repeat(280)}">Label</span>`,
			'    </div>',
			'  );',
			'}',
		].join('\n');
		assert.strictEqual(isLowSignalWorkspaceFile(vscode.Uri.file('C:/repo/src/Button.tsx'), tailwindLines), false);

		// Markdown paragraphs with 300+ characters should NOT be rejected
		const markdownDoc = [
			'# Title',
			'',
			'First long paragraph '.repeat(15),
			'',
			'Second long paragraph '.repeat(15),
			'',
			'Third long paragraph '.repeat(15),
		].join('\n');
		assert.strictEqual(isLowSignalWorkspaceFile(vscode.Uri.file('C:/repo/docs/guide.md'), markdownDoc), false);

		// Short active file (3 lines, 40 chars) SHOULD be allowed when active
		const shortActive = 'export function add(a: number, b: number) {\n\treturn a + b;\n}';
		assert.strictEqual(isLowSignalWorkspaceFile(vscode.Uri.file('C:/repo/src/add.ts'), shortActive, { isActiveFile: true }), false);
		// But rejected if background workspace file (needs at least 5 lines & 60 chars)
		assert.strictEqual(isLowSignalWorkspaceFile(vscode.Uri.file('C:/repo/src/add.ts'), shortActive, { isActiveFile: false }), true);

		// Real low signal files that SHOULD be rejected
		assert.strictEqual(isLowSignalWorkspaceFile(vscode.Uri.file('C:/repo/src/types.d.ts'), sampleCode), true);
		assert.strictEqual(isLowSignalWorkspaceFile(vscode.Uri.file('C:/repo/bundle.js.map'), sampleCode), true);
		assert.strictEqual(isLowSignalWorkspaceFile(vscode.Uri.file('C:/repo/package-lock.json'), sampleCode), true);
		assert.strictEqual(isLowSignalWorkspaceFile(vscode.Uri.file('C:/repo/pnpm-lock.yaml'), sampleCode), true);
		assert.strictEqual(isLowSignalWorkspaceFile(vscode.Uri.file('C:/repo/Cargo.lock'), sampleCode), true);
		assert.strictEqual(isLowSignalWorkspaceFile(vscode.Uri.file('C:/repo/LICENSE.md'), sampleCode), true);
		assert.strictEqual(isLowSignalWorkspaceFile(vscode.Uri.file('C:/repo/CHANGELOG.md'), sampleCode), true);

		// Minified bundle with single line > 1000 chars SHOULD be rejected
		const minifiedCode = `const a = 1;\n${'x'.repeat(1200)}\nconst b = 2;\nconst c = 3;\nconst d = 4;\n`;
		assert.strictEqual(isLowSignalWorkspaceFile(vscode.Uri.file('C:/repo/dist/bundle.js'), minifiedCode), true);
	});

	test('Session typing start keeps first safe line when baseline path is selected', () => {
		const text = [
			"import fs from 'fs';",
			'',
			'function startHere() {',
			'\treturn true;',
			'}',
			'',
			'function anotherBlock() {',
			'\treturn false;',
			'}',
		].join('\n');
		const bounds = getFullFileTypingBounds(text);
		const selected = chooseSessionTypingStart(text, bounds.typingStart, () => 0.1);

		assert.strictEqual(selected, bounds.typingStart);
	});

	test('Session typing start can choose a later around-middle start', () => {
		const bodyLines = Array.from({ length: 30 }, (_, i) => `const value${i} = ${i};`);
		const text = [
			"import path from 'path';",
			'',
			'// setup',
			'',
			...bodyLines,
		].join('\n');
		const bounds = getFullFileTypingBounds(text);

		let calls = 0;
		const selected = chooseSessionTypingStart(text, bounds.typingStart, () => {
			calls += 1;
			return calls === 1 ? 0.9 : 0.5;
		});

		const midpoint = bounds.typingStart + Math.floor((text.length - bounds.typingStart) / 2);
		const maxDistanceFromMidpoint = Math.max(30, Math.floor((text.length - bounds.typingStart) * 0.2));
		assert.ok(selected >= bounds.typingStart);
		assert.ok(selected > bounds.typingStart);
		assert.ok(Math.abs(selected - midpoint) <= maxDistanceFromMidpoint);
	});

	test('Session typing start falls back to first safe line for short files', () => {
		const text = [
			"import fs from 'fs';",
			'',
			'function shortFile() {',
			'\treturn 1;',
			'}',
		].join('\n');
		const bounds = getFullFileTypingBounds(text);
		const selected = chooseSessionTypingStart(text, bounds.typingStart, () => 0.9);

		assert.strictEqual(selected, bounds.typingStart);
	});
});
