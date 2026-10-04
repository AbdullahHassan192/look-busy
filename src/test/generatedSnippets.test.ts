import * as assert from 'assert';
import { LANGUAGE_SNIPPET_PACKS } from '../generatedSnippets';

const REQUIRED_LABELS = ['TypeScript', 'JavaScript', 'Python', 'Java', 'C++', 'C#', 'Go', 'Rust'];

suite('Generated Snippet Library', () => {
	test('Every language pack ships a usable set of algorithms', () => {
		for (const pack of LANGUAGE_SNIPPET_PACKS) {
			assert.ok(
				pack.snippets.length >= 6,
				`Expected at least 6 snippets for ${pack.label}, got ${pack.snippets.length}`
			);

			const titles = new Set(pack.snippets.map((snippet) => snippet.title));
			assert.strictEqual(
				titles.size,
				pack.snippets.length,
				`Expected unique titles for ${pack.label}, got ${[...titles].join(', ')}`
			);
		}
	});

	test('The library spans many distinct algorithms overall', () => {
		const titles = new Set(
			LANGUAGE_SNIPPET_PACKS.flatMap((pack) => pack.snippets.map((snippet) => snippet.title))
		);

		assert.ok(
			titles.size >= 12,
			`Expected at least 12 distinct algorithms across packs, got ${titles.size}`
		);
	});

	test('Snippets are substantial and free of scaffolding', () => {
		for (const pack of LANGUAGE_SNIPPET_PACKS) {
			for (const snippet of pack.snippets) {
				const typedLineCount = snippet.typedBlock
					.split('\n')
					.filter((line) => line.trim().length > 0)
					.length;
				const normalizedCode = snippet.typedBlock.toLowerCase();

				assert.ok(
					typedLineCount >= 7,
					`Expected meaningful algorithm body for ${pack.label} (${snippet.title}), got ${typedLineCount} lines`
				);

				assert.ok(
					typedLineCount <= 50,
					`Expected concise algorithm body for ${pack.label} (${snippet.title}), got ${typedLineCount} lines`
				);

				assert.ok(
					!normalizedCode.includes('nodehealthrows') && !normalizedCode.includes('dependencyedges'),
					`Expected no generated dataset scaffolding for ${pack.label} (${snippet.title})`
				);

				const placeholderLine = snippet.typedBlock
					.split('\n')
					.some((line) => line.trim() === '...' || line.trim() === '…');

				assert.ok(
					!placeholderLine,
					`Expected no placeholder body for ${pack.label} (${snippet.title})`
				);
			}
		}
	});

	test('Every snippet carries a header and ends inside the typed range', () => {
		for (const pack of LANGUAGE_SNIPPET_PACKS) {
			for (const snippet of pack.snippets) {
				assert.ok(
					snippet.prefixLines.length > 0,
					`Expected a header line for ${pack.label} (${snippet.title})`
				);
				assert.ok(
					snippet.typedBlock.trim().length > 0,
					`Expected a typed body for ${pack.label} (${snippet.title})`
				);
			}
		}
	});

	test('Language pack list includes major languages', () => {
		const labels = new Set(LANGUAGE_SNIPPET_PACKS.map((pack) => pack.label));
		for (const label of REQUIRED_LABELS) {
			assert.ok(labels.has(label), `Expected the library to include ${label}`);
		}
	});

	test('Packs declare the language id and extension used for temp files', () => {
		for (const pack of LANGUAGE_SNIPPET_PACKS) {
			assert.ok(pack.languageId.length > 0, `Expected a language id for ${pack.label}`);
			assert.ok(pack.extension.startsWith('.'), `Expected a dotted extension for ${pack.label}`);
			assert.ok(pack.workspaceExtensions.length > 0, `Expected workspace extensions for ${pack.label}`);
			for (const workspaceExtension of pack.workspaceExtensions) {
				assert.ok(
					!workspaceExtension.includes('.'),
					`Expected bare extensions for ${pack.label}, got ${workspaceExtension}`
				);
			}
		}
	});
});