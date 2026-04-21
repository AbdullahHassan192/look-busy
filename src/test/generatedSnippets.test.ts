import * as assert from 'assert';
import { LANGUAGE_SNIPPET_PACKS } from '../generatedSnippets';

suite('Generated Snippet Library', () => {
	test('Each language pack has multiple famous algorithms', () => {
		for (const pack of LANGUAGE_SNIPPET_PACKS) {
			assert.ok(
				pack.snippets.length >= 3,
				`Expected at least 3 snippets for ${pack.label}, got ${pack.snippets.length}`
			);
		}
	});

	test('Snippets are algorithm-focused and avoid generated dataset noise', () => {
		for (const pack of LANGUAGE_SNIPPET_PACKS) {
			for (const snippet of pack.snippets) {
				const typedLineCount = snippet.typedBlock
					.split('\n')
					.filter((line) => line.trim().length > 0)
					.length;
				const normalizedTitle = snippet.title.toLowerCase();
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
					normalizedTitle.includes('search') || normalizedTitle.includes('sort') || normalizedTitle.includes('sieve'),
					`Expected famous algorithm title for ${pack.label}, got ${snippet.title}`
				);

				assert.ok(
					!normalizedCode.includes('nodehealthrows') && !normalizedCode.includes('dependencyedges'),
					`Expected no generated dataset scaffolding for ${pack.label} (${snippet.title})`
				);
			}
		}
	});

	test('Language pack list includes major languages', () => {
		const labels = new Set(LANGUAGE_SNIPPET_PACKS.map((pack) => pack.label));
		assert.ok(labels.has('TypeScript'));
		assert.ok(labels.has('JavaScript'));
		assert.ok(labels.has('Python'));
		assert.ok(labels.has('Java'));
		assert.ok(labels.has('C++'));
		assert.ok(labels.has('C#'));
		assert.ok(labels.has('Go'));
		assert.ok(labels.has('Rust'));
	});
});
