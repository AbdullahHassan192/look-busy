import * as path from 'path';
import * as vscode from 'vscode';
import { LANGUAGE_SNIPPET_PACKS, type LanguageSnippetPack } from './generatedSnippets';

export interface SourceContent {
	text: string;
	languageId: string;
	extension: string;
	typingStart: number;
	typingEnd: number;
}

export interface FullFileTypingBounds {
	typingStart: number;
	typingEnd: number;
}

export interface GitignoreRule {
	negated: boolean;
	regex: RegExp;
}

interface WorkspaceGitignoreMatcher {
	folderUri: vscode.Uri;
	rules: GitignoreRule[];
}

const EXTRA_WORKSPACE_EXTENSIONS = [
	'php',
	'rb',
	'swift',
	'kt',
	'scala',
	'sql',
	'sh',
	'md',
];

const CANDIDATE_EXTENSIONS = Array.from(
	new Set([
		...LANGUAGE_SNIPPET_PACKS.flatMap((pack: LanguageSnippetPack) => pack.workspaceExtensions),
		...EXTRA_WORKSPACE_EXTENSIONS,
	])
);

const DEFAULT_IGNORED_DIRECTORIES = new Set([
	'.git',
	'.vscode',
	'.idea',
	'.venv',
	'venv',
	'env',
	'node',
	'node_modules',
	'dist',
	'out',
	'coverage',
	'build',
	'.next',
	'target',
	'bin',
	'obj',
	'vendor',
	'.turbo',
	'__pycache__',
	'.pytest_cache',
	'.mypy_cache',
	'.tox',
	'.pnpm-store',
	'.yarn',
	'.cache',
]);

