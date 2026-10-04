import * as vscode from 'vscode';

export type LookBusySourceMode = 'auto' | 'workspace' | 'builtin';

export interface LookBusySettings {
	source: LookBusySourceMode;
	showStatusBarButton: boolean;
	ghostLinesAhead: number;
}

const MIN_GHOST_LINES_AHEAD = 1;
const MAX_GHOST_LINES_AHEAD = 20;

export function readSettings(scope?: vscode.ConfigurationScope): LookBusySettings {
	const config = vscode.workspace.getConfiguration('lookBusy', scope);

	return {
		source: config.get<LookBusySourceMode>('source', 'auto'),
		showStatusBarButton: config.get<boolean>('showStatusBarButton', true),
		ghostLinesAhead: clampNumber(
			config.get<number>('ghostLinesAhead', MIN_GHOST_LINES_AHEAD),
			MIN_GHOST_LINES_AHEAD,
			MAX_GHOST_LINES_AHEAD
		),
	};
}

function clampNumber(value: number, min: number, max: number): number {
	if (!Number.isFinite(value)) {
		return min;
	}

	return Math.min(max, Math.max(min, Math.floor(value)));
}