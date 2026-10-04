import { buildLineStarts } from './textWindow';

export const CharStatus = {
	Untyped: 0,
	Typed: 1,
	Error: 2,
} as const;

export type CharStatusValue = (typeof CharStatus)[keyof typeof CharStatus];

export interface SessionStateOptions {
	now?: () => number;
	maxIdlePauseMs?: number;
	maxTrailingMs?: number;
}

const DEFAULT_MAX_IDLE_PAUSE_MS = 2500;
const DEFAULT_MAX_TRAILING_MS = 1000;
const MAX_TAB_EQUIVALENT_WIDTH = 4;

export function normalizeTypedText(text: string): string {
	return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

export function getTabEquivalentIndentationLength(target: string, index: number, typingEnd: number): number {
	if (index < 0 || index >= typingEnd || target[index] === '\n') {
		return 0;
	}

	const lineStart = target.lastIndexOf('\n', index - 1) + 1;
	for (let i = lineStart; i < index; i += 1) {
		const previousCharacter = target[i];
		if (previousCharacter !== ' ' && previousCharacter !== '\t') {
			return 0;
		}
	}

	let consumed = 0;
	while (index + consumed < typingEnd && consumed < MAX_TAB_EQUIVALENT_WIDTH) {
		const expectedCharacter = target[index + consumed];
		if (expectedCharacter !== ' ' && expectedCharacter !== '\t') {
			break;
		}
		consumed += 1;
	}

	return consumed;
}

export function clampIndex(index: number, length: number): number {
	if (index < 0) {
		return 0;
	}

	if (index > length) {
		return length;
	}

	return index;
}

/**
 * The pure typing state machine behind a session: which characters are filled,
 * which are wrong, how far the cursor has advanced, and the keystroke timings
 * that feed the WPM readout. It has no VS Code dependency so the tricky parts
 * (indentation, backspace rollback, timing floors) are directly testable.
 */
export class SessionState {
	public readonly target: string;
	public readonly typingStart: number;
	public readonly typingEnd: number;
	public readonly lineStarts: number[];
	public index: number;
	public totalKeystrokes = 0;
	public errorKeystrokes = 0;
	public backspaceCount = 0;

	private readonly statuses: CharStatusValue[];
	private readonly autoFilled: boolean[];
	private typedCount = 0;
	private startedAt: number | undefined;
	private lastKeystrokeAt: number | undefined;
	private accumulatedActiveMs = 0;
	private readonly now: () => number;
	private readonly maxIdlePauseMs: number;
	private readonly maxTrailingMs: number;

	public constructor(target: string, typingStart: number, typingEnd: number, options: SessionStateOptions = {}) {
		this.target = target;
		this.typingStart = clampIndex(typingStart, target.length);
		this.typingEnd = clampIndex(Math.max(typingEnd, this.typingStart), target.length);
		this.index = this.typingStart;
		this.lineStarts = buildLineStarts(target);
		this.statuses = Array.from({ length: target.length }, () => CharStatus.Untyped);
		this.autoFilled = Array.from({ length: target.length }, () => false);
		this.now = options.now ?? Date.now;
		this.maxIdlePauseMs = options.maxIdlePauseMs ?? DEFAULT_MAX_IDLE_PAUSE_MS;
		this.maxTrailingMs = options.maxTrailingMs ?? DEFAULT_MAX_TRAILING_MS;

		for (let i = 0; i < this.typingStart; i += 1) {
			this.statuses[i] = CharStatus.Typed;
		}

		for (let i = this.typingEnd; i < this.statuses.length; i += 1) {
			this.statuses[i] = CharStatus.Typed;
		}
	}

	public get isComplete(): boolean {
		return this.index >= this.typingEnd;
	}

	public get typedCharacters(): number {
		return this.typedCount;
	}

	public get hasTypedAnything(): boolean {
		return this.typedCount > 0;
	}

	public get hasRecordedKeystrokes(): boolean {
		return this.startedAt !== undefined;
	}

	public get activeElapsedMs(): number {
		if (this.startedAt === undefined || this.lastKeystrokeAt === undefined) {
			return 0;
		}

		const trailingDelta = Math.max(this.now() - this.lastKeystrokeAt, 0);
		return this.accumulatedActiveMs + Math.min(trailingDelta, this.maxTrailingMs);
	}

	public statusAt(index: number): CharStatusValue {
		return this.statuses[index];
	}

	public isAutoFilledAt(index: number): boolean {
		return this.autoFilled[index];
	}

	public recordKeystroke(): void {
		const now = this.now();
		if (this.startedAt === undefined) {
			this.startedAt = now;
			this.lastKeystrokeAt = now;
			this.accumulatedActiveMs = 0;
			return;
		}

		if (this.lastKeystrokeAt !== undefined) {
			const delta = Math.max(now - this.lastKeystrokeAt, 0);
			this.accumulatedActiveMs += Math.min(delta, this.maxIdlePauseMs);
			this.lastKeystrokeAt = now;
		}
	}

	/**
	 * Advances over `text`, which is assumed to already be newline normalised.
	 *
	 * Iteration is by UTF-16 code unit rather than code point so surrogate pairs
	 * stay aligned with `target` offsets; iterating by code point would make any
	 * file containing an astral character impossible to complete.
	 */
	public consume(text: string): void {
		for (let cursor = 0; cursor < text.length; cursor += 1) {
			if (this.index >= this.typingEnd) {
				break;
			}

			const character = text[cursor];
			this.recordKeystroke();
			this.totalKeystrokes += 1;

			if (character === this.target[this.index]) {
				this.markTyped(this.index);
				this.index += 1;
				this.applyAutomaticIndentation();
				continue;
			}

			const tabEquivalentLength = this.consumeTabEquivalentIndentation(character);
			if (tabEquivalentLength > 0) {
				this.markTyped(this.index);
				for (let offset = 1; offset < tabEquivalentLength; offset += 1) {
					this.markAutoFilled(this.index + offset);
				}
				this.index += tabEquivalentLength;
				this.applyAutomaticIndentation();
				continue;
			}

			if (character === '\t') {
				continue;
			}

			this.errorKeystrokes += 1;
			this.statuses[this.index] = CharStatus.Error;
			this.autoFilled[this.index] = false;
		}
	}

	public backspace(): void {
		this.recordKeystroke();
		this.backspaceCount += 1;
		this.totalKeystrokes += 1;

		if (this.index <= this.typingStart) {
			return;
		}

		if (this.index < this.typingEnd && this.statuses[this.index] === CharStatus.Error) {
			this.clearStatus(this.index);
			return;
		}

		while (this.index > this.typingStart && this.autoFilled[this.index - 1]) {
			this.index -= 1;
			this.clearStatus(this.index);
		}

		if (this.index > this.typingStart) {
			this.index -= 1;
			this.clearStatus(this.index);
		}
	}

	public consumeTabEquivalentIndentation(inputCharacter: string): number {
		if (inputCharacter !== '\t') {
			return 0;
		}

		return getTabEquivalentIndentationLength(this.target, this.index, this.typingEnd);
	}

	public applyAutomaticIndentation(): void {
		const atLineStart = this.index === 0 || this.target[this.index - 1] === '\n';
		if (!atLineStart) {
			return;
		}

		while (this.index < this.typingEnd) {
			const character = this.target[this.index];
			if (character !== ' ' && character !== '\t') {
				break;
			}

			this.markAutoFilled(this.index);
			this.index += 1;
		}
	}

	private markTyped(index: number): void {
		if (this.statuses[index] !== CharStatus.Typed) {
			this.typedCount += 1;
		}

		this.statuses[index] = CharStatus.Typed;
		this.autoFilled[index] = false;
	}

	private markAutoFilled(index: number): void {
		this.statuses[index] = CharStatus.Typed;
		this.autoFilled[index] = true;
	}

	private clearStatus(index: number): void {
		if (this.statuses[index] === CharStatus.Typed && !this.autoFilled[index]) {
			this.typedCount = Math.max(0, this.typedCount - 1);
		}

		this.statuses[index] = CharStatus.Untyped;
		this.autoFilled[index] = false;
	}
}