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

	test('Returns 0 WPM and 100% accuracy when no characters typed', () => {
		const stats = calculateStats(0, 10000);
		assert.strictEqual(stats.wpm, 0);
		assert.strictEqual(stats.rawWpm, 0);
		assert.strictEqual(stats.accuracy, 100);
	});

	test('Calculates accuracy and raw WPM with error tracking', () => {
		const stats = calculateStats(90, 60000, {
			totalKeystrokes: 100,
			errors: 10,
			backspaces: 5,
		});

		assert.strictEqual(stats.wpm, 18);
		assert.strictEqual(stats.rawWpm, 20);
		assert.strictEqual(stats.accuracy, 90);
		assert.strictEqual(stats.errors, 10);
		assert.strictEqual(stats.backspaces, 5);
	});

	test('Respects custom minimum elapsed floor', () => {
		const stats = calculateStats(100, 1000, { minElapsedMs: 1000 });
		// 100 chars / 5 = 20 words. 1000ms = 1/60 min. 20 / (1/60) = 1200 WPM
		assert.strictEqual(stats.wpm, 1200);
	});

	test('Uses slow-speed snarky comments', () => {
		assert.strictEqual(
			getSnarkyComment(20, () => 0),
			'So slow? Seriously? You are definitely getting replaced by AI'
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
			'You type like you are being rate limited...'
		);
	});
});
