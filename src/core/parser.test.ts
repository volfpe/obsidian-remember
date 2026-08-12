import { describe, expect, it } from 'vitest';
import { randomId } from './id';
import { parseCards } from './parser';

describe('single-line cards', () => {
	it('parses Question::Answer', () => {
		expect(parseCards('hola::hello')).toEqual([
			{ id: null, front: 'hola', back: 'hello', reversed: false, multiline: false, line: 0 },
		]);
	});

	it('parses Question:::Answer as reversed, checking ::: before ::', () => {
		const [card] = parseCards('hola:::hello');
		expect(card).toMatchObject({ front: 'hola', back: 'hello', reversed: true });
	});

	it('parses every :: line of a block as its own card', () => {
		const cards = parseCards('a::1\nb::2\nplain line\nc::3');
		expect(cards.map((c) => [c.front, c.back, c.line])).toEqual([
			['a', '1', 0],
			['b', '2', 1],
			['c', '3', 3],
		]);
	});

	it('trims whitespace around the separator', () => {
		expect(parseCards('q :: a')[0]).toMatchObject({ front: 'q', back: 'a' });
	});

	it('keeps a card with an empty side (nothing is special-cased)', () => {
		expect(parseCards('q::')[0]).toMatchObject({ front: 'q', back: '' });
	});

});

describe('multi-line cards', () => {
	it('parses front / ? / back', () => {
		expect(parseCards('front line\n?\nback line')).toEqual([
			{ id: null, front: 'front line', back: 'back line', reversed: false, multiline: true, line: 0 },
		]);
	});

	it('parses ?? as reversed', () => {
		expect(parseCards('f\n??\nb')[0]).toMatchObject({ reversed: true, multiline: true });
	});

	it('bounds the block by blank lines', () => {
		const cards = parseCards('before\n\nf1\nf2\n?\nb1\nb2\n\nafter');
		expect(cards).toHaveLength(1);
		expect(cards[0]).toMatchObject({ front: 'f1\nf2', back: 'b1\nb2', line: 2 });
	});

	it('parses nothing further inside a ? block — a :: line becomes front text', () => {
		const cards = parseCards('a::b\n?\nc');
		expect(cards).toEqual([{ id: null, front: 'a::b', back: 'c', reversed: false, multiline: true, line: 0 }]);
	});

	it('treats only the first ?/?? line as the separator', () => {
		expect(parseCards('f\n?\nb1\n??\nb2')[0]).toMatchObject({ front: 'f', back: 'b1\n??\nb2', reversed: false });
	});

	it('requires the separator line to be exactly ? or ??', () => {
		expect(parseCards('what is this?\nnot a card')).toEqual([]);
		expect(parseCards('f\n???\nb')).toEqual([]);
		expect(parseCards('f\n ? \nb')[0]).toMatchObject({ front: 'f', back: 'b' });
	});
});

describe('identity tokens', () => {
	it('reads a single-line card id from the token at the end of the line', () => {
		expect(parseCards('q::a %%rem:k3x9q2m1p8z4a%%')[0]).toMatchObject({ id: 'k3x9q2m1p8z4a', front: 'q', back: 'a' });
	});

	it('reads a multi-line card id from the token line above the block', () => {
		const [card] = parseCards('%%rem:abc123%%\nf\n?\nb');
		expect(card).toMatchObject({ id: 'abc123', front: 'f', back: 'b', line: 1 });
	});

	it('parses a stamped card identically to its unstamped form', () => {
		const plain = parseCards('q::a')[0];
		const stamped = parseCards('q::a %%rem:xyz%%')[0];
		expect({ ...stamped, id: null, line: plain.line }).toEqual(plain);
		const plainMulti = parseCards('f\n?\nb')[0];
		const stampedMulti = parseCards('%%rem:xyz%%\nf\n?\nb')[0];
		expect({ ...stampedMulti, id: null, line: 0 }).toEqual(plainMulti);
	});

	it('strips tokens from card text without treating them as identity elsewhere', () => {
		const [card] = parseCards('q %%rem:mid%% ::a\n?\nb %%rem:tail%%');
		expect(card.id).toBeNull();
		expect(card.front).not.toContain('%%rem');
		expect(card.back).not.toContain('%%rem');
	});

	it('yields no card for a lone token line', () => {
		expect(parseCards('%%rem:orphan%%')).toEqual([]);
	});
});

describe('frontmatter and line endings', () => {
	it('never parses frontmatter as cards', () => {
		const cards = parseCards('---\ndeck: x\ntitle: "a::b"\n---\nq::a');
		expect(cards).toEqual([{ id: null, front: 'q', back: 'a', reversed: false, multiline: false, line: 4 }]);
	});

	it('treats an unclosed --- as ordinary text', () => {
		expect(parseCards('---\nq::a')).toHaveLength(1);
	});

	it('handles CRLF files', () => {
		const cards = parseCards('q::a\r\n\r\nf\r\n?\r\nb\r\n');
		expect(cards[0]).toMatchObject({ front: 'q', back: 'a' });
		expect(cards[1]).toMatchObject({ front: 'f', back: 'b', multiline: true });
	});
});

describe('randomId', () => {
	it('mints 13-char base36 ids', () => {
		for (let i = 0; i < 100; i++) expect(randomId()).toMatch(/^[0-9a-z]{13}$/);
	});
});
