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

export interface GitignoreMatcher {
	rootPath: string;
	rules: GitignoreRule[];
}

export interface SignalCheckOptions {
	isActiveFile?: boolean;
}

export interface SourceSelectionOptions {
	token?: vscode.CancellationToken;
	preferWorkspace?: boolean;
	/** When true, no built-in fallback is used and undefined is returned instead. */
	requireWorkspace?: boolean;
}

const MAX_WORKSPACE_FILES = 2000;
const MAX_CANDIDATE_FILES = 200;
const MAX_GITIGNORE_FILES = 50;
const MAX_SOURCE_FILE_BYTES = 200_000;
const MIN_TYPABLE_CHARACTERS = 40;

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

const WORKSPACE_SEARCH_EXCLUDE =
	'**/{node,node_modules,.git,.vscode,.idea,.venv,venv,env,dist,out,coverage,build,.next,.nuxt,.svelte-kit,.astro,target,bin,obj,vendor,.turbo,__pycache__,.pytest_cache,.mypy_cache,.tox,.pnpm-store,.yarn,.cache}/**';

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

const FALLBACK_MESSAGES = {
	noWorkspace: 'Look Busy: no folder is open, so it loaded a built-in algorithm.',
	noSupportedFiles: 'Look Busy: no supported files in this folder, so it loaded a built-in algorithm.',
	allIgnored:
		'Look Busy: every candidate file is excluded by .gitignore, so it loaded a built-in algorithm.',
	noUsableBlock:
		'Look Busy: no workspace file had a usable code block, so it loaded a built-in algorithm.',
	workspaceDisabled:
		'Look Busy is set to built-in algorithms only, so the workspace was not read.',
};

export async function getWorkspaceSource(options: SourceSelectionOptions = {}): Promise<SourceContent | undefined> {
	if (options.token?.isCancellationRequested) {
		return undefined;
	}

	const preferWorkspace = options.preferWorkspace ?? true;

	if (preferWorkspace) {
		const workspaceSnippet = await getWorkspaceSnippet(options.token);
		if (workspaceSnippet) {
			return workspaceSnippet;
		}

		// getWorkspaceSnippet already reported why no workspace file qualified.
		if (options.requireWorkspace) {
			return undefined;
		}
	} else {
		void vscode.window.showInformationMessage(FALLBACK_MESSAGES.workspaceDisabled);
	}

	return getFallbackAlgorithmSource(vscode.window.activeTextEditor?.document.languageId);
}

