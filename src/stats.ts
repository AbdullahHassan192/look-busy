export interface LookBusyStats {
	wpm: number;
}

export function calculateStats(totalChars: number, elapsedMs: number): LookBusyStats {
	const safeElapsedMs = Math.max(elapsedMs, 5000);
	const minutes = safeElapsedMs / 60000;
	const wpm = (totalChars / 5) / minutes;

	return {
		wpm,
	};
}

const SNARKY_SLOW = [
	'So slow? Seriously? You are definitely getting replaced by AI',
	'At this speed, Copilot will finish a sprint before you finish this line',
	'You type like you are being rate limited...',
];

const SNARKY_MID = [
	'Not bad. AI still looks concerned, but less concerned.',
	'Respectable speed. The AI takeover is paused... for now.',
	'You are coding fast enough to make AI feel a little insecure.',
];

const SNARKY_FAST = [
	'Okay, speed demon. AI just opened a notepad to keep up with you.',
	'Fast enough to make autocomplete feel optional.',
	'You type fast. AI just switched from leading to assisting.',
];

const SNARKY_VERY_FAST = [
	'Unfair pace. AI is asking you for coding tips now.',
	'Blazing. AI just filed a performance anxiety issue.',
	'At this speed, AI is your intern.',
];

export function getSnarkyComment(wpm: number, rng: () => number = Math.random): string {
	if (wpm < 30) {
		return pickRandom(SNARKY_SLOW, rng);
	}

	if (wpm < 55) {
		return pickRandom(SNARKY_MID, rng);
	}

	if (wpm < 85) {
		return pickRandom(SNARKY_FAST, rng);
	}

	return pickRandom(SNARKY_VERY_FAST, rng);
}

function pickRandom(options: string[], rng: () => number): string {
	const index = Math.floor(rng() * options.length);
	return options[Math.max(0, Math.min(index, options.length - 1))];
}
