import { defineConfig } from 'vitest/config';

export default defineConfig({
	resolve: {
		// Vitest 3 resolves the type-only `obsidian` package before setup-file mocks run.
		alias: { obsidian: 'obsidian-test-mocks/obsidian' },
	},
	test: {
		environment: 'jsdom',
		setupFiles: ['fake-indexeddb/auto', 'obsidian-test-mocks/vitest-setup'],
	},
});
