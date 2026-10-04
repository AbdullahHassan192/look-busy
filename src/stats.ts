export interface LookBusyStatsOptions {
	totalKeystrokes?: number;
	errors?: number;
	backspaces?: number;
	minElapsedMs?: number;
}

export interface LookBusyStats {
	wpm: number;
	rawWpm: number;
	accuracy: number;
	totalKeystrokes: number;
	errors: number;
	backspaces: number;
}

export function calculateStats(
	totalChars: number,
	elapsedMs: number,
	options: LookBusyStatsOptions = {}
): LookBusyStats {
	const minElapsed = options.minElapsedMs ?? 5000;
	const safeElapsedMs = Math.max(elapsedMs, minElapsed);
	const minutes = safeElapsedMs / 60000;

	const errors = options.errors ?? 0;
	const backspaces = options.backspaces ?? 0;
	const totalKeystrokes = options.totalKeystrokes ?? totalChars;
	const correctKeystrokes = Math.max(0, totalKeystrokes - errors);

	const wpm = minutes > 0 && totalChars > 0 ? (totalChars / 5) / minutes : 0;
	const rawWpm = minutes > 0 && totalKeystrokes > 0 ? (totalKeystrokes / 5) / minutes : 0;

	const accuracy = totalKeystrokes > 0
		? Math.max(0, Math.min(100, Math.round((correctKeystrokes / totalKeystrokes) * 100)))
		: 100;

	return {
		wpm,
		rawWpm,
		accuracy,
		totalKeystrokes,
		errors,
		backspaces,
	};
}

const SNARKY_SLOW = [
	'So slow? Seriously? You are definitely getting replaced by AI',
	'At this speed, Copilot will finish a sprint before you finish this line',
	'Claude drafted a full microservice while you hunted for that semicolon.',
	'ChatGPT is getting bored watching your cursor blink.',
	'Gemini already finished the sprint and took a nap.',
	'Grok is roasting your keystroke frequency in real time.',
	'You type like you are being rate limited on a free tier.',
	'Claude Sonnet could have rewritten this repo twice by now.',
	'Your manager just asked ChatGPT if your keyboard is broken.',
	'Gemini timed out waiting for your next keystroke.',
	'Even dial-up AI was faster than this.',
	'ChatGPT is drafting a post-mortem on your typing speed.',
	'At this pace, AI will take your job before you close that bracket.',
	'Claude wonders if you are typing with oven mitts on.',
	'AI is not worried about job security today.',
	'You type like you are being rate limited...',
];

const SNARKY_MID = [
	'Not bad. AI still looks concerned, but less concerned.',
	'Respectable speed. The AI takeover is paused... for now.',
	'You are coding fast enough to make AI feel a little insecure.',
	'ChatGPT nods politely. It could do faster, but appreciates the effort.',
	'Claude considers you a worthy sparring partner. For a human.',
	'Gemini has not intervened yet, which counts as high praise.',
	'Grok rates this typing speed as thoroughly mid.',
	'Fast enough to look productive on screen shares.',
	'Copilot is sitting back and letting you cook for once.',
	'Solid tempo. AI is hovering over the suggest button just in case.',
	'You are keeping up with Claude Haiku. Next stop: Sonnet.',
	'Human dignity maintained. AI has postponed replacement plans.',
	'Decent pace. The cursor is actually moving forward.',
	'ChatGPT gives this typing effort a solid 3.5 out of 5.',
	'You look reasonably busy. Management is convinced.',
];

const SNARKY_FAST = [
	'Okay, speed demon. AI just opened a notepad to keep up with you.',
	'Fast enough to make autocomplete feel optional.',
	'You type fast. AI just switched from leading to assisting.',
	'Claude is actively taking notes on your prompt-free workflow.',
	'ChatGPT just asked if you want to be its senior developer.',
	'Gemini disabled ghost text because you type over it anyway.',
	'Grok checked your telemetry to verify you are flesh and bone.',
	'Copilot cannot suggest completions fast enough to beat your fingers.',
	'Your fingers cache keystrokes faster than the LSP can index.',
	'Claude filed a ticket complaining that your typing pace is hostile.',
	'Look at you actually typing instead of hitting tab on suggestions.',
	'The AI is getting nervous. You might not need it after all.',
	'Impressive cadence. ChatGPT dimmed its screen in deference.',
	'Keyboard smoking, AI sweating. You are in the zone.',
];

const SNARKY_VERY_FAST = [
	'Unfair pace. AI is asking you for coding tips now.',
	'Blazing. AI just filed a performance anxiety issue.',
	'At this speed, AI is your intern.',
	'Claude just offered you a job writing synthetic training data.',
	'ChatGPT cannot even stream tokens this fast.',
	'Gemini thinks your mechanical keyboard is a hardware accelerator.',
	'Grok suspects you are an AI pretending to be a human pretending to look busy.',
	'Are you secretly an LLM running on local hardware?',
	'Copilot gave up and closed its side panel.',
	'You just out-tokenized Claude Sonnet during peak hours.',
	'Your typing speed caused a spike in AI server latency.',
	'AI is asking you for an API key now.',
	'Pure mechanical dominance. Silicon has lost today.',
	'You are not just looking busy. You made the entire GPU cluster look slow.',
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
