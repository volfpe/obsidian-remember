import { App } from 'obsidian-test-mocks/obsidian';
import { describe, expect, it } from 'vitest';
import { ClozeSyntaxMigration, hasLegacyClozeSyntax, migrateLegacyClozeSyntax } from './cloze-syntax-migration';

const root = 'Remember';

describe('legacy cloze syntax conversion', () => {
	it('converts markers while preserving numbers, answers, frontmatter, and code', () => {
		const text = [
			'---',
			'remember-type: cloze',
			'example: "{{c9::frontmatter}}"',
			'---',
			'',
			'The {{c1::capital}} is {{c2::`x == y`}}.',
			'Use `{{c3::example}}` literally.',
			'```md',
			'{{c4::also literal}}',
			'```',
		].join('\n');

		const migrated = migrateLegacyClozeSyntax(text);

		expect(migrated).toContain('example: "{{c9::frontmatter}}"');
		expect(migrated).toContain('The ==c1:capital== is ==c2:`x == y`==.');
		expect(migrated).toContain('Use `{{c3::example}}` literally.');
		expect(migrated).toContain('{{c4::also literal}}');
		expect(hasLegacyClozeSyntax(migrated)).toBe(false);
	});

	it('leaves malformed and incomplete markers unchanged', () => {
		const text = 'Empty {{c1::}} and unfinished {{c2::answer';
		expect(migrateLegacyClozeSyntax(text)).toBe(text);
		expect(hasLegacyClozeSyntax(text)).toBe(false);
	});
});

describe('cloze syntax migration', () => {
	it('detects and idempotently migrates only declared cloze cards under the root', async () => {
		const mockApp = App.createConfigured__({
			files: {
				[`${root}/old.md`]: '---\nremember-type: cloze\n---\n\nOld {{c1::answer}}.\n',
				[`${root}/basic.md`]: '---\nremember-type: basic\n---\n\n# Front\n{{c2::literal}}\n# Back\nx\n',
				'outside.md': '---\nremember-type: cloze\n---\n\nOutside {{c3::answer}}.\n',
			},
		});
		const app = mockApp.asOriginalType__();
		const migration = new ClozeSyntaxMigration(app, () => root);

		expect(await migration.hasPending()).toBe(true);
		expect(await migration.migrate()).toBe(1);
		expect(await app.vault.adapter.read(`${root}/old.md`)).toContain('Old ==c1:answer==.');
		expect(await app.vault.adapter.read(`${root}/basic.md`)).toContain('{{c2::literal}}');
		expect(await app.vault.adapter.read('outside.md')).toContain('{{c3::answer}}');
		expect(await migration.hasPending()).toBe(false);
		expect(await migration.migrate()).toBe(0);
	});
});
