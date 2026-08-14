import { describe, expect, it } from 'vitest';
import { parseCards } from './parser';

describe('parseCards', () => {
	it('parses single-line cards and their source lines', () => {
		const cards = parseCards('a :: 1\nb:::2\nplain\nc::');
		expect(cards.map(({ front, back, reversed, line }) => ({ front, back, reversed, line }))).toEqual([
			{ front: 'a', back: '1', reversed: false, line: 0 },
			{ front: 'b', back: '2', reversed: true, line: 1 },
			{ front: 'c', back: '', reversed: false, line: 3 },
		]);
	});

	it('parses a multi-line card', () => {
		expect(parseCards('front line\n?\nback line')).toEqual([
			{ id: null, front: 'front line', back: 'back line', reversed: false, multiline: true, line: 0 },
		]);
	});

	it('uses ?? for a reversed multi-line card', () => {
		expect(parseCards('front\n??\nback')[0]).toMatchObject({ reversed: true, multiline: true });
	});

	it('bounds multi-line cards by blank lines', () => {
		const [card] = parseCards('before\n\nf1\nf2\n?\nb1\nb2\n\nafter');
		expect(card).toMatchObject({ front: 'f1\nf2', back: 'b1\nb2', line: 2 });
	});

	it('treats a block with ? as one card and uses only its first separator', () => {
		const [card] = parseCards('a::b\n?\nb1\n??\nb2');
		expect(card).toMatchObject({ front: 'a::b', back: 'b1\n??\nb2', reversed: false });
	});

	it('requires an exact ? or ?? separator line', () => {
		expect(parseCards('what is this?\nnot a card')).toEqual([]);
		expect(parseCards('front\n???\nback')).toEqual([]);
		expect(parseCards('front\n ? \nback')).toHaveLength(1);
	});

	it('reads identity tokens from both card formats', () => {
		expect(parseCards('q::a %%rem:single%%')[0]).toMatchObject({ id: 'single', front: 'q', back: 'a' });
		expect(parseCards('%%rem:multi%%\nf\n?\nb')[0]).toMatchObject({ id: 'multi', front: 'f', back: 'b', line: 1 });
	});

	it('removes identity tokens from content and ignores orphan tokens', () => {
		const [card] = parseCards('q %%rem:noise%% ::a\n?\nb %%rem:tail%%');
		expect(card.id).toBeNull();
		expect(card.front + card.back).not.toContain('%%rem:');
		expect(parseCards('%%rem:orphan%%')).toEqual([]);
	});

	it('does not parse frontmatter as cards', () => {
		expect(parseCards('---\ndeck: x\ntitle: "a::b"\n---\nq::a')).toEqual([
			{ id: null, front: 'q', back: 'a', reversed: false, multiline: false, line: 4 },
		]);
	});

	it('does not parse cards inside fenced code blocks', () => {
		const text = ['before::card', '```md', 'inside::code', '?', '```', '~~~', 'also:::code', '~~~', 'after::card'].join(
			'\n',
		);
		expect(parseCards(text).map(({ front, line }) => ({ front, line }))).toEqual([
			{ front: 'before', line: 0 },
			{ front: 'after', line: 8 },
		]);
	});

	it('preserves fenced code inside a multi-line card', () => {
		const [card] = parseCards(['Question', '```ts', 'const fake = "q::a";', '?', '```', '?', 'Answer'].join('\n'));
		expect(card).toMatchObject({
			front: ['Question', '```ts', 'const fake = "q::a";', '?', '```'].join('\n'),
			back: 'Answer',
			multiline: true,
		});
	});

	it('ignores inline code but finds a separator outside it', () => {
		expect(parseCards('Use `key::value` in settings')).toEqual([]);
		expect(parseCards('What does `key::value` mean?::A key-value pair')[0]).toMatchObject({
			front: 'What does `key::value` mean?',
			back: 'A key-value pair',
		});
	});

	it('preserves identity-like text inside code', () => {
		const [card] = parseCards(['Question', '```', '%%rem:literal%%', '```', '?', 'Answer'].join('\n'));
		expect(card.front).toContain('%%rem:literal%%');
		expect(card.id).toBeNull();
	});

	it('handles CRLF input', () => {
		const cards = parseCards('q::a\r\n\r\nf\r\n?\r\nb\r\n');
		expect(cards.map(({ front, back }) => ({ front, back }))).toEqual([
			{ front: 'q', back: 'a' },
			{ front: 'f', back: 'b' },
		]);
	});
});
