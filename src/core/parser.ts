// Pure note-text -> Card[] parsing. No Obsidian imports.

import { maskMarkdownCode, type MarkdownLine } from './markdown-code';

export interface ParsedCard {
	/** Identity token id, or null while the card is unstamped. */
	id: string | null;
	/** Markdown of the question side; %%rem%% tokens stripped. */
	front: string;
	/** Markdown of the answer side; %%rem%% tokens stripped. */
	back: string;
	/** Reversed cards (`:::` / `??`) have two siblings: forward (sub 0) and reverse (sub 1). */
	reversed: boolean;
	/** Multi-line (`?` / `??` block) vs single-line (`::`). Decides where the id token goes. */
	multiline: boolean;
	/** 0-based first content line and stamp insertion point. */
	line: number;
}

export const TOKEN_PATTERN = '%%rem:[0-9a-z]+%%';
const TOKEN = new RegExp(TOKEN_PATTERN, 'g');
const TOKEN_ONLY = /^%%rem:([0-9a-z]+)%%$/;
const TOKEN_AT_END = /%%rem:([0-9a-z]+)%%\s*$/;

export function parseCards(text: string): ParsedCard[] {
	const lines = maskMarkdownCode(text.split('\n').map(clean));
	const start = bodyStart(lines);
	const isBlank = (i: number) => lines[i].raw.trim() === '';

	const cards: ParsedCard[] = [];
	let i = start;
	while (i < lines.length) {
		if (isBlank(i)) {
			i++;
			continue;
		}
		let end = i;
		while (end + 1 < lines.length && !isBlank(end + 1)) end++;
		parseBlock(lines, i, end, cards);
		i = end + 1;
	}
	return cards;
}

/** Frontmatter is metadata (it carries the deck property), never card text. */
function bodyStart(lines: readonly MarkdownLine[]): number {
	if (lines[0]?.raw !== '---') return 0;
	for (let i = 1; i < lines.length; i++) {
		const line = lines[i].raw.trimEnd();
		if (line === '---' || line === '...') return i + 1;
	}
	return 0;
}
/** A block is the contiguous run of non-blank lines [start, end]. */
function parseBlock(lines: readonly MarkdownLine[], start: number, end: number, out: ParsedCard[]): void {
	// A token on its own line directly above the block is the block's id (multi-line cards).
	const first = lines[start];
	const blockToken = first.raw.trim() === first.searchable.trim() ? TOKEN_ONLY.exec(first.raw.trim()) : null;
	const contentStart = blockToken ? start + 1 : start;

	let separator = -1;
	for (let i = contentStart; i <= end; i++) {
		const trimmed = lines[i].searchable.trim();
		if (trimmed === '?' || trimmed === '??') {
			separator = i;
			break;
		}
	}

	// A block with a ?/?? line is one multi-line card. Nothing inside it is parsed further.
	if (separator >= 0) {
		out.push({
			id: blockToken ? blockToken[1] : null,
			front: blockText(lines, contentStart, separator - 1),
			back: blockText(lines, separator + 1, end),
			reversed: lines[separator].searchable.trim() === '??',
			multiline: true,
			line: contentStart,
		});
		return;
	}

	// Otherwise every line with :: / ::: is one single-line card.
	for (let i = start; i <= end; i++) {
		const { raw, searchable } = lines[i];
		const endToken = tokenAtEnd(raw, searchable);
		// Separators are checked longest-first: ::: before ::.
		const at3 = searchable.indexOf(':::');
		const at = at3 >= 0 ? at3 : searchable.indexOf('::');
		if (at < 0) continue;
		const width = at3 >= 0 ? 3 : 2;
		out.push({
			id: endToken ? endToken[1] : null,
			front: stripTokens(raw.slice(0, at), searchable.slice(0, at)).trim(),
			back: stripTokens(raw.slice(at + width), searchable.slice(at + width)).trim(),
			reversed: width === 3,
			multiline: false,
			line: i,
		});
	}
}

function blockText(lines: readonly MarkdownLine[], from: number, to: number): string {
	const kept: string[] = [];
	for (let i = from; i <= to; i++) {
		const { raw, searchable } = lines[i];
		if (raw.trim() === searchable.trim() && TOKEN_ONLY.test(raw.trim())) continue;
		kept.push(stripTokens(raw, searchable));
	}
	return kept.join('\n');
}

function tokenAtEnd(raw: string, searchable: string): RegExpExecArray | null {
	const match = TOKEN_AT_END.exec(raw);
	if (match === null) return null;
	const token = `%%rem:${match[1]}%%`;
	return searchable.slice(match.index, match.index + token.length) === token ? match : null;
}

function stripTokens(raw: string, searchable: string): string {
	let result = '';
	let start = 0;
	TOKEN.lastIndex = 0;
	for (let match = TOKEN.exec(searchable); match !== null; match = TOKEN.exec(searchable)) {
		result += raw.slice(start, match.index);
		start = match.index + match[0].length;
	}
	return result + raw.slice(start);
}

function clean(line: string | undefined): string {
	return (line ?? '').replace(/\r$/, '');
}
