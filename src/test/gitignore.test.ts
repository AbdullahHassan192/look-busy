import * as assert from 'assert';
import {
	createGitignoreMatcher,
	isPathIgnoredByGitignoreMatchers,
	isRelativePathIgnoredByGitignore,
	parseGitignoreRules,
	type GitignoreMatcher,
} from '../sources';

function matchers(...entries: Array<[root: string, content: string]>): GitignoreMatcher[] {
	const built = entries
		.map(([root, content]) => createGitignoreMatcher(root, content))
		.filter((matcher): matcher is GitignoreMatcher => matcher !== undefined);
	return built;
}

function rules(content: string) {
	return parseGitignoreRules(content);
}

suite('Gitignore Rules', () => {
	test('Directory patterns match the directory and everything under it', () => {
		const parsed = rules(['dist/', 'build'].join('\n'));

		assert.ok(isRelativePathIgnoredByGitignore('dist', parsed));
		assert.ok(isRelativePathIgnoredByGitignore('dist/index.js', parsed));
		assert.ok(isRelativePathIgnoredByGitignore('packages/app/dist/index.js', parsed));
		assert.ok(isRelativePathIgnoredByGitignore('build', parsed));
		assert.ok(isRelativePathIgnoredByGitignore('build/out.js', parsed));
		assert.ok(!isRelativePathIgnoredByGitignore('distribution/index.js', parsed));
	});

	test('Rooted patterns only match from the ignore file directory', () => {
		const parsed = rules('/logs');

		assert.ok(isRelativePathIgnoredByGitignore('logs', parsed));
		assert.ok(isRelativePathIgnoredByGitignore('logs/today.txt', parsed));
		assert.ok(!isRelativePathIgnoredByGitignore('nested/logs/today.txt', parsed));
	});

	test('Leading double star collapses to any depth', () => {
		const parsed = rules('**/target');

		assert.ok(isRelativePathIgnoredByGitignore('target', parsed));
		assert.ok(isRelativePathIgnoredByGitignore('target/debug', parsed));
		assert.ok(isRelativePathIgnoredByGitignore('crates/inner/target', parsed));
		assert.ok(!isRelativePathIgnoredByGitignore('targets', parsed));
	});

	test('Interior double star matches zero or more directories', () => {
		const parsed = rules('a/**/b');

		assert.ok(isRelativePathIgnoredByGitignore('a/b', parsed));
		assert.ok(isRelativePathIgnoredByGitignore('a/x/b', parsed));
		assert.ok(isRelativePathIgnoredByGitignore('a/x/y/b', parsed));
		assert.ok(!isRelativePathIgnoredByGitignore('ab', parsed));
	});

	test('Excluding a directory excludes everything beneath it', () => {
		const parsed = rules('a/**/b');

		// git check-ignore agrees: a/b is excluded, so a/b/c is too.
		assert.ok(isRelativePathIgnoredByGitignore('a/b/c', parsed));
	});

	test('Trailing double star matches everything inside a directory', () => {
		const parsed = rules('abc/**');

		assert.ok(isRelativePathIgnoredByGitignore('abc/x', parsed));
		assert.ok(isRelativePathIgnoredByGitignore('abc/x/y', parsed));
		assert.ok(!isRelativePathIgnoredByGitignore('abc', parsed));
	});

	test('Bare double star behaves like a single star', () => {
		const parsed = rules('a**b');

		assert.ok(isRelativePathIgnoredByGitignore('axb', parsed));
		assert.ok(isRelativePathIgnoredByGitignore('a-long-b', parsed));
		assert.ok(!isRelativePathIgnoredByGitignore('a/b', parsed));
	});

	test('Single star does not cross a directory separator', () => {
		const parsed = rules('src/*.ts');

		assert.ok(isRelativePathIgnoredByGitignore('src/index.ts', parsed));
		assert.ok(isRelativePathIgnoredByGitignore('app/src/index.ts', parsed));
		assert.ok(!isRelativePathIgnoredByGitignore('src/nested/index.ts', parsed));
	});

	test('Question mark matches exactly one non separator character', () => {
		const parsed = rules('file?.txt');

		assert.ok(isRelativePathIgnoredByGitignore('file1.txt', parsed));
		assert.ok(!isRelativePathIgnoredByGitignore('file12.txt', parsed));
		assert.ok(!isRelativePathIgnoredByGitignore('file.txt', parsed));
	});

	test('Character classes are honoured', () => {
		const parsed = rules(['tmp[0-9]', 'log[!0-9]'].join('\n'));

		assert.ok(isRelativePathIgnoredByGitignore('tmp3', parsed));
		assert.ok(isRelativePathIgnoredByGitignore('tmp0', parsed));
		assert.ok(!isRelativePathIgnoredByGitignore('tmpx', parsed));
		assert.ok(isRelativePathIgnoredByGitignore('logA', parsed));
		assert.ok(!isRelativePathIgnoredByGitignore('log7', parsed));
	});

	test('An unterminated character class does not swallow the rest of the pattern', () => {
		const parsed = rules('weird[name');

		assert.ok(!isRelativePathIgnoredByGitignore('weirdn', parsed));
	});

	test('Comments and blank lines are skipped', () => {
		const parsed = rules(['# a comment', '', '   ', '\t', '*.log'].join('\n'));

		assert.strictEqual(parsed.length, 1);
		assert.ok(isRelativePathIgnoredByGitignore('app.log', parsed));
	});

	test('An escaped hash is a literal file name', () => {
		const parsed = rules(['\\#notes.md', '\\!urgent.md'].join('\n'));

		assert.strictEqual(parsed.length, 2);
		assert.ok(isRelativePathIgnoredByGitignore('#notes.md', parsed));
		assert.ok(isRelativePathIgnoredByGitignore('!urgent.md', parsed));
		assert.ok(!isRelativePathIgnoredByGitignore('notes.md', parsed));
	});

	test('Trailing whitespace is stripped unless escaped', () => {
		const parsed = rules(['build/   ', 'a\\ b  '].join('\n'));

		assert.ok(isRelativePathIgnoredByGitignore('build/out.js', parsed));
		assert.ok(isRelativePathIgnoredByGitignore('a b', parsed));
		assert.ok(!isRelativePathIgnoredByGitignore('a', parsed));
	});

	test('Leading whitespace stays significant, matching git', () => {
		const parsed = rules('  indented.txt');

		assert.ok(isRelativePathIgnoredByGitignore('  indented.txt', parsed));
		assert.ok(!isRelativePathIgnoredByGitignore('indented.txt', parsed));
	});

	test('The last matching rule wins', () => {
		const parsed = rules(['*.log', '!debug.log', 'debug.log'].join('\n'));

		assert.ok(isRelativePathIgnoredByGitignore('debug.log', parsed));
		assert.ok(isRelativePathIgnoredByGitignore('other.log', parsed));
	});

	test('Carriage returns are normalised away', () => {
		const parsed = rules('dist/\r\n*.tmp\r\n');

		assert.ok(isRelativePathIgnoredByGitignore('dist/out.js', parsed));
		assert.ok(isRelativePathIgnoredByGitignore('a.tmp', parsed));
	});

	test('Empty and slash-only patterns are dropped', () => {
		assert.deepStrictEqual(rules(['/','//',''].join('\n')), []);
	});
});