const IMPORT_PATTERNS: RegExp[] = [
	/^\s*import\b/i,
	/^\s*from\b.+\bimport\b/i,
	/^\s*#include\b/i,
	/^\s*using\s+namespace\b/i,
	/^\s*package\s+[^;]+;\s*$/i,
	/^\s*namespace\s+[^;{]+;\s*$/i,
	/^\s*const\s+\w+\s*=\s*require\(/i,
	/^\s*export\s+\{.*\}\s+from\b/i,
];

const MID_FILE_START_PROBABILITY = 0.5;
const MIN_CHARACTERS_FOR_MID_FILE_START = 180;
const MIN_OFFSET_FROM_BASE_START = 60;
const MID_FILE_WINDOW_RATIO = 0.2;

export async function getWorkspaceSource(): Promise<SourceContent | undefined> {
	return getWorkspaceSnippet();
}

export function inferLanguageFromPath(filePath: string): Pick<SourceContent, 'languageId' | 'extension'> {
	const extension = path.extname(filePath).toLowerCase();

	switch (extension) {
		case '.ts':
			return { languageId: 'typescript', extension: '.ts' };
		case '.tsx':
			return { languageId: 'typescriptreact', extension: '.tsx' };
		case '.js':
			return { languageId: 'javascript', extension: '.js' };
		case '.jsx':
			return { languageId: 'javascriptreact', extension: '.jsx' };
		case '.py':
			return { languageId: 'python', extension: '.py' };
		case '.go':
			return { languageId: 'go', extension: '.go' };
		case '.rs':
			return { languageId: 'rust', extension: '.rs' };
		case '.java':
			return { languageId: 'java', extension: '.java' };
		case '.cpp':
		case '.cc':
		case '.cxx':
		case '.hpp':
		case '.h':
			return { languageId: 'cpp', extension: '.cpp' };
		case '.c':
			return { languageId: 'c', extension: '.c' };
		case '.cs':
			return { languageId: 'csharp', extension: '.cs' };
		case '.php':
			return { languageId: 'php', extension: '.php' };
		case '.rb':
			return { languageId: 'ruby', extension: '.rb' };
		case '.swift':
			return { languageId: 'swift', extension: '.swift' };
		case '.kt':
			return { languageId: 'kotlin', extension: '.kt' };
		case '.scala':
			return { languageId: 'scala', extension: '.scala' };
		case '.sql':
			return { languageId: 'sql', extension: '.sql' };
		case '.sh':
			return { languageId: 'shellscript', extension: '.sh' };
		case '.md':
			return { languageId: 'markdown', extension: '.md' };
		default:
			return { languageId: 'plaintext', extension: '.txt' };
	}
}

async function getWorkspaceSnippet(): Promise<SourceContent | undefined> {
	if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
		void vscode.window.showWarningMessage('Open a workspace to start a Look Busy coding session.');
		return undefined;
	}

	const include = `**/*.{${CANDIDATE_EXTENSIONS.join(',')}}`;
	const exclude = '**/{node,node_modules,.git,.vscode,.idea,.venv,venv,env,dist,out,coverage,build,.next,target,bin,obj,vendor,.turbo,__pycache__,.pytest_cache,.mypy_cache,.tox,.pnpm-store,.yarn,.cache}/**';
	const files = await vscode.workspace.findFiles(include, exclude, 2000);

	if (files.length === 0) {
		void vscode.window.showWarningMessage('No supported workspace files were found for a Look Busy session.');
		return undefined;
	}

	const gitignoreMatchers = await loadWorkspaceGitignoreMatchers();
	const activeUri = vscode.window.activeTextEditor?.document.uri;
	if (
		activeUri &&
		isWorkspaceCandidateUri(activeUri) &&
		!isUriInDefaultIgnoredDirectory(activeUri) &&
		!isUriIgnoredByWorkspaceGitignore(activeUri, gitignoreMatchers)
	) {
		const activeSource = await buildSourceFromFile(activeUri);
		if (activeSource) {
			return activeSource;
		}
	}

	const eligibleFiles = files.filter(
		(file) => !isUriInDefaultIgnoredDirectory(file) && !isUriIgnoredByWorkspaceGitignore(file, gitignoreMatchers)
	);
	if (eligibleFiles.length === 0) {
		void vscode.window.showWarningMessage('All supported workspace files are excluded by .gitignore.');
		return undefined;
	}

	const prioritizedFiles = prioritizeWorkspaceFiles(eligibleFiles, activeUri);
	for (const selectedFile of prioritizedFiles.slice(0, 200)) {
		const source = await buildSourceFromFile(selectedFile);
		if (source) {
			return source;
		}
	}

	void vscode.window.showWarningMessage('Could not find a good workspace code block to practice typing.');
	return undefined;
}

async function buildSourceFromFile(file: vscode.Uri): Promise<SourceContent | undefined> {
	const bytes = await vscode.workspace.fs.readFile(file);
	if (bytes.byteLength > 200_000) {
		return undefined;
	}

	const text = stripLeadingBom(new TextDecoder('utf-8').decode(bytes));
	if (isLowSignalWorkspaceFile(file, text)) {
		return undefined;
	}

	const language = inferLanguageFromPath(file.fsPath);
	return buildFullFileSource(text, language.languageId, language.extension);
}

function prioritizeWorkspaceFiles(files: vscode.Uri[], activeUri: vscode.Uri | undefined): vscode.Uri[] {
	const activeFilePath = activeUri?.fsPath;
	const decorated = files.map((uri) => ({
		uri,
		score: scoreWorkspaceFilePath(uri.fsPath, activeFilePath),
	}));

	decorated.sort((a, b) => {
		if (b.score !== a.score) {
			return b.score - a.score;
		}
		return a.uri.fsPath.localeCompare(b.uri.fsPath);
	});

	return decorated.map((entry) => entry.uri);
}

function isWorkspaceCandidateUri(uri: vscode.Uri): boolean {
	if (uri.scheme !== 'file') {
		return false;
	}

	const extension = path.extname(uri.fsPath).toLowerCase();
	const normalized = extension.startsWith('.') ? extension.slice(1) : extension;
	return CANDIDATE_EXTENSIONS.includes(normalized);
}

export function isPathInDefaultIgnoredDirectory(filePath: string): boolean {
	const normalizedPath = filePath.replace(/\\/g, '/').toLowerCase();
	const segments = normalizedPath.split('/').filter((segment) => segment.length > 0);
	for (const segment of segments) {
		if (DEFAULT_IGNORED_DIRECTORIES.has(segment)) {
			return true;
		}
	}

	return false;
}

export function scoreWorkspaceFilePath(filePath: string, activeFilePath: string | undefined): number {
	const lowerPath = filePath.toLowerCase();
	const normalizedPath = lowerPath.replace(/\\/g, '/');
	let score = 0;

	if (activeFilePath && activeFilePath.toLowerCase() === lowerPath) {
		score += 1000;
	}

	if (activeFilePath) {
		const activeDir = path.dirname(activeFilePath).toLowerCase();
		if (lowerPath.startsWith(activeDir)) {
			score += 120;
		}
	}

	if (normalizedPath.includes('/src/') || normalizedPath.includes('/app/') || normalizedPath.includes('/lib/')) {
		score += 60;
	}

	if (lowerPath.endsWith('.d.ts') || lowerPath.includes('.min.') || lowerPath.includes('.generated.')) {
		score -= 200;
	}

	if (normalizedPath.includes('/test/') || normalizedPath.includes('/__tests__/') || lowerPath.includes('.spec.')) {
		score -= 40;
	}

	return score;
}

async function loadWorkspaceGitignoreMatchers(): Promise<WorkspaceGitignoreMatcher[]> {
	if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
		return [];
	}

	const matchers: WorkspaceGitignoreMatcher[] = [];
	for (const folder of vscode.workspace.workspaceFolders) {
		const gitignoreUri = vscode.Uri.joinPath(folder.uri, '.gitignore');
		const content = await readWorkspaceTextFile(gitignoreUri);
		if (!content) {
			continue;
		}

		const rules = parseGitignoreRules(content);
		if (rules.length === 0) {
			continue;
		}

		matchers.push({
			folderUri: folder.uri,
			rules,
		});
	}

	return matchers;
}