export function getFallbackAlgorithmSource(preferredLanguageId?: string): SourceContent {
	const preferredPack = preferredLanguageId
		? LANGUAGE_SNIPPET_PACKS.find((pack) => pack.languageId === preferredLanguageId)
		: undefined;

	const pack =
		preferredPack ?? LANGUAGE_SNIPPET_PACKS[Math.floor(Math.random() * LANGUAGE_SNIPPET_PACKS.length)];

	const snippet = pack.snippets[Math.floor(Math.random() * pack.snippets.length)];
	const text = [...snippet.prefixLines, snippet.typedBlock, ...snippet.suffixLines].join('\n');

	const typingStart =
		snippet.prefixLines.length > 0 ? snippet.prefixLines.join('\n').length + 1 : 0;

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

async function getWorkspaceSnippet(token?: vscode.CancellationToken): Promise<SourceContent | undefined> {
	const folders = vscode.workspace.workspaceFolders;
	if (!folders || folders.length === 0) {
		void vscode.window.showInformationMessage(FALLBACK_MESSAGES.noWorkspace);
		return undefined;
	}

	if (token?.isCancellationRequested) {
		return undefined;
	}

	const include = `**/*.{${CANDIDATE_EXTENSIONS.join(',')}}`;
	const files = await vscode.workspace.findFiles(include, WORKSPACE_SEARCH_EXCLUDE, MAX_WORKSPACE_FILES);

	if (files.length === 0) {
		void vscode.window.showInformationMessage(FALLBACK_MESSAGES.noSupportedFiles);
		return undefined;
	}

	const matchers = await loadWorkspaceGitignoreMatchers(token);
	const activeUri = vscode.window.activeTextEditor?.document.uri;

	if (activeUri && isEligibleWorkspaceUri(activeUri, matchers)) {
		const activeSource = await buildSourceFromFile(activeUri, { isActiveFile: true });
		if (activeSource) {
			return activeSource;
		}
	}

	const eligibleFiles = files.filter((file) => isEligibleWorkspaceUri(file, matchers));
	if (eligibleFiles.length === 0) {
		void vscode.window.showInformationMessage(FALLBACK_MESSAGES.allIgnored);
		return undefined;
	}

	const readableCandidates = prioritizeWorkspaceFiles(eligibleFiles, activeUri)
		.slice(0, MAX_CANDIDATE_FILES)
		.filter((file) => !isLowSignalWorkspaceFileName(file.fsPath));

	for (const candidate of readableCandidates) {
		if (token?.isCancellationRequested) {
			return undefined;
		}

		const source = await buildSourceFromFile(candidate, { isActiveFile: false });
		if (source) {
			return source;
		}
	}

	void vscode.window.showInformationMessage(FALLBACK_MESSAGES.noUsableBlock);
	return undefined;
}

async function getFileContent(file: vscode.Uri): Promise<string | undefined> {
	const openDoc = vscode.workspace.textDocuments.find((doc) => doc.uri.toString() === file.toString());
	if (openDoc) {
		if (openDoc.getText().length > MAX_SOURCE_FILE_BYTES) {
			return undefined;
		}
		return stripLeadingBom(openDoc.getText());
	}

	try {
		const bytes = await vscode.workspace.fs.readFile(file);
		if (bytes.byteLength > MAX_SOURCE_FILE_BYTES) {
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
	if (isLowSignalWorkspaceFileName(file.fsPath)) {
		return undefined;
	}

	const text = await getFileContent(file);
	if (!text || hasLowSignalWorkspaceContent(text, file.fsPath, options)) {
		return undefined;
	}

	const language = inferLanguageFromPath(file.fsPath);
	const source = buildFullFileSource(text, language.languageId, language.extension);

	if (source.typingEnd - source.typingStart < MIN_TYPABLE_CHARACTERS) {
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

function isEligibleWorkspaceUri(uri: vscode.Uri, matchers: GitignoreMatcher[]): boolean {
	if (!isWorkspaceCandidateUri(uri)) {
		return false;
	}

	if (isPathInDefaultIgnoredDirectory(uri.fsPath)) {
		return false;
	}

	return !isUriIgnoredByWorkspaceGitignore(uri, matchers);
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

async function loadWorkspaceGitignoreMatchers(token?: vscode.CancellationToken): Promise<GitignoreMatcher[]> {
	const folders = vscode.workspace.workspaceFolders;
	if (!folders || folders.length === 0) {
		return [];
	}

	const matchers: GitignoreMatcher[] = [];
	let gitignoreUris: vscode.Uri[] = [];

	try {
		gitignoreUris = await vscode.workspace.findFiles(
			'**/.gitignore',
			'**/{node_modules,.git,.venv,venv,dist,out,target,vendor}/**',
			MAX_GITIGNORE_FILES
		);
	} catch {
		gitignoreUris = folders.map((folder) => vscode.Uri.joinPath(folder.uri, '.gitignore'));
	}

	for (const gitignoreUri of gitignoreUris) {
		if (token?.isCancellationRequested) {
			break;
		}

		const content = await readWorkspaceTextFile(gitignoreUri);
		if (!content) {
			continue;
		}

		const matcher = createGitignoreMatcher(path.dirname(gitignoreUri.fsPath), content);
		if (matcher) {
			matchers.push(matcher);
		}
	}

	for (const folder of folders) {
		if (token?.isCancellationRequested) {
			break;
		}

		const excludeContent = await readWorkspaceTextFile(
			vscode.Uri.joinPath(folder.uri, '.git', 'info', 'exclude')
		);
		if (!excludeContent) {
			continue;
		}

		const matcher = createGitignoreMatcher(folder.uri.fsPath, excludeContent);
		if (matcher) {
			matchers.push(matcher);
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

export function createGitignoreMatcher(rootPath: string, content: string): GitignoreMatcher | undefined {
	const rules = parseGitignoreRules(content);
	if (rules.length === 0) {
		return undefined;
	}

	return { rootPath, rules };
}

/**
 * Applies gitignore rules the way git does: the closest (deepest) directory that
 * owns a rule for the path decides, so a negation in a nested .gitignore can
 * override a rule from a parent one. The first matcher that produces any
 * decision wins; matchers that never match the path are skipped.
 */
export function isPathIgnoredByGitignoreMatchers(filePath: string, matchers: GitignoreMatcher[]): boolean {
	if (matchers.length === 0) {
		return false;
	}

	const target = comparablePath(filePath);
	const candidates = matchers
		.filter((matcher) => isSameOrDescendantPath(comparablePath(matcher.rootPath), target))
		.sort((left, right) => right.rootPath.length - left.rootPath.length);

	for (const matcher of candidates) {
		const relativePath = relativePathUnder(matcher.rootPath, filePath);
		if (relativePath === undefined) {
			continue;
		}

		const decision = evaluateGitignoreRules(relativePath, matcher.rules);
		if (decision !== undefined) {
			return decision;
		}
	}

	return false;
}

function isSameOrDescendantPath(rootPath: string, targetPath: string): boolean {
	if (rootPath.length === 0) {
		return false;
	}

	return targetPath === rootPath || targetPath.startsWith(`${rootPath}/`);
}

function relativePathUnder(rootPath: string, filePath: string): string | undefined {
	const root = comparablePath(rootPath);
	const target = comparablePath(filePath);

	if (target === root || !target.startsWith(`${root}/`)) {
		return undefined;
	}

	return target.slice(root.length + 1);
}

function comparablePath(filePath: string): string {
	const normalized = filePath.replace(/\\/g, '/').replace(/\/+$/, '');
	return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

export function parseGitignoreRules(content: string): GitignoreRule[] {
	const lines = content.replace(/\r\n/g, '\n').split('\n');
	const rules: GitignoreRule[] = [];

	for (const rawLine of lines) {
		const line = stripUnescapedTrailingWhitespace(rawLine);
		if (line.length === 0 || line[0] === '#') {
			continue;
		}

		let negated = false;
		let pattern = line;

		if (pattern[0] === '!') {
			negated = true;
			pattern = pattern.slice(1);
		} else if (pattern[0] === '\\' && (pattern[1] === '!' || pattern[1] === '#')) {
			pattern = pattern.slice(1);
		}

		pattern = pattern.replace(/^\.\/+/, '');

		const compiled = compileGitignorePattern(pattern);
		if (!compiled) {
			continue;
		}

		rules.push({ negated, regex: compiled });
	}

	return rules;
}

export function isRelativePathIgnoredByGitignore(relativePath: string, rules: GitignoreRule[]): boolean {
	return evaluateGitignoreRules(relativePath.replace(/\\/g, '/'), rules) === true;
}

/**
 * Mirrors git: a pattern also matches every ancestor directory of the path, so
 * an excluded directory excludes everything beneath it. Candidates are walked
 * shallowest first so a deeper directory's rules get the last word.
 *
 * One deliberate deviation from git: a later negation can re-include a file
 * whose parent directory matched an ignore rule, which git refuses to do.
 */
function evaluateGitignoreRules(relativePath: string, rules: GitignoreRule[]): boolean | undefined {
	let ignored: boolean | undefined;

	for (const candidate of ancestorPaths(relativePath)) {
		for (const rule of rules) {
			if (rule.regex.test(candidate)) {
				ignored = !rule.negated;
			}
		}
	}

	return ignored;
}

function ancestorPaths(relativePath: string): string[] {
	const segments = relativePath.split('/').filter((segment) => segment.length > 0);
	const paths: string[] = [];
	let current = '';

	for (const segment of segments) {
		current = current.length === 0 ? segment : `${current}/${segment}`;
		paths.push(current);
	}

	return paths;
}

function stripUnescapedTrailingWhitespace(line: string): string {
	let end = line.length;

	while (end > 0) {
		const character = line[end - 1];
		if (character !== ' ' && character !== '\t') {
			break;
		}

		if (end >= 2 && line[end - 2] === '\\') {
			break;
		}

		end -= 1;
	}

	return line.slice(0, end);
}

function compileGitignorePattern(pattern: string): RegExp | undefined {
	if (!pattern) {
		return undefined;
	}

	const rooted = pattern.startsWith('/');
	const cleaned = pattern.replace(/^\/+/, '').replace(/\/+$/, '');
	if (!cleaned) {
		return undefined;
	}

	const body = globToRegexBody(cleaned);
	const prefix = rooted ? '^' : '^(?:.*\\/)?';
	const flags = process.platform === 'win32' ? 'i' : '';
	return new RegExp(`${prefix}${body}$`, flags);
}

/**
 * `**` is only special in three positions, exactly as git defines it: a leading
 * globstar-slash (already covered by the any-depth prefix), an interior
 * globstar-slash-globstar (zero or more directories), and a trailing
 * globstar (everything inside). Anywhere else it degrades to `*` and must not
 * cross a directory separator.
 */
function globToRegexBody(pattern: string): string {
	let output = '';

	for (let i = 0; i < pattern.length; i += 1) {
		const character = pattern[i];

		if (character === '*' && pattern[i + 1] === '*') {
			const isTrailing = i + 2 >= pattern.length;

			if (isTrailing) {
				i += 1;
				if (output.endsWith('/')) {
					output += '.*';
				} else {
					output += '[^/]*';
				}
				continue;
			}

			if (pattern[i + 2] === '/') {
				i += 2;
				if (output.length === 0) {
					continue;
				}

				output = output.endsWith('/') ? output.slice(0, -1) : output;
				output += '(?:\\/[^/]+)*\\/';
				continue;
			}

			output += '[^/]*';
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

		if (character === '[') {
			const closingIndex = pattern.indexOf(']', i + 1);
			if (closingIndex > i + 1) {
				const classBody = pattern.slice(i + 1, closingIndex);
				output += classBody[0] === '!' || classBody[0] === '^'
					? `[${'^'}${classBody.slice(1)}]`
					: `[${classBody}]`;
				i = closingIndex;
				continue;
			}

			output += '\\[';
			continue;
		}

		if (character === '\\' && i + 1 < pattern.length) {
			output += escapeRegexCharacter(pattern[i + 1]);
			i += 1;
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

function isUriIgnoredByWorkspaceGitignore(uri: vscode.Uri, matchers: GitignoreMatcher[]): boolean {
	if (matchers.length === 0 || uri.scheme !== 'file') {
		return false;
	}

	return isPathIgnoredByGitignoreMatchers(uri.fsPath, matchers);
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

/**
 * Filename-only rejection. Cheap enough to run against thousands of candidates
 * before opening any of them.
 */
export function isLowSignalWorkspaceFileName(filePath: string): boolean {
	const lowerName = path.basename(filePath).toLowerCase();

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

	return false;
}

/** Content-based rejection, applied only after a file has been read. */
export function hasLowSignalWorkspaceContent(
	text: string,
	filePath: string,
	options: SignalCheckOptions = {}
): boolean {
	const lowerName = path.basename(filePath).toLowerCase();
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

export function isLowSignalWorkspaceFile(
	file: vscode.Uri,
	text: string,
	options: SignalCheckOptions = {}
): boolean {
	if (isLowSignalWorkspaceFileName(file.fsPath)) {
		return true;
	}

	return hasLowSignalWorkspaceContent(text, file.fsPath, options);
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

export { MAX_SOURCE_FILE_BYTES };