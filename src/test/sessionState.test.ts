import * as assert from 'assert';
import {
	CharStatus,
	getTabEquivalentIndentationLength,
	normalizeTypedText,
	SessionState,
} from '../sessionState';

suite('Session State', () => {
	test('Prefills the header and marks text past the typing range as typed', () => {
		const text = "import path from 'path';\n\nconst value = 1;";
		const state = new SessionState(text, 20, text.length);

		assert.strictEqual(state.index, 20);
		assert.strictEqual(state.typingStart, 20);
		assert.strictEqual(state.typingEnd, text.length);
		assert.strictEqual(state.statusAt(0), CharStatus.Typed);
		assert.strictEqual(state.statusAt(19), CharStatus.Typed);
		assert.strictEqual(state.statusAt(20), CharStatus.Untyped);
		assert.strictEqual(state.typedCharacters, 0);
		assert.strictEqual(state.isComplete, false);
	});

	test('Clamps out of range bounds into the target', () => {
		const state = new SessionState('abc', -5, 99);

		assert.strictEqual(state.typingStart, 0);
		assert.strictEqual(state.typingEnd, 3);
		assert.strictEqual(state.index, 0);
	});

	test('Never lets typingEnd fall behind typingStart', () => {
		const state = new SessionState('abcdef', 4, 1);

		assert.strictEqual(state.typingEnd, 4);
		assert.strictEqual(state.index, 4);
		// An empty typing range is complete the moment the session opens.
		assert.strictEqual(state.isComplete, true);
	});

	test('Consuming matching characters advances to completion', () => {
		const state = new SessionState('abc', 0, 3);
		state.consume('abc');

		assert.strictEqual(state.index, 3);
		assert.strictEqual(state.isComplete, true);
		assert.strictEqual(state.typedCharacters, 3);
		assert.strictEqual(state.totalKeystrokes, 3);
		assert.strictEqual(state.errorKeystrokes, 0);
		assert.strictEqual(state.backspaceCount, 0);
	});

	test('A wrong character marks an error without advancing', () => {
		const state = new SessionState('abc', 0, 3);
		state.consume('ax');

		assert.strictEqual(state.index, 1);
		assert.strictEqual(state.statusAt(1), CharStatus.Error);
		assert.strictEqual(state.typedCharacters, 1);
		assert.strictEqual(state.errorKeystrokes, 1);
		assert.strictEqual(state.totalKeystrokes, 2);
	});

	test('Typing the expected character clears the pending error and advances', () => {
		const state = new SessionState('abc', 0, 3);
		state.consume('ax');
		state.consume('bc');

		assert.strictEqual(state.index, 3);
		assert.strictEqual(state.isComplete, true);
		assert.strictEqual(state.statusAt(1), CharStatus.Typed);
		assert.strictEqual(state.typedCharacters, 3);
		assert.strictEqual(state.errorKeystrokes, 1);
	});

	test('Backspace clears an uncorrected error without rewinding', () => {
		const state = new SessionState('abc', 0, 3);
		state.consume('ax');
		state.backspace();

		assert.strictEqual(state.index, 1);
		assert.strictEqual(state.statusAt(1), CharStatus.Untyped);
		assert.strictEqual(state.typedCharacters, 1);
		assert.strictEqual(state.backspaceCount, 1);
	});

	test('Backspace rewinds one typed character and un-counts it', () => {
		const state = new SessionState('abcd', 0, 4);
		state.consume('abc');
		assert.strictEqual(state.typedCharacters, 3);

		state.backspace();

		assert.strictEqual(state.index, 2);
		assert.strictEqual(state.statusAt(2), CharStatus.Untyped);
		assert.strictEqual(state.typedCharacters, 2);
	});

	test('Backspace stops at the typing start', () => {
		const state = new SessionState('abcdef', 3, 6);
		state.consume('def');
		assert.strictEqual(state.index, 6);
		assert.strictEqual(state.isComplete, true);

		state.backspace();
		assert.strictEqual(state.index, 5);
		state.backspace();
		assert.strictEqual(state.index, 4);
		state.backspace();
		assert.strictEqual(state.index, 3);
		state.backspace();
		assert.strictEqual(state.index, 3);
		assert.strictEqual(state.typedCharacters, 0);
	});

	test('Typed character count never goes negative', () => {
		const state = new SessionState('ab', 0, 2);
		state.backspace();
		state.backspace();

		assert.strictEqual(state.typedCharacters, 0);
		assert.strictEqual(state.index, 0);
	});

	test('Leading indentation is auto-filled and excluded from the typed count', () => {
		const text = 'a\n    b';
		const state = new SessionState(text, 0, text.length);
		state.consume('a\n');

		assert.strictEqual(state.index, 6);
		assert.strictEqual(state.typedCharacters, 2);
		assert.strictEqual(state.statusAt(2), CharStatus.Typed);
		assert.strictEqual(state.isAutoFilledAt(2), true);
		assert.strictEqual(state.statusAt(5), CharStatus.Typed);
		assert.strictEqual(state.isAutoFilledAt(5), true);

		state.consume('b');

		assert.strictEqual(state.isComplete, true);
		assert.strictEqual(state.typedCharacters, 3);
	});

	test('One backspace rewinds a whole auto-filled indentation block plus the newline before it', () => {
		const text = 'a\n    b';
		const state = new SessionState(text, 0, text.length);
		state.consume('a\n');
		state.backspace();

		assert.strictEqual(state.index, 1);
		assert.strictEqual(state.typedCharacters, 1);
		assert.strictEqual(state.statusAt(2), CharStatus.Untyped);
	});

	test('A tab fills up to four columns of pending indentation', () => {
		const text = '        x';
		const state = new SessionState(text, 0, text.length);
		state.consume('\t');

		assert.strictEqual(state.index, 4);
		assert.strictEqual(state.typedCharacters, 1);
		assert.strictEqual(state.isAutoFilledAt(1), true);
		assert.strictEqual(state.isAutoFilledAt(3), true);
	});

	test('A tab is swallowed when it does not stand in for indentation', () => {
		const state = new SessionState('const value = 1;', 0, 16);
		state.consume('const ');
		state.consume('\t');

		assert.strictEqual(state.index, 6);
		assert.strictEqual(state.totalKeystrokes, 7);
		assert.strictEqual(state.errorKeystrokes, 0);
	});

	test('Consuming stops at the typing end even when more text arrives', () => {
		const state = new SessionState('abc', 0, 2);
		state.consume('abc');

		assert.strictEqual(state.index, 2);
		assert.strictEqual(state.typedCharacters, 2);
		assert.strictEqual(state.totalKeystrokes, 2);
	});

	test('Surrogate pairs stay aligned with target offsets', () => {
		const text = 'const emoji = "\u{1F600}";';
		const state = new SessionState(text, 0, text.length);
		state.consume(text);

		assert.strictEqual(state.isComplete, true);
		assert.strictEqual(state.typedCharacters, text.length);
		assert.strictEqual(state.errorKeystrokes, 0);
	});

	test('Typing before the typing start does not move the cursor', () => {
		const state = new SessionState('header\nbody', 7, 11);
		state.consume('header\nbody');

		assert.strictEqual(state.index, 11);
		assert.strictEqual(state.isComplete, true);
	});

	test('Reports typing progress separately from recorded keystrokes', () => {
		const wrong = new SessionState('abc', 0, 3);
		wrong.consume('ax');
		assert.strictEqual(wrong.hasTypedAnything, true);
		assert.strictEqual(wrong.hasRecordedKeystrokes, true);

		const onlyErrors = new SessionState('abc', 0, 3);
		onlyErrors.consume('x');
		assert.strictEqual(onlyErrors.hasTypedAnything, false);
		assert.strictEqual(onlyErrors.hasRecordedKeystrokes, true);

		const fresh = new SessionState('abc', 0, 3);
		assert.strictEqual(fresh.hasTypedAnything, false);
		assert.strictEqual(fresh.hasRecordedKeystrokes, false);
		assert.strictEqual(fresh.activeElapsedMs, 0);
	});

	test('Idle gaps are clamped and trailing time is capped', () => {
		let now = 1000;
		const state = new SessionState('abcdef', 0, 6, { now: () => now });

		state.recordKeystroke();
		assert.strictEqual(state.activeElapsedMs, 0);

		now = 1300;
		assert.strictEqual(state.activeElapsedMs, 300);

		now = 6300;
		state.recordKeystroke();
		assert.strictEqual(state.activeElapsedMs, 2500);

		now = 6400;
		assert.strictEqual(state.activeElapsedMs, 2600);

		now = 11400;
		assert.strictEqual(state.activeElapsedMs, 3500);
	});

	test('Every consumed character records a keystroke', () => {
		const state = new SessionState('abcd', 0, 4);
		state.consume('ax');
		state.backspace();
		state.consume('bcd');

		assert.strictEqual(state.totalKeystrokes, 6);
		assert.strictEqual(state.errorKeystrokes, 1);
		assert.strictEqual(state.backspaceCount, 1);
	});
});

suite('Typed Text Normalisation', () => {
	test('Collapses CRLF and lone CR into newlines', () => {
		assert.strictEqual(normalizeTypedText('a\r\nb\rc\nd'), 'a\nb\nc\nd');
	});

	test('A normalised newline satisfies a newline target', () => {
		const state = new SessionState('a\nb', 0, 3);
		state.consume(normalizeTypedText('a\r\nb'));

		assert.strictEqual(state.isComplete, true);
	});
});

suite('Tab Equivalent Indentation', () => {
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

	test('Caps consumption at four columns', () => {
		const target = '        deep';
		assert.strictEqual(getTabEquivalentIndentationLength(target, 0, target.length), 4);
	});

	test('Refuses to consume across a newline', () => {
		const target = '    \nnext';
		assert.strictEqual(getTabEquivalentIndentationLength(target, 4, target.length), 0);
	});
});