async function readWorkspaceTextFile(uri: vscode.Uri): Promise<string | undefined> {
	try {
		const bytes = await vscode.workspace.fs.readFile(uri);
		return new TextDecoder('utf-8').decode(bytes);
	} catch {
		return undefined;
	}
}

export function parseGitignoreRules(content: string): GitignoreRule[] {
	const lines = content.replace(/\r\n/g, '\n').split('\n');
	const rules: GitignoreRule[] = [];

	for (let rawLine of lines) {
		if (!rawLine) {
			continue;
		}

		rawLine = rawLine.trim();
		if (rawLine.length === 0 || rawLine.startsWith('#')) {
			continue;
		}

		let negated = false;
		if (rawLine.startsWith('!')) {
			negated = true;
			rawLine = rawLine.slice(1);
		}

		const normalized = rawLine.replace(/\\/g, '/').replace(/^\.\/+/, '');
		const compiled = compileGitignorePattern(normalized);
		if (!compiled) {
			continue;
		}

		rules.push({
			negated,
			regex: compiled,
		});
	}

	return rules;
}

export function isRelativePathIgnoredByGitignore(relativePath: string, rules: GitignoreRule[]): boolean {
	const normalizedPath = relativePath.replace(/\\/g, '/');
	let ignored = false;
	for (const rule of rules) {
		if (rule.regex.test(normalizedPath)) {
			ignored = !rule.negated;
		}
	}

	return ignored;
}

function compileGitignorePattern(pattern: string): RegExp | undefined {
	if (!pattern) {
		return undefined;
	}

	const rooted = pattern.startsWith('/');
	const directoryOnly = pattern.endsWith('/');
	const cleaned = pattern.replace(/^\/+/, '').replace(/\/+$/, '');
	if (!cleaned) {
		return undefined;
	}

	const hasSlash = cleaned.includes('/');
	const body = globToRegexBody(cleaned);
	const prefix = rooted ? '^' : hasSlash ? '^(?:.*\\/)?' : '^(?:.*\\/)?';
	const suffix = directoryOnly ? '(?:\\/.*)?$' : '$';
	const flags = process.platform === 'win32' ? 'i' : '';
	return new RegExp(`${prefix}${body}${suffix}`, flags);
}

function globToRegexBody(pattern: string): string {
	let output = '';
	for (let i = 0; i < pattern.length; i += 1) {
		const character = pattern[i];
		const next = pattern[i + 1];

		if (character === '*' && next === '*') {
			output += '.*';
			i += 1;
			continue;
		}

		if (character === '*') {
			output += '[^/]*';
			continue;
		}

		if (character === '?') {
			output += '[^/]';
			continue;
		}

		output += escapeRegexCharacter(character);
	}

	return output;
}

function escapeRegexCharacter(character: string): string {
	if (/[[\]{}()*+?.\\^$|]/.test(character)) {
		return `\\${character}`;
	}

	return character;
}

function isUriIgnoredByWorkspaceGitignore(uri: vscode.Uri, matchers: WorkspaceGitignoreMatcher[]): boolean {
	if (matchers.length === 0 || uri.scheme !== 'file') {
		return false;
	}

	for (const matcher of matchers) {
		if (matcher.rules.length === 0 || matcher.folderUri.scheme !== 'file') {
			continue;
		}

		const relativePath = path.relative(matcher.folderUri.fsPath, uri.fsPath);
		if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
			continue;
		}

		if (isRelativePathIgnoredByGitignore(relativePath, matcher.rules)) {
			return true;
		}
	}

	return false;
}

function isUriInDefaultIgnoredDirectory(uri: vscode.Uri): boolean {
	if (uri.scheme !== 'file') {
		return false;
	}

	return isPathInDefaultIgnoredDirectory(uri.fsPath);
}

