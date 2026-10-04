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

export interface SignalCheckOptions {
	isActiveFile?: boolean;
}

const EXTRA_WORKSPACE_EXTENSIONS = [
	'c',
	'php',
	'rb',
	'swift',
	'kt',
	'scala',
	'sql',
	'sh',
	'bash',
	'zsh',
	'ps1',
	'md',
	'vue',
	'svelte',
	'astro',
	'dart',
	'zig',
	'lua',
	'ex',
	'exs',
	'erl',
	'hrl',
	'html',
	'htm',
	'css',
	'scss',
	'sass',
	'less',
	'json',
	'jsonc',
	'yaml',
	'yml',
	'toml',
	'prisma',
	'graphql',
	'gql',
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
	'.nuxt',
	'.svelte-kit',
	'.astro',
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
	/^\s*using\s+[a-zA-Z0-9_.:]+;?\s*$/i,
	/^\s*package\s+[^;]+;?\s*$/i,
	/^\s*namespace\s+[^;{]+;?\s*$/i,
	/^\s*const\s+\w+\s*=\s*require\(/i,
	/^\s*export\s+\{.*\}\s+from\b/i,
	/^\s*use\s+[a-zA-Z0-9_:]+/i,
	/^\s*@(import|use|forward)\b/i,
	/^\s*require(_relative)?\b/i,
];

const MID_FILE_START_PROBABILITY = 0.5;
const MIN_CHARACTERS_FOR_MID_FILE_START = 180;
const MIN_OFFSET_FROM_BASE_START = 60;
const MID_FILE_WINDOW_RATIO = 0.2;

export async function getWorkspaceSource(): Promise<SourceContent | undefined> {
	const workspaceSnippet = await getWorkspaceSnippet();
	if (workspaceSnippet) {
		return workspaceSnippet;
	}

	const activeLanguageId = vscode.window.activeTextEditor?.document.languageId;
	return getFallbackAlgorithmSource(activeLanguageId);
}

export function getFallbackAlgorithmSource(preferredLanguageId?: string): SourceContent {
	let pack = preferredLanguageId
		? LANGUAGE_SNIPPET_PACKS.find((p) => p.languageId === preferredLanguageId)
		: undefined;

	if (!pack) {
		pack = LANGUAGE_SNIPPET_PACKS[Math.floor(Math.random() * LANGUAGE_SNIPPET_PACKS.length)];
	}

	const snippet = pack.snippets[Math.floor(Math.random() * pack.snippets.length)];
	const text = [
		...snippet.prefixLines,
		snippet.typedBlock,
		...snippet.suffixLines,
	].join('\n');

	const typingStart = snippet.prefixLines.length > 0
		? snippet.prefixLines.join('\n').length + 1
		: 0;

	return {
		text,
		languageId: pack.languageId,
		extension: pack.extension,
		typingStart,
		typingEnd: text.length,
	};
}

export function inferLanguageFromPath(filePath: string): Pick<SourceContent, 'languageId' | 'extension'> {
	const extension = path.extname(filePath).toLowerCase();

	switch (extension) {
		case '.ts':
			return { languageId: 'typescript', extension: '.ts' };
		case '.tsx':
			return { languageId: 'typescriptreact', extension: '.tsx' };
		case '.js':
		case '.mjs':
		case '.cjs':
			return { languageId: 'javascript', extension: '.js' };
		case '.jsx':
			return { languageId: 'javascriptreact', extension: '.jsx' };
		case '.vue':
			return { languageId: 'vue', extension: '.vue' };
		case '.svelte':
			return { languageId: 'svelte', extension: '.svelte' };
		case '.astro':
			return { languageId: 'astro', extension: '.astro' };
		case '.py':
			return { languageId: 'python', extension: '.py' };
		case '.go':
			return { languageId: 'go', extension: '.go' };
		case '.rs':
			return { languageId: 'rust', extension: '.rs' };
		case '.java':
			return { languageId: 'java', extension: '.java' };
		case '.c':
			return { languageId: 'c', extension: '.c' };
		case '.cpp':
		case '.cc':
		case '.cxx':
		case '.hpp':
		case '.h':
			return { languageId: 'cpp', extension: '.cpp' };
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
		case '.dart':
			return { languageId: 'dart', extension: '.dart' };
		case '.zig':
			return { languageId: 'zig', extension: '.zig' };
		case '.lua':
			return { languageId: 'lua', extension: '.lua' };
		case '.ex':
		case '.exs':
			return { languageId: 'elixir', extension: '.ex' };
		case '.erl':
		case '.hrl':
			return { languageId: 'erlang', extension: '.erl' };
		case '.sql':
			return { languageId: 'sql', extension: '.sql' };
		case '.html':
		case '.htm':
			return { languageId: 'html', extension: '.html' };
		case '.css':
			return { languageId: 'css', extension: '.css' };
		case '.scss':
			return { languageId: 'scss', extension: '.scss' };
		case '.sass':
			return { languageId: 'sass', extension: '.sass' };
		case '.less':
			return { languageId: 'less', extension: '.less' };
		case '.json':
		case '.jsonc':
			return { languageId: 'json', extension: '.json' };
		case '.yaml':
		case '.yml':
			return { languageId: 'yaml', extension: '.yaml' };
		case '.toml':
			return { languageId: 'toml', extension: '.toml' };
		case '.prisma':
			return { languageId: 'prisma', extension: '.prisma' };
		case '.graphql':
		case '.gql':
			return { languageId: 'graphql', extension: '.graphql' };
		case '.sh':
		case '.bash':
		case '.zsh':
			return { languageId: 'shellscript', extension: '.sh' };
		case '.ps1':
		case '.psm1':
			return { languageId: 'powershell', extension: '.ps1' };
		case '.md':
			return { languageId: 'markdown', extension: '.md' };
		default:
			return { languageId: 'plaintext', extension: '.txt' };
	}
}

async function getWorkspaceSnippet(): Promise<SourceContent | undefined> {
	if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
		void vscode.window.showInformationMessage('No open workspace found. Loaded a classic algorithm snippet to look busy!');
		return undefined;
	}

	const include = `**/*.{${CANDIDATE_EXTENSIONS.join(',')}}`;
	const exclude = '**/{node,node_modules,.git,.vscode,.idea,.venv,venv,env,dist,out,coverage,build,.next,.nuxt,.svelte-kit,.astro,target,bin,obj,vendor,.turbo,__pycache__,.pytest_cache,.mypy_cache,.tox,.pnpm-store,.yarn,.cache}/**';
	const files = await vscode.workspace.findFiles(include, exclude, 2000);

	if (files.length === 0) {
		void vscode.window.showInformationMessage('No supported workspace files found. Loaded a classic algorithm snippet to look busy!');
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
		const activeSource = await buildSourceFromFile(activeUri, { isActiveFile: true });
		if (activeSource) {
			return activeSource;
		}
	}

	const eligibleFiles = files.filter(
		(file) => !isUriInDefaultIgnoredDirectory(file) && !isUriIgnoredByWorkspaceGitignore(file, gitignoreMatchers)
	);
	if (eligibleFiles.length === 0) {
		void vscode.window.showInformationMessage('All workspace files are excluded by .gitignore. Loaded a classic algorithm snippet to look busy!');
		return undefined;
	}

	const prioritizedFiles = prioritizeWorkspaceFiles(eligibleFiles, activeUri);
	for (const selectedFile of prioritizedFiles.slice(0, 200)) {
		const source = await buildSourceFromFile(selectedFile, { isActiveFile: false });
		if (source) {
			return source;
		}
	}

	void vscode.window.showInformationMessage('Could not find a suitable workspace code block. Loaded a classic algorithm snippet to look busy!');
	return undefined;
}

async function getFileContent(file: vscode.Uri): Promise<string | undefined> {
	const openDoc = vscode.workspace.textDocuments.find(
		(doc) => doc.uri.toString() === file.toString()
	);
	if (openDoc) {
		const text = openDoc.getText();
		if (text.length > 200_000) {
			return undefined;
		}
		return stripLeadingBom(text);
	}

	try {
		const bytes = await vscode.workspace.fs.readFile(file);
		if (bytes.byteLength > 200_000) {
			return undefined;
		}
		return stripLeadingBom(new TextDecoder('utf-8').decode(bytes));
	} catch {
		return undefined;
	}
}

async function buildSourceFromFile(
	file: vscode.Uri,
	options: SignalCheckOptions = {}
): Promise<SourceContent | undefined> {
	const text = await getFileContent(file);
	if (!text) {
		return undefined;
	}

	if (isLowSignalWorkspaceFile(file, text, options)) {
		return undefined;
	}

	const language = inferLanguageFromPath(file.fsPath);
	const source = buildFullFileSource(text, language.languageId, language.extension);

	if (source.typingEnd - source.typingStart < 40) {
		return undefined;
	}

	return source;
}

export function prioritizeWorkspaceFiles(
	files: vscode.Uri[],
	activeUri: vscode.Uri | undefined,
	random: () => number = Math.random
): vscode.Uri[] {
	const activeFilePath = activeUri?.fsPath;
	const decorated = files.map((uri) => ({
		uri,
		score: scoreWorkspaceFilePath(uri.fsPath, activeFilePath),
		randomWeight: random(),
	}));

	decorated.sort((a, b) => {
		if (b.score !== a.score) {
			return b.score - a.score;
		}
		return a.randomWeight - b.randomWeight;
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

	if (
		normalizedPath.includes('/src/') ||
		normalizedPath.includes('/app/') ||
		normalizedPath.includes('/lib/') ||
		normalizedPath.includes('/components/') ||
		normalizedPath.includes('/pages/') ||
		normalizedPath.includes('/views/')
	) {
		score += 60;
	}

	if (lowerPath.endsWith('.d.ts') || lowerPath.includes('.min.') || lowerPath.includes('.generated.')) {
		score -= 200;
	}

	if (
		normalizedPath.includes('/test/') ||
		normalizedPath.includes('/tests/') ||
		normalizedPath.includes('/__tests__/') ||
		normalizedPath.includes('/fixture/') ||
		normalizedPath.includes('/fixtures/') ||
		normalizedPath.includes('/__fixtures__/') ||
		normalizedPath.includes('/mock/') ||
		normalizedPath.includes('/mocks/') ||
		lowerPath.includes('.spec.') ||
		lowerPath.includes('.test.')
	) {
		score -= 40;
	}

	return score;
}

async function loadWorkspaceGitignoreMatchers(): Promise<WorkspaceGitignoreMatcher[]> {
	if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
		return [];
	}

	const matchers: WorkspaceGitignoreMatcher[] = [];
	try {
		const gitignoreUris = await vscode.workspace.findFiles(
			'**/.gitignore',
			'**/{node_modules,.git,.venv,venv,dist,out,target,vendor}/**',
			50
		);

		for (const gitignoreUri of gitignoreUris) {
			const content = await readWorkspaceTextFile(gitignoreUri);
			if (!content) {
				continue;
			}

			const rules = parseGitignoreRules(content);
			if (rules.length === 0) {
				continue;
			}

			matchers.push({
				folderUri: vscode.Uri.file(path.dirname(gitignoreUri.fsPath)),
				rules,
			});
		}
	} catch {
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
	if ('^$.*+?()[]{}|\\'.includes(character)) {
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

function countDelimiterDelta(line: string): number {
	let delta = 0;
	for (const ch of line) {
		if (ch === '{' || ch === '(' || ch === '[') {
			delta += 1;
		} else if (ch === '}' || ch === ')' || ch === ']') {
			delta -= 1;
		}
	}
	return delta;
}

function isSingleLineBoilerplate(line: string): boolean {
	if (/^\s*#!/.test(line)) {
		return true;
	}

	if (/^\s*['"]use strict['"];?\s*$/i.test(line)) {
		return true;
	}

	if (/^\s*(\/\/|#|\*|--|%)/.test(line)) {
		return true;
	}

	return false;
}

export function getFullFileTypingBounds(text: string): FullFileTypingBounds {
	const normalized = text.replace(/\r\n/g, '\n');
	const lines = normalized.split('\n');
	let typingStart = 0;
	let currentOffset = 0;

	let inBlockComment = false;
	let inHtmlComment = false;
	let delimiterDelta = 0;

	for (const line of lines) {
		const trimmed = line.trim();

		if (trimmed.length === 0) {
			currentOffset += line.length + 1;
			typingStart = currentOffset;
			continue;
		}

		if (inBlockComment) {
			if (line.includes('*/')) {
				inBlockComment = false;
			}
			currentOffset += line.length + 1;
			typingStart = currentOffset;
			continue;
		}

		if (inHtmlComment) {
			if (line.includes('-->')) {
				inHtmlComment = false;
			}
			currentOffset += line.length + 1;
			typingStart = currentOffset;
			continue;
		}

		if (delimiterDelta > 0) {
			delimiterDelta += countDelimiterDelta(line);
			if (delimiterDelta < 0) {
				delimiterDelta = 0;
			}
			currentOffset += line.length + 1;
			typingStart = currentOffset;
			continue;
		}

		if (/^\s*\/\*/.test(line)) {
			if (!line.includes('*/')) {
				inBlockComment = true;
			}
			currentOffset += line.length + 1;
			typingStart = currentOffset;
			continue;
		}

		if (/^\s*<!--/.test(line)) {
			if (!line.includes('-->')) {
				inHtmlComment = true;
			}
			currentOffset += line.length + 1;
			typingStart = currentOffset;
			continue;
		}

		if (isSingleLineBoilerplate(line)) {
			currentOffset += line.length + 1;
			typingStart = currentOffset;
			continue;
		}

		if (isImportLikeLine(line)) {
			const delta = countDelimiterDelta(line);
			if (delta > 0) {
				delimiterDelta = delta;
			}
			currentOffset += line.length + 1;
			typingStart = currentOffset;
			continue;
		}

		break;
	}

	let clampedStart = clampIndex(typingStart, normalized.length);
	if (clampedStart >= normalized.length) {
		clampedStart = 0;
	}

	return {
		typingStart: clampedStart,
		typingEnd: normalized.length,
	};
}

export function chooseSessionTypingStart(
	text: string,
	baseStart: number,
	random: () => number = Math.random
): number {
	const normalized = text.replace(/\r\n/g, '\n');
	const safeBaseStart = clampIndex(baseStart, normalized.length);
	const lineStarts = collectLineStartCandidates(normalized, safeBaseStart);

	if (lineStarts.length === 0) {
		return safeBaseStart;
	}

	const firstSafeLine = lineStarts[0];
	const remainingCharacters = normalized.length - safeBaseStart;
	if (remainingCharacters < MIN_CHARACTERS_FOR_MID_FILE_START) {
		return firstSafeLine;
	}

	if (random() < (1 - MID_FILE_START_PROBABILITY)) {
		return firstSafeLine;
	}

	const midpoint = safeBaseStart + Math.floor(remainingCharacters / 2);
	const maxDistance = Math.max(30, Math.floor(remainingCharacters * MID_FILE_WINDOW_RATIO));

	const midCandidates = lineStarts.filter((candidate) => {
		if (candidate - safeBaseStart < MIN_OFFSET_FROM_BASE_START) {
			return false;
		}

		return Math.abs(candidate - midpoint) <= maxDistance;
	});

	if (midCandidates.length === 0) {
		return firstSafeLine;
	}

	const candidateIndex = Math.min(
		midCandidates.length - 1,
		Math.max(0, Math.floor(random() * midCandidates.length))
	);
	return midCandidates[candidateIndex];
}

export function isLockOrMapFile(fileName: string): boolean {
	const lower = fileName.toLowerCase();
	if (lower.endsWith('.map')) {
		return true;
	}
	if (
		lower.endsWith('.lock') ||
		lower.endsWith('.lockb') ||
		lower === 'package-lock.json' ||
		lower === 'pnpm-lock.yaml' ||
		lower === 'pnpm-lock.yml' ||
		lower === 'shrinkwrap.yaml' ||
		lower === 'npm-shrinkwrap.json' ||
		lower === 'gemfile.lock' ||
		lower === 'cargo.lock' ||
		lower === 'poetry.lock' ||
		lower === 'composer.lock' ||
		lower === 'flake.lock' ||
		/(^|[.-])lock([.-]|$)/i.test(lower)
	) {
		return true;
	}
	return false;
}

export function isLowSignalWorkspaceFile(
	file: vscode.Uri,
	text: string,
	options: SignalCheckOptions = {}
): boolean {
	const lowerName = path.basename(file.fsPath).toLowerCase();
	if (
		lowerName.endsWith('.d.ts') ||
		lowerName.endsWith('.min.js') ||
		lowerName.endsWith('.min.css') ||
		lowerName.includes('.min.') ||
		lowerName.includes('.bundle.') ||
		lowerName.includes('.generated.')
	) {
		return true;
	}

	if (isLockOrMapFile(lowerName)) {
		return true;
	}

	if (
		lowerName.startsWith('license') ||
		lowerName.startsWith('licence') ||
		lowerName.startsWith('changelog') ||
		lowerName.startsWith('changes')
	) {
		return true;
	}

	const normalized = text.replace(/\r\n/g, '\n');
	const lines = normalized.split('\n');

	const minLines = options.isActiveFile ? 3 : 5;
	const minChars = options.isActiveFile ? 30 : 60;
	if (lines.length < minLines || text.trim().length < minChars) {
		return true;
	}

	const isMarkdown = lowerName.endsWith('.md');
	const maxAllowedLineLength = isMarkdown ? 3000 : 1000;

	for (const line of lines) {
		if (line.length > maxAllowedLineLength) {
			return true;
		}
	}

	const averageLineLength = lines.length > 0 ? text.length / lines.length : 0;
	if (!isMarkdown && averageLineLength > 300) {
		return true;
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
