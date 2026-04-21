import * as assert from 'assert';
import { calculateStats, getSnarkyComment } from '../stats';

suite('Stats Helpers', () => {
	test('Calculates WPM', () => {
		const stats = calculateStats(250, 60000);

		assert.strictEqual(stats.wpm, 50);
	});

	test('Applies minimum elapsed floor to avoid unrealistic spikes', () => {
		const stats = calculateStats(250, 500);
		assert.strictEqual(stats.wpm, 600);
	});

	test('Uses slow-speed snarky comments', () => {
		assert.strictEqual(
			getSnarkyComment(20, () => 0),
			'So slow? Seriously? You are definitely getting replaced by AI.'
		);
	});

	test('Uses middle-speed snarky comments', () => {
		assert.strictEqual(
			getSnarkyComment(45, () => 0),
			'Not bad. AI still looks concerned, but less concerned.'
		);
	});

	test('Uses fast-speed snarky comments', () => {
		assert.strictEqual(
			getSnarkyComment(70, () => 0),
			'Okay, speed demon. AI just opened a notepad to keep up with you.'
		);
	});

	test('Uses very-fast snarky comments', () => {
		assert.strictEqual(
			getSnarkyComment(95, () => 0),
			'Unfair pace. AI is asking you for coding tips now.'
		);
	});

	test('Random selection can return later comment in band', () => {
		assert.strictEqual(
			getSnarkyComment(20, () => 0.99),
			'You type like you are negotiating each character with AI.'
		);
	});
});