export function stripLeadingBom(text: string): string {
	if (text.charCodeAt(0) === 0xFEFF) {
		return text.slice(1);
	}

	return text;
}

export function getFullFileTypingBounds(text: string): FullFileTypingBounds {
	const normalized = text.replace(/\r\n/g, '\n');
	const lines = normalized.split('\n');
	let typingStart = 0;

	for (let i = 0; i < lines.length; i += 1) {
		const line = lines[i];
		const lineLengthWithNewline = line.length + (i < lines.length - 1 ? 1 : 0);
		const trimmed = line.trim();

		if (trimmed.length === 0 || isBoilerplateLine(line)) {
			typingStart += lineLengthWithNewline;
			continue;
		}

		break;
	}

	if (typingStart >= normalized.length) {
		typingStart = 0;
	}

	return {
		typingStart,
		typingEnd: normalized.length,
	};
}

export function chooseSessionTypingStart(
	text: string,
	baseTypingStart: number,
	random: () => number = Math.random
): number {
	const normalized = text.replace(/\r\n/g, '\n');
	const safeBaseStart = clampIndex(baseTypingStart, normalized.length);

	if (random() < (1 - MID_FILE_START_PROBABILITY)) {
		return safeBaseStart;
	}

	const remainingLength = normalized.length - safeBaseStart;
	if (remainingLength < MIN_CHARACTERS_FOR_MID_FILE_START) {
		return safeBaseStart;
	}

	const minCandidateStart = safeBaseStart + Math.min(MIN_OFFSET_FROM_BASE_START, Math.floor(remainingLength / 3));
	const candidates = collectLineStartCandidates(normalized, minCandidateStart);
	if (candidates.length === 0) {
		return safeBaseStart;
	}

	const midpoint = safeBaseStart + Math.floor(remainingLength / 2);
	const midWindow = Math.max(30, Math.floor(remainingLength * MID_FILE_WINDOW_RATIO));
	const aroundMiddleCandidates = candidates.filter((start) => Math.abs(start - midpoint) <= midWindow);
	const pool = aroundMiddleCandidates.length > 0 ? aroundMiddleCandidates : candidates;
	const selectedIndex = Math.floor(random() * pool.length);

	return pool[selectedIndex] ?? safeBaseStart;
}

function isLowSignalWorkspaceFile(uri: vscode.Uri, text: string): boolean {
	const lowerPath = uri.fsPath.toLowerCase();
	if (lowerPath.includes('.min.') || lowerPath.endsWith('.d.ts') || lowerPath.includes('.generated.')) {
		return true;
	}

	const normalized = text.replace(/\r\n/g, '\n');
	const lines = normalized.split('\n');
	if (lines.length < 12) {
		return true;
	}

	let veryLongLineCount = 0;
	for (const line of lines) {
		if (line.length > 240) {
			veryLongLineCount += 1;
			if (veryLongLineCount >= 3) {
				return true;
			}
		}
	}

	return false;
}

function buildFullFileSource(text: string, languageId: string, extension: string): SourceContent {
	const normalized = text.replace(/\r\n/g, '\n');
	const bounds = getFullFileTypingBounds(normalized);
	const typingStart = chooseSessionTypingStart(normalized, bounds.typingStart);

	return {
		text: normalized,
		languageId,
		extension,
		typingStart,
		typingEnd: bounds.typingEnd,
	};
}

function collectLineStartCandidates(text: string, minimumStart: number): number[] {
	const lines = text.split('\n');
	const starts: number[] = [];
	let offset = 0;

	for (let i = 0; i < lines.length; i += 1) {
		const line = lines[i];
		if (offset >= minimumStart && line.trim().length > 0) {
			starts.push(offset);
		}
		offset += line.length + (i < lines.length - 1 ? 1 : 0);
	}

	return starts;
}

function clampIndex(index: number, length: number): number {
	if (index < 0) {
		return 0;
	}
	if (index > length) {
		return length;
	}
	return index;
}

function isImportLikeLine(line: string): boolean {
	for (const pattern of IMPORT_PATTERNS) {
		if (pattern.test(line)) {
			return true;
		}
	}

	return false;
}

function isBoilerplateLine(line: string): boolean {
	if (/^\s*#!/.test(line)) {
		return true;
	}

	if (/^\s*['\"]use strict['\"];?\s*$/i.test(line)) {
		return true;
	}

	if (/^\s*(\/\/|#|\/\*|\*|--)/.test(line)) {
		return true;
	}

	if (isImportLikeLine(line)) {
		return true;
	}

	return false;
}
