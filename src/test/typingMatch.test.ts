import * as assert from 'assert';
import { getTabEquivalentIndentationLength } from '../lookBusyController';

suite('Typing Match Helpers', () => {
	test('Treats tab as leading indentation spaces', () => {
		const target = '    const value = 1;';
		const consumed = getTabEquivalentIndentationLength(target, 0, target.length);
		assert.strictEqual(consumed, 4);
	});

	test('Does not consume tab equivalence outside indentation', () => {
		const target = 'const value =    1;';
		const index = target.indexOf('    ');
		const consumed = getTabEquivalentIndentationLength(target, index, target.length);
		assert.strictEqual(consumed, 0);
	});
});
