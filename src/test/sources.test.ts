import * as assert from 'assert';
import {
	chooseSessionTypingStart,
	getFullFileTypingBounds,
	inferLanguageFromPath,
	isPathInDefaultIgnoredDirectory,
	isRelativePathIgnoredByGitignore,
	parseGitignoreRules,
	scoreWorkspaceFilePath,
	stripLeadingBom,
} from '../sources';

suite('Source Helpers', () => {
	test('Infers language from extension', () => {
		assert.strictEqual(inferLanguageFromPath('demo.tsx').languageId, 'typescriptreact');
		assert.strictEqual(inferLanguageFromPath('demo.cpp').languageId, 'cpp');
		assert.strictEqual(inferLanguageFromPath('demo.unknown').languageId, 'plaintext');
	});

	test('Prioritizes active workspace file over others', () => {
		const active = 'C:\\repo\\src\\main.ts';
		const sameDir = 'C:\\repo\\src\\util.ts';
		const distant = 'C:\\repo\\test\\main.test.ts';
		const activeScore = scoreWorkspaceFilePath(active, active);
		const sameDirScore = scoreWorkspaceFilePath(sameDir, active);
		const distantScore = scoreWorkspaceFilePath(distant, active);

		assert.ok(activeScore > sameDirScore);
		assert.ok(sameDirScore > distantScore);
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
		assert.ok(isPathInDefaultIgnoredDirectory('C:\\repo\\.vscode\\settings.json'));
		assert.ok(isPathInDefaultIgnoredDirectory('C:\\repo\\.venv\\Lib\\site.py'));
		assert.ok(isPathInDefaultIgnoredDirectory('C:\\repo\\node_modules\\left-pad\\index.js'));
		assert.ok(!isPathInDefaultIgnoredDirectory('C:\\repo\\src\\feature\\main.ts'));
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