suite('Gitignore Matcher Precedence', () => {
	test('An empty matcher list ignores nothing', () => {
		assert.strictEqual(isPathIgnoredByGitignoreMatchers('/repo/src/index.ts', []), false);
	});

	test('A matcher outside the path ancestry is skipped', () => {
		const built = matchers(['/other', '*.log']);
		assert.strictEqual(isPathIgnoredByGitignoreMatchers('/repo/src/index.ts', built), false);
	});

	test('A nested negation overrides the parent rule', () => {
		const built = matchers(['/repo', '*.log'], ['/repo/packages/app', '!important.log']);

		assert.strictEqual(isPathIgnoredByGitignoreMatchers('/repo/packages/app/important.log', built), false);
		assert.strictEqual(isPathIgnoredByGitignoreMatchers('/repo/packages/app/other.log', built), true);
		assert.strictEqual(isPathIgnoredByGitignoreMatchers('/repo/other/important.log', built), true);
	});

	test('A nested matcher with no matching rule defers to the parent', () => {
		const built = matchers(['/repo', 'dist/'], ['/repo/packages/app', '*.spec.ts']);

		assert.strictEqual(isPathIgnoredByGitignoreMatchers('/repo/packages/app/dist/out.js', built), true);
		assert.strictEqual(isPathIgnoredByGitignoreMatchers('/repo/packages/app/index.spec.ts', built), true);
		assert.strictEqual(isPathIgnoredByGitignoreMatchers('/repo/packages/app/index.ts', built), false);
	});

	test('Deeper directories win regardless of declaration order', () => {
		const built = matchers(['/repo/packages/app', '!keep.ts'], ['/repo', 'keep.ts']);

		assert.strictEqual(isPathIgnoredByGitignoreMatchers('/repo/packages/app/keep.ts', built), false);
	});

	test('A git exclude file acts as a repository root matcher', () => {
		const built = matchers(['/repo', 'scratch/'], ['/repo', 'notes.local']);

		assert.strictEqual(isPathIgnoredByGitignoreMatchers('/repo/notes.local', built), true);
		assert.strictEqual(isPathIgnoredByGitignoreMatchers('/repo/src/notes.local', built), true);
		assert.strictEqual(isPathIgnoredByGitignoreMatchers('/repo/scratch/tmp.txt', built), true);
	});

	test('Multiple workspace roots are evaluated independently', () => {
		const built = matchers(['/repo-a', '*.log'], ['/repo-b', '*.tmp']);

		assert.strictEqual(isPathIgnoredByGitignoreMatchers('/repo-a/x.log', built), true);
		assert.strictEqual(isPathIgnoredByGitignoreMatchers('/repo-a/x.tmp', built), false);
		assert.strictEqual(isPathIgnoredByGitignoreMatchers('/repo-b/x.tmp', built), true);
		assert.strictEqual(isPathIgnoredByGitignoreMatchers('/repo-b/x.log', built), false);
	});

	test('Paths are normalised so separators and casing do not matter', () => {
		const built = matchers(['C:\\repo\\pkg', '*.log']);

		assert.strictEqual(isPathIgnoredByGitignoreMatchers('C:\\repo\\pkg\\app.log', built), true);
		assert.strictEqual(isPathIgnoredByGitignoreMatchers('C:/repo/pkg/app.log', built), true);
	});

	test('A matcher with no usable rules is not created', () => {
		assert.strictEqual(createGitignoreMatcher('/repo', '# only a comment'), undefined);
		assert.strictEqual(createGitignoreMatcher('/repo', ''), undefined);
	});

	test('The directory holding the ignore file is the scope root', () => {
		const built = matchers(['/repo/packages/app', 'local.env']);

		assert.strictEqual(isPathIgnoredByGitignoreMatchers('/repo/packages/app/local.env', built), true);
		assert.strictEqual(isPathIgnoredByGitignoreMatchers('/repo/local.env', built), false);
	});
});