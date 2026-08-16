import { describe, expect, it } from 'vitest';
import { parseCards, type ParsedCard } from './legacy-parser';

function firstSibling(card: ParsedCard) {
	return card.siblings[0];
}

describe('parseCards', () => {
	it('parses single-line cards and their source lines', () => {
		const cards = parseCards('a :: 1\nb:::2\nplain\nc::');
		expect(cards.map(({ siblings, line }) => ({ siblings, line }))).toEqual([
			{ siblings: [{ sub: 0, front: 'a', back: '1' }], line: 0 },
			{
				siblings: [
					{ sub: 0, front: 'b', back: '2' },
					{ sub: 1, front: '2', back: 'b' },
				],
				line: 1,
			},
			{ siblings: [{ sub: 0, front: 'c', back: '' }], line: 3 },
		]);
	});

	it('parses a multi-line card', () => {
		expect(parseCards('front line\n?\nback line')).toEqual([
			{
				id: null,
				suspended: false,
				kind: 'basic',
				siblings: [{ sub: 0, front: 'front line', back: 'back line' }],
				multiline: true,
				line: 0,
			},
		]);
	});

	it('uses ?? for a reversed multi-line card', () => {
		expect(parseCards('front\n??\nback')[0]).toMatchObject({
			multiline: true,
			siblings: [
				{ sub: 0, front: 'front', back: 'back' },
				{ sub: 1, front: 'back', back: 'front' },
			],
		});
	});

	it('bounds multi-line cards by blank lines', () => {
		const [card] = parseCards('before\n\nf1\nf2\n?\nb1\nb2\n\nafter');
		expect(firstSibling(card)).toEqual({ sub: 0, front: 'f1\nf2', back: 'b1\nb2' });
		expect(card.line).toBe(2);
	});

	it('treats a block with ? as one card and uses only its first separator', () => {
		const [card] = parseCards('a::b\n?\nb1\n??\nb2');
		expect(firstSibling(card)).toEqual({ sub: 0, front: 'a::b', back: 'b1\n??\nb2' });
	});

	it('requires an exact ? or ?? separator line', () => {
		expect(parseCards('what is this?\nnot a card')).toEqual([]);
		expect(parseCards('front\n???\nback')).toEqual([]);
		expect(parseCards('front\n ? \nback')).toHaveLength(1);
	});

	it('reads identity tokens from both card formats', () => {
		const single = parseCards('q::a %%rem:single%%')[0];
		const multi = parseCards('%%rem:multi%%\nf\n?\nb')[0];
		expect(single.id).toBe('single');
		expect(firstSibling(single)).toMatchObject({ front: 'q', back: 'a' });
		expect(multi).toMatchObject({ id: 'multi', line: 1 });
		expect(firstSibling(multi)).toMatchObject({ front: 'f', back: 'b' });
	});

	it('removes identity tokens from content and ignores orphan tokens', () => {
		const [card] = parseCards('q %%rem:noise%% ::a\n?\nb %%rem:tail%%');
		expect(card.id).toBeNull();
		expect(firstSibling(card).front + firstSibling(card).back).not.toContain('%%rem:');
		expect(parseCards('%%rem:orphan%%')).toEqual([]);
	});

	it('does not parse frontmatter as cards', () => {
		expect(parseCards('---\ndeck: x\ntitle: "a::b"\n---\nq::a')).toEqual([
			{
				id: null,
				suspended: false,
				kind: 'basic',
				siblings: [{ sub: 0, front: 'q', back: 'a' }],
				multiline: false,
				line: 4,
			},
		]);
	});

	it('reads and removes a leading suspend marker for every card format', () => {
		const single = parseCards('{suspend} question::answer %%rem:single%%')[0];
		const reversed = parseCards('{suspend} front:::back')[0];
		const cloze = parseCards('{suspend} Capital: {{c1::Paris}}.')[0];
		const multi = parseCards('%%rem:multi%%\n{suspend} front line\n?\nback line')[0];

		for (const card of [single, reversed, cloze, multi]) expect(card.suspended).toBe(true);
		expect(firstSibling(single)).toEqual({ sub: 0, front: 'question', back: 'answer' });
		expect(firstSibling(reversed).front).toBe('front');
		expect(firstSibling(cloze).back).toBe('Capital: Paris.');
		expect(firstSibling(multi)).toEqual({ sub: 0, front: 'front line', back: 'back line' });
	});

	it('treats suspend as content unless it is an exact leading marker', () => {
		expect(parseCards('Question::answer {suspend}')[0].suspended).toBe(false);
		expect(parseCards('`{suspend}` Question::Answer')[0].suspended).toBe(false);
		expect(parseCards('{Suspend} Question::Answer')[0].suspended).toBe(false);
		expect(parseCards('\\{suspend} Question::Answer')[0].suspended).toBe(false);
	});

	it('does not parse cards inside fenced code blocks', () => {
		const text = ['before::card', '```md', 'inside::code', '?', '```', '~~~', 'also:::code', '~~~', 'after::card'].join(
			'\n',
		);
		expect(parseCards(text).map((card) => ({ front: firstSibling(card).front, line: card.line }))).toEqual([
			{ front: 'before', line: 0 },
			{ front: 'after', line: 8 },
		]);
	});

	it('preserves fenced code inside a multi-line card', () => {
		const [card] = parseCards(['Question', '```ts', 'const fake = "q::a";', '?', '```', '?', 'Answer'].join('\n'));
		expect(firstSibling(card)).toMatchObject({
			front: ['Question', '```ts', 'const fake = "q::a";', '?', '```'].join('\n'),
			back: 'Answer',
		});
		expect(card.multiline).toBe(true);
	});

	it('ignores inline code but finds a separator outside it', () => {
		expect(parseCards('Use `key::value` in settings')).toEqual([]);
		expect(firstSibling(parseCards('What does `key::value` mean?::A key-value pair')[0])).toMatchObject({
			front: 'What does `key::value` mean?',
			back: 'A key-value pair',
		});
	});

	it('preserves identity-like text inside code', () => {
		const [card] = parseCards(['Question', '```', '%%rem:literal%%', '```', '?', 'Answer'].join('\n'));
		expect(firstSibling(card).front).toContain('%%rem:literal%%');
		expect(card.id).toBeNull();
	});

	it('handles CRLF input', () => {
		const cards = parseCards('q::a\r\n\r\nf\r\n?\r\nb\r\n');
		expect(cards.map((card) => firstSibling(card))).toEqual([
			{ sub: 0, front: 'q', back: 'a' },
			{ sub: 0, front: 'f', back: 'b' },
		]);
	});

	it('creates one sibling per distinct explicit cloze number', () => {
		const [card] = parseCards('The {{c1::capital of France}} is {{c2::Paris}}.');

		expect(card).toMatchObject({ id: null, kind: 'cloze', multiline: false, line: 0 });
		expect(card.siblings).toEqual([
			{
				sub: 2,
				front: 'The […] is Paris.',
				back: 'The capital of France is Paris.',
			},
			{
				sub: 3,
				front: 'The capital of France is […].',
				back: 'The capital of France is Paris.',
			},
		]);
	});

	it('groups repeated cloze numbers and permits gaps', () => {
		const [card] = parseCards('{{c1::NaCl}} is {{c1::sodium chloride}}, containing {{c5::chloride}}.');

		expect(card.siblings.map(({ sub, front }) => ({ sub, front }))).toEqual([
			{ sub: 2, front: '[…] is […], containing chloride.' },
			{ sub: 6, front: 'NaCl is sodium chloride, containing […].' },
		]);
	});

	it('reads a cloze identity token and strips it from rendered sides', () => {
		const [card] = parseCards('The answer is {{c1::forty-two}}. %%rem:cloze%%');

		expect(card.id).toBe('cloze');
		expect(card.siblings).toEqual([
			{ sub: 2, front: 'The answer is […].', back: 'The answer is forty-two.' },
		]);
	});

	it('ignores cloze syntax in Markdown code', () => {
		expect(parseCards('Use `{{c1::value}}` here')).toEqual([]);
		expect(parseCards(['```md', '{{c1::inside}}', '```', 'Outside {{c1::answer}}'].join('\n'))).toHaveLength(1);
	});

	it('preserves Markdown code used as a cloze answer', () => {
		const [card] = parseCards('Call {{c1::`console.log()`}} to print a value.');

		expect(card.siblings).toEqual([
			{
				sub: 2,
				front: 'Call […] to print a value.',
				back: 'Call `console.log()` to print a value.',
			},
		]);
	});

	it('rejects implicit numbers, empty answers, and mixed card types', () => {
		expect(parseCards('Implicit {{c::answer}}')).toEqual([]);
		expect(parseCards('Zero {{c0::answer}}')).toEqual([]);
		expect(parseCards('Empty {{c1::}}')).toEqual([]);
		expect(parseCards('No hints {{c1::answer::hint}}')).toEqual([]);
		expect(parseCards('No nesting {{c1::{{c2::answer}}}}')).toEqual([]);
		expect(parseCards('Question::answer with {{c1::cloze}}')).toEqual([]);
		expect(parseCards('Question\n?\nanswer with {{c1::cloze}}')).toEqual([]);
	});
});
