import { App } from 'obsidian-test-mocks/obsidian';
import { describe, expect, it } from 'vitest';
import { slugSource } from '../core/new-card';
import { deckFolderPath, LegacyMigration, legacyCardSpec } from './legacy-migration';
import { parseCards, stripLegacyTokens } from './legacy-parser';

const root = 'Remember';

function makeMigration(mockApp: App, rawSettings: unknown = {}) {
	return new LegacyMigration(
		mockApp.asOriginalType__(),
		() => root,
		() => Promise.resolve(rawSettings),
	);
}

describe('legacy card specs', () => {
	it('maps every legacy card format onto a card-note spec', () => {
		const text = [
			'{suspend} hola:::hello %%rem:aaaaaaaaaaaaaaaa%%',
			'',
			'%%rem:bbbbbbbbbbbbbbbb%%',
			'multi front',
			'?',
			'multi back',
			'',
			'The capital is {{c1::Paris}}. %%rem:cccccccccccccccc%%',
		].join('\n');
		const cards = parseCards(text);

		expect(legacyCardSpec(cards[0], 'aaaaaaaaaaaaaaaa', text)).toEqual({
			id: 'aaaaaaaaaaaaaaaa',
			kind: 'basic',
			reverse: true,
			suspended: true,
			front: 'hola',
			back: 'hello',
		});
		expect(legacyCardSpec(cards[1], 'bbbbbbbbbbbbbbbb', text)).toMatchObject({
			kind: 'basic',
			reverse: false,
			front: 'multi front',
			back: 'multi back',
		});
		expect(legacyCardSpec(cards[2], 'cccccccccccccccc', text)).toEqual({
			id: 'cccccccccccccccc',
			kind: 'cloze',
			suspended: false,
			body: 'The capital is {{c1::Paris}}.',
		});
	});

	it('derives readable file names and folder paths', () => {
		expect(slugSource({ id: 'x', kind: 'cloze', body: 'The {{c1::answer}} is here.' })).toBe('The answer is here.');
		expect(slugSource({ id: 'x', kind: 'basic', front: '(noun)\n**something**' })).toBe('(noun) something');
		expect(deckFolderPath('lang/spanish')).toBe('lang/spanish');
		expect(deckFolderPath('a:b/ c ')).toBe('a b/c');
		expect(deckFolderPath('???')).toBe('');
	});

	it('strips only tokens from source notes', () => {
		const text = ['q::a %%rem:aaaaaaaaaaaaaaaa%%', '%%rem:bbbbbbbbbbbbbbbb%%', 'front', '?', 'back', '`%%rem:keep%%`'].join('\n');

		expect(stripLegacyTokens(text)).toBe(['q::a', 'front', '?', 'back', '`%%rem:keep%%`'].join('\n'));
	});
});

describe('migration', () => {
	it('detects legacy cards only outside the root folder', async () => {
		const withLegacy = App.createConfigured__({
			files: {
				'note.md': 'q::a %%rem:aaaaaaaaaaaaaaaa%%',
				[`${root}/card.md`]: '# Front\n\nq\n\n# Back\n\na\n',
			},
		});
		expect(await makeMigration(withLegacy).hasLegacyCards()).toBe(true);

		const clean = App.createConfigured__({
			files: { [`${root}/card.md`]: 'body %%rem:aaaaaaaaaaaaaaaa%% mentioning a token' },
		});
		expect(await makeMigration(clean).hasLegacyCards()).toBe(false);
	});

	it('moves cards into deck folders, keeps ids, strips tokens, and moves root logs', async () => {
		const noteText = [
			'---',
			'deck: lang/spanish',
			'---',
			'intro text stays',
			'',
			'hola::hello %%rem:aaaaaaaaaaaaaaaa%%',
			'unstamped::card',
			'',
			'The capital is {{c1::Paris}}. %%rem:cccccccccccccccc%%',
		].join('\n');
		const log = '{"v":1,"k":"r","i":"e1","t":"2026-08-11T09:14:03.120Z","c":"aaaaaaaaaaaaaaaa","s":0,"r":3,"dr":0.9}\n';
		const mockApp = App.createConfigured__({
			files: {
				'lang.md': noteText,
				'reviews-otherdevice.rememberlog': log,
			},
		});
		const app = mockApp.asOriginalType__();

		const migrated = await makeMigration(mockApp).migrate();

		expect(migrated).toBe(3);
		const hola = await app.vault.adapter.read(`${root}/lang/spanish/hola.md`);
		expect(hola).toContain('remember-id: aaaaaaaaaaaaaaaa');
		expect(hola).toContain('remember-type: basic');
		expect(hola).toContain('hola');
		const cloze = await app.vault.adapter.read(`${root}/lang/spanish/The capital is Paris.md`);
		expect(cloze).toContain('remember-id: cccccccccccccccc');
		expect(cloze).toContain('The capital is {{c1::Paris}}.');
		const unstamped = await app.vault.adapter.read(`${root}/lang/spanish/unstamped.md`);
		expect(unstamped).toMatch(/remember-id: [0-9a-z]{16}/);

		const source = await app.vault.adapter.read('lang.md');
		expect(source).not.toContain('%%rem:');
		expect(source).toContain('intro text stays');
		expect(source).toContain('hola::hello');

		expect(await app.vault.adapter.exists('reviews-otherdevice.rememberlog')).toBe(false);
		expect(await app.vault.adapter.read(`${root}/reviews-otherdevice.rememberlog`)).toBe(log);
	});

	it('skips cards whose id already exists in the root folder, so a re-run is safe', async () => {
		const mockApp = App.createConfigured__({
			files: {
				'note.md': '---\ndeck: x\n---\nhola::hello %%rem:aaaaaaaaaaaaaaaa%%',
				[`${root}/existing.md`]: '---\nremember-id: aaaaaaaaaaaaaaaa\nremember-type: basic\n---\n\n# Front\n\nhola\n\n# Back\n\nhello\n',
			},
		});
		const app = mockApp.asOriginalType__();

		const migrated = await makeMigration(mockApp).migrate();

		expect(migrated).toBe(0);
		expect(await app.vault.adapter.read('note.md')).not.toContain('%%rem:');
	});

	it('honors a custom legacy deck property from stored settings', async () => {
		const mockApp = App.createConfigured__({
			files: { 'note.md': '---\ncards: geo\n---\nq::a %%rem:aaaaaaaaaaaaaaaa%%' },
		});
		const app = mockApp.asOriginalType__();

		await makeMigration(mockApp, { deckProperty: 'cards' }).migrate();

		expect(await app.vault.adapter.exists(`${root}/geo/q.md`)).toBe(true);
	});
});
