import { describe, expect, it } from 'vitest';
import { App } from 'obsidian-test-mocks/obsidian';
import { parseCards } from './core/parser';
import { stampNote, stampText } from './stamper';

function counter(): () => string {
	let n = 0;
	return () => `id${n++}`;
}

describe('stampText', () => {
	it('places tokens after single-line cards and above multi-line cards', () => {
		expect(stampText('q::a', counter())).toBe('q::a %%rem:id0%%');
		expect(stampText('f\n?\nb', counter())).toBe('%%rem:id0%%\nf\n?\nb');
	});

	it('stamps only the cards, leaving other lines alone', () => {
		const stamped = stampText('# heading\n\nq::a\nplain\n\ntext', counter());
		expect(stamped).toBe('# heading\n\nq::a %%rem:id0%%\nplain\n\ntext');
	});

	it('does not stamp card syntax inside code', () => {
		const text = ['```md', 'inside::code', '```', 'Use `key::value` here', 'outside::card'].join('\n');
		expect(stampText(text, counter())).toBe(
			['```md', 'inside::code', '```', 'Use `key::value` here', 'outside::card %%rem:id0%%'].join('\n'),
		);
	});

	it('keeps every card text intact and gives each card a distinct id', () => {
		const text = 'a::1\nb::2\n\nf1\nf2\n??\nback\n\nc:::3';
		const stamped = stampText(text);
		const before = parseCards(text);
		const after = parseCards(stamped);
		expect(after.map(({ kind, siblings, multiline }) => ({ kind, siblings, multiline }))).toEqual(
			before.map(({ kind, siblings, multiline }) => ({ kind, siblings, multiline })),
		);
		const ids = after.map((card) => card.id);
		expect(ids.every((id) => id !== null)).toBe(true);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it('is idempotent', () => {
		const once = stampText('a::1\n\nf\n?\nb');
		expect(stampText(once)).toBe(once);
	});

	it('preserves CRLF line endings for both card formats', () => {
		expect(stampText('q::a\r\nrest', counter())).toBe('q::a %%rem:id0%%\r\nrest');
		expect(stampText('front\r\n?\r\nback', counter())).toBe('%%rem:id0%%\r\nfront\r\n?\r\nback');
	});

	it('stamps a cloze line once regardless of its sibling count', () => {
		const text = 'The {{c1::capital of France}} is {{c2::Paris}}.';
		const stamped = stampText(text, counter());

		expect(stamped).toBe(`${text} %%rem:id0%%`);
		expect(parseCards(stamped)[0]).toMatchObject({ id: 'id0', kind: 'cloze' });
		expect(parseCards(stamped)[0].siblings).toHaveLength(2);
	});

	it('stamps the note content present when vault.process runs', async () => {
		const mockApp = App.createConfigured__({ files: { 'note.md': 'old::card' } });
		const app = mockApp.asOriginalType__();
		const file = app.vault.getFileByPath('note.md')!;
		await app.vault.modify(file, 'fresh::card');

		const stamped = await stampNote(app, file);

		const [card] = parseCards(stamped);
		expect(card.siblings[0]).toMatchObject({ front: 'fresh', back: 'card' });
		expect(card?.id).toMatch(/^[0-9a-z]{16}$/);
		expect(await app.vault.read(file)).toBe(stamped);
	});
});
