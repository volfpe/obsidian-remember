import { describe, expect, it } from 'vitest';
import { parseCardNote } from './card-note';
import { cardFileBaseName, cardNoteContent, newCardCursor, CLOZE_PLACEHOLDER } from './new-card';

describe('cardNoteContent', () => {
	it('writes a complete basic card that parses back to the same sides', () => {
		const content = cardNoteContent({
			id: 'card1',
			kind: 'basic',
			reverse: true,
			front: 'hola',
			back: 'hello',
		});

		expect(content).toContain('remember-id: card1');
		expect(content).toContain('remember-type: basic');
		expect(content).toContain('remember-reverse: true');
		expect(content).not.toContain('suspend');
		const parsed = parseCardNote(content, { 'remember-id': 'card1', 'remember-type': 'basic', 'remember-reverse': true });
		expect(parsed.siblings).toEqual([
			{ sub: 0, front: 'hola', back: 'hello' },
			{ sub: 1, front: 'hello', back: 'hola' },
		]);
	});

	it('writes an empty basic template with both headings ready to fill', () => {
		const content = cardNoteContent({ id: 'card1', kind: 'basic', reverse: false });

		expect(content).toContain('remember-reverse: false');
		expect(parseCardNote(content, { 'remember-id': 'card1', 'remember-type': 'basic' }).siblings).toEqual([]);
	});

	it('writes a cloze card with a placeholder cloze by default', () => {
		const content = cardNoteContent({ id: 'card1', kind: 'cloze' });

		expect(content).toContain(CLOZE_PLACEHOLDER);
		expect(content).not.toContain('reverse');
		const withBody = cardNoteContent({ id: 'card1', kind: 'cloze', body: 'x is {{c1::y}}', suspended: true });
		expect(withBody).toContain('remember-suspend: true');
		expect(parseCardNote(withBody, { 'remember-id': 'card1', 'remember-type': 'cloze' }).siblings).toHaveLength(1);
	});
});

describe('cardFileBaseName', () => {
	it('removes forbidden characters, collapses spaces, and caps the length', () => {
		expect(cardFileBaseName('What article does "mano" take?', 'id1')).toBe('What article does mano take');
		expect(cardFileBaseName('a/b\\c:d|e#f^g[h]i*j', 'id1')).toBe('a b c d e f g h i j');
		expect(cardFileBaseName('.hidden.', 'id1')).toBe('hidden');
		const long = 'word '.repeat(30).trim();
		expect(cardFileBaseName(long, 'id1').length).toBeLessThanOrEqual(60);
	});

	it('falls back to the card id when nothing usable remains', () => {
		expect(cardFileBaseName('', 'id1')).toBe('id1');
		expect(cardFileBaseName('???', 'id1')).toBe('id1');
	});
});

describe('newCardCursor', () => {
	it('targets the first thing to fill in', () => {
		const emptyBasic = { id: 'x', kind: 'basic' as const };
		const emptyContent = cardNoteContent(emptyBasic);
		expect(emptyContent.split('\n')[newCardCursor(emptyContent, emptyBasic)!.line - 1]).toBe('# Front');

		const named = { id: 'x', kind: 'basic' as const, front: 'hola' };
		const namedContent = cardNoteContent(named);
		expect(namedContent.split('\n')[newCardCursor(namedContent, named)!.line - 1]).toBe('# Back');

		const filled = { id: 'x', kind: 'basic' as const, front: 'hola', back: 'hello' };
		const filledContent = cardNoteContent(filled);
		const end = newCardCursor(filledContent, filled)!;
		expect(filledContent.split('\n')[end.line]).toBe('hello');

		const cloze = { id: 'x', kind: 'cloze' as const };
		const clozeContent = cardNoteContent(cloze);
		const cursor = newCardCursor(clozeContent, cloze)!;
		const line = clozeContent.split('\n')[cursor.line];
		expect(line.slice(cursor.ch, cursor.toCh)).toBe('answer');
	});
});
