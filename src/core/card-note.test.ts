import { describe, expect, it } from 'vitest';
import { parseCardNote } from './card-note';

const basicNote = ['# Front', '', 'hola', '', '# Back', '', 'hello', ''].join('\n');

describe('basic card notes', () => {
	it('parses front and back sections into one sibling', () => {
		const card = parseCardNote(basicNote, { 'remember-id': 'card1', 'remember-type': 'basic' });

		expect(card).toMatchObject({
			id: 'card1',
			kind: 'basic',
			declaredKind: 'basic',
			suspended: false,
			reverse: false,
		});
		expect(card.siblings).toEqual([{ sub: 0, front: 'hola', back: 'hello' }]);
		expect(card.line).toBe(2);
	});

	it('adds a reverse sibling when frontmatter says so', () => {
		const card = parseCardNote(basicNote, { 'remember-id': 'card1', 'remember-type': 'basic', 'remember-reverse': true });

		expect(card.siblings).toEqual([
			{ sub: 0, front: 'hola', back: 'hello' },
			{ sub: 1, front: 'hello', back: 'hola' },
		]);
	});

	it('keeps multi-line markdown content and skips frontmatter', () => {
		const text = [
			'---',
			'remember-id: card1',
			'remember-type: basic',
			'---',
			'',
			'# Front',
			'',
			'What does `a::b` mean?',
			'',
			'- context line',
			'',
			'# Back',
			'',
			'first',
			'',
			'second',
			'',
		].join('\n');
		const card = parseCardNote(text, { 'remember-id': 'card1', 'remember-type': 'basic' });

		expect(card.siblings[0].front).toBe('What does `a::b` mean?\n\n- context line');
		expect(card.siblings[0].back).toBe('first\n\nsecond');
		expect(card.line).toBe(7);
	});

	it('accepts case-insensitive headings and ignores content before # Front', () => {
		const card = parseCardNote('intro\n# front\nq\n# BACK\na', { 'remember-type': 'basic' });

		expect(card.siblings).toEqual([{ sub: 0, front: 'q', back: 'a' }]);
	});

	it('ignores headings inside fenced code', () => {
		const text = ['# Front', 'q', '```', '# Back', '```', '# Back', 'a'].join('\n');
		const card = parseCardNote(text, { 'remember-type': 'basic' });

		expect(card.siblings[0].front).toBe('q\n```\n# Back\n```');
		expect(card.siblings[0].back).toBe('a');
	});

	it('produces no siblings while a section is missing or empty', () => {
		expect(parseCardNote('no headings here', { 'remember-type': 'basic' }).siblings).toEqual([]);
		expect(parseCardNote('# Front\n\n# Back\na', { 'remember-type': 'basic' }).siblings).toEqual([]);
		expect(parseCardNote('# Front\nq', { 'remember-type': 'basic' }).siblings).toEqual([]);
		expect(parseCardNote('# Front\nq\n# Back\n\n', { 'remember-type': 'basic' }).siblings).toEqual([]);
	});
});

describe('cloze card notes', () => {
	it('creates one sibling per distinct number across the whole body', () => {
		const text = 'The capital of ==c1:France==\nis ==c2:Paris==.';
		const card = parseCardNote(text, { 'remember-id': 'card1', 'remember-type': 'cloze' });

		expect(card.kind).toBe('cloze');
		expect(card.siblings).toEqual([
			{ sub: 2, front: 'The capital of […]\nis Paris.', back: 'The capital of ==France==\nis Paris.' },
			{ sub: 3, front: 'The capital of France\nis […].', back: 'The capital of France\nis ==Paris==.' },
		]);
	});

	it('hides repeated numbers together and permits gaps', () => {
		const card = parseCardNote('==c1:NaCl== is ==c1:salt==, with ==c5:chloride==.', { 'remember-type': 'cloze' });

		expect(card.siblings.map(({ sub, front }) => ({ sub, front }))).toEqual([
			{ sub: 2, front: '[…] is […], with chloride.' },
			{ sub: 6, front: 'NaCl is salt, with […].' },
		]);
	});

	it('ignores cloze syntax inside code but keeps code answers', () => {
		expect(parseCardNote('Use `==c1:x==` here', { 'remember-type': 'cloze' }).siblings).toEqual([]);
		const card = parseCardNote('Call ==c1:`console.log()`== to print.', { 'remember-type': 'cloze' });
		expect(card.siblings[0].back).toBe('Call ==`console.log()`== to print.');
	});

	it('produces no siblings for missing or malformed clozes', () => {
		expect(parseCardNote('prose without clozes', { 'remember-type': 'cloze' }).siblings).toEqual([]);
		expect(parseCardNote('Empty ==c1:==', { 'remember-type': 'cloze' }).siblings).toEqual([]);
		expect(parseCardNote('Implicit ==c:answer==', { 'remember-type': 'cloze' }).siblings).toEqual([]);
		expect(parseCardNote('Mixed ==c1:ok== and ==c:broken==', { 'remember-type': 'cloze' }).siblings).toEqual([]);
		expect(parseCardNote('Zero ==c0:answer==', { 'remember-type': 'cloze' }).siblings).toEqual([]);
		expect(parseCardNote('Unfinished ==c1:answer', { 'remember-type': 'cloze' }).siblings).toEqual([]);
	});
});

describe('frontmatter metadata', () => {
	it('reads id, suspend, and reverse; tolerates YAML-mangled ids', () => {
		expect(parseCardNote(basicNote, { 'remember-id': 'card1', 'remember-type': 'basic', 'remember-suspend': true }).suspended).toBe(true);
		expect(parseCardNote(basicNote, { 'remember-id': 123456, 'remember-type': 'basic' }).id).toBe('123456');
		expect(parseCardNote(basicNote, { 'remember-id': '  ', 'remember-type': 'basic' }).id).toBeNull();
		expect(parseCardNote(basicNote, { 'remember-id': 'a b', 'remember-type': 'basic' }).id).toBeNull();
		expect(parseCardNote(basicNote, { 'remember-type': 'basic' }).id).toBeNull();
		expect(parseCardNote(basicNote, { 'remember-type': 'basic', 'remember-reverse': 'yes' }).reverse).toBe(false);
	});

	it('infers the kind when frontmatter has no valid type', () => {
		expect(parseCardNote(basicNote, {})).toMatchObject({ kind: 'basic', declaredKind: null });
		expect(parseCardNote('x ==c1:y==', undefined)).toMatchObject({ kind: 'cloze', declaredKind: null });
		expect(parseCardNote(basicNote, { 'remember-type': 'weird' }).declaredKind).toBeNull();
		expect(parseCardNote('plain prose note', {})).toMatchObject({
			kind: null,
			siblings: [],
		});
	});

	it('lets a declared type win over body inference', () => {
		const card = parseCardNote('body with ==c1:cloze==', { 'remember-type': 'basic' });
		expect(card).toMatchObject({ kind: 'basic', siblings: [] });
	});
});
