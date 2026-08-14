import { describe, expect, it } from 'vitest';
import { maskMarkdownCode } from './markdown-code';

describe('maskMarkdownCode', () => {
	it('masks backtick and tilde fences', () => {
		const lines = ['```ts', 'inside::code', '```', '~~~', '?', '~~~', 'outside::card'];
		const masked = maskMarkdownCode(lines);

		expect(masked.slice(0, 6).every(({ searchable }) => searchable.trim() === '')).toBe(true);
		expect(masked[6].searchable).toBe(lines[6]);
	});

	it('requires a matching fence marker of at least the opening length', () => {
		const masked = maskMarkdownCode(['````', '```', 'still::code', '~~~~', 'also::code', '````', 'outside']);

		expect(masked[2].searchable.trim()).toBe('');
		expect(masked[4].searchable.trim()).toBe('');
		expect(masked[6].searchable).toBe('outside');
	});

	it('masks an unclosed fence through the end', () => {
		const masked = maskMarkdownCode(['before', '```', 'q::a', '?']);
		expect(masked.map(({ searchable }) => searchable.trim())).toEqual(['before', '', '', '']);
	});

	it('masks matched inline code spans and preserves offsets', () => {
		const [line] = maskMarkdownCode(['Use `key::value` or ``a`::b``::answer']);

		expect(line.searchable).not.toContain('key::value');
		expect(line.searchable).not.toContain('a`::b');
		expect(line.searchable.endsWith('::answer')).toBe(true);
		expect(line.searchable).toHaveLength(line.raw.length);
	});

	it('leaves unmatched and escaped backticks searchable', () => {
		const lines = ['unmatched `q::a', String.raw`escaped \`q::a`];
		expect(maskMarkdownCode(lines).map(({ searchable }) => searchable)).toEqual(lines);
	});

	it('always preserves line lengths', () => {
		const lines = ['```js', 'const value = `q::a`;', '```', 'outside `code`'];
		for (const line of maskMarkdownCode(lines)) expect(line.searchable).toHaveLength(line.raw.length);
	});
});
