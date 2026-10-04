import * as assert from 'assert';
import {
	buildLineStarts,
	buildMaskedTargetText,
	commonPrefixLength,
	computeTextWindow,
	findLineForIndex,
} from '../textWindow';

suite('Text Window Helpers', () => {
	const text = 'alpha\nbeta\ngamma\ndelta';

	test('Builds a line start table including the text length', () => {
		assert.deepStrictEqual(buildLineStarts(text), [0, 6, 11, 17, 22]);
	});

	test('Line start table for single line text', () => {
		assert.deepStrictEqual(buildLineStarts('only line'), [0, 9]);
	});

	test('Line start table for empty text', () => {
		assert.deepStrictEqual(buildLineStarts(''), [0]);
	});

	test('Finds the line containing an index', () => {
		const lineStarts = buildLineStarts(text);

		assert.strictEqual(findLineForIndex(0, lineStarts), 0);
		assert.strictEqual(findLineForIndex(5, lineStarts), 0);
		assert.strictEqual(findLineForIndex(6, lineStarts), 1);
		assert.strictEqual(findLineForIndex(10, lineStarts), 1);
		assert.strictEqual(findLineForIndex(17, lineStarts), 3);
		assert.strictEqual(findLineForIndex(22, lineStarts), 3);
	});

	test('Window shows the rest of the current line by default', () => {
		const lineStarts = buildLineStarts(text);
		const window = computeTextWindow(text, lineStarts, 8, 1);

		assert.strictEqual(window.start, 6);
		assert.strictEqual(window.end, 11);
		assert.strictEqual(buildMaskedTargetText(text, window.end), 'alpha\nbeta\n');
	});

	test('Window start stays on the cursor line so scans skip typed text', () => {
		const lineStarts = buildLineStarts(text);

		for (const index of [0, 5, 6, 11, 17, 22]) {
			const window = computeTextWindow(text, lineStarts, index, 1);
			assert.ok(window.start >= lineStarts[findLineForIndex(index, lineStarts)]);
			assert.ok(window.start <= index);
		}
	});

	test('Extra ghost lines widen the window by whole lines', () => {
		const lineStarts = buildLineStarts(text);
		const window = computeTextWindow(text, lineStarts, 8, 2);

		assert.strictEqual(window.start, 6);
		assert.strictEqual(window.end, 17);
		assert.strictEqual(buildMaskedTargetText(text, window.end), 'alpha\nbeta\ngamma\n');
	});

	test('Ghost line count below one is clamped to one', () => {
		const lineStarts = buildLineStarts(text);

		assert.deepStrictEqual(
			computeTextWindow(text, lineStarts, 8, 0),
			computeTextWindow(text, lineStarts, 8, 1)
		);
	});

	test('Window never runs backwards at the end of the text', () => {
		const lineStarts = buildLineStarts(text);
		const window = computeTextWindow(text, lineStarts, text.length, 1);

		assert.ok(window.end >= window.start);
		assert.strictEqual(buildMaskedTargetText(text, window.end), text);
	});

	test('Masked text returns the whole target when the window reaches the end', () => {
		assert.strictEqual(buildMaskedTargetText('abc', 99), 'abc');
		assert.strictEqual(buildMaskedTargetText('abc', 2), 'ab');
	});

	test('Common prefix length measures the unchanged head', () => {
		assert.strictEqual(commonPrefixLength('abcdef', 'abcdef'), 6);
		assert.strictEqual(commonPrefixLength('abc', 'abcdef'), 3);
		assert.strictEqual(commonPrefixLength('abcdef', 'abc'), 3);
		assert.strictEqual(commonPrefixLength('abc', 'xyz'), 0);
		assert.strictEqual(commonPrefixLength('', 'abc'), 0);
		assert.strictEqual(commonPrefixLength('abc', ''), 0);
	});
});