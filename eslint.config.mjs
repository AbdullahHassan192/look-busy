import typescriptEslint from "typescript-eslint";

export default [
	{
		ignores: ["out/**", "dist/**", "node_modules/**", ".vscode-test/**"],
	},
	{
		files: ["src/**/*.ts"],
	},
	{
		files: ["**/*.ts"],
		plugins: {
			"@typescript-eslint": typescriptEslint.plugin,
		},

		languageOptions: {
			parser: typescriptEslint.parser,
			ecmaVersion: 2022,
			sourceType: "module",
		},

		rules: {
			curly: "error",
			eqeqeq: ["error", "always"],
			"no-throw-literal": "error",
			"no-var": "error",
			"prefer-const": "error",
			"no-console": ["error", { allow: ["error"] }],
			semi: "error",
			"no-unused-vars": "off",
			"@typescript-eslint/no-unused-vars": [
				"error",
				{ argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
			],
			"@typescript-eslint/naming-convention": [
				"error",
				{
					selector: "import",
					format: ["camelCase", "PascalCase"],
				},
			],
		},
	},
];