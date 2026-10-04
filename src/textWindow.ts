export interface TextWindow {
	start: number;
	end: number;
}

export function buildLineStarts(text: string): number[] {
	const starts = [0];

	for (let i = 0; i < text.length; i += 1) {
		if (text[i] === '\n') {
			starts.push(i + 1);
		}
	}

	if (starts[starts.length - 1] !== text.length) {
		starts.push(text.length);
	}

	return starts;
}

export function findLineForIndex(index: number, lineStarts: number[]): number {
	if (lineStarts.length <= 1) {
		return 0;
	}

	let low = 0;
	let high = lineStarts.length - 1;

	while (low < high) {
		const mid = Math.floor((low + high + 1) / 2);
		if (lineStarts[mid] <= index) {
			low = mid;
		} else {
			high = mid - 1;
		}
	}

	return Math.max(0, Math.min(low, lineStarts.length - 2));
}

export function buildMaskedTargetText(target: string, visibleEnd: number): string {
	if (visibleEnd >= target.length) {
		return target;
	}

	return target.slice(0, visibleEnd);
}

/**
 * The slice of `target` that stays materialised in the temporary document.
 *
 * `ghostLinesAhead` counts whole lines of upcoming code rendered past the cursor,
 * so 1 shows the remainder of the current line and 2 adds the line after it.
 * The window starts at the cursor's line so decoration scans never walk the
 * already typed portion of a large file.
 */
export function computeTextWindow(
	target: string,
	lineStarts: number[],
	index: number,
	ghostLinesAhead: number
): TextWindow {
	if (lineStarts.length === 0) {
		return { start: 0, end: 0 };
	}

	const currentLine = findLineForIndex(index, lineStarts);
	const linesAhead = Math.max(1, Math.floor(ghostLinesAhead));
	const endLine = Math.min(currentLine + linesAhead, lineStarts.length - 1);
	const start = lineStarts[currentLine] ?? 0;
	const end = lineStarts[endLine] ?? target.length;

	return {
		start,
		end: Math.max(start, end),
	};
}

export function commonPrefixLength(left: string, right: string): number {
	const max = Math.min(left.length, right.length);
	let index = 0;

	while (index < max && left[index] === right[index]) {
		index += 1;
	}

	return index;
}