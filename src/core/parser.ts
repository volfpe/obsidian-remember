// Pure note-text -> Card[] parsing. No Obsidian imports.

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
	const lines = text.split('\n');
	const start = bodyStart(lines);
	const isBlank = (i: number) => lines[i].trim() === '';

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
function bodyStart(lines: string[]): number {
	if (clean(lines[0]) !== '---') return 0;
	for (let i = 1; i < lines.length; i++) {
		const line = clean(lines[i]).trimEnd();
		if (line === '---' || line === '...') return i + 1;
	}
	return 0;
}
/** A block is the contiguous run of non-blank lines [start, end]. */
function parseBlock(lines: string[], start: number, end: number, out: ParsedCard[]): void {
	// A token on its own line directly above the block is the block's id (multi-line cards).
	const blockToken = TOKEN_ONLY.exec(lines[start].trim());
	const contentStart = blockToken ? start + 1 : start;
	const stripped = lines.slice(start, end + 1).map((line) => clean(line).replace(TOKEN, ''));

	let separator = -1;
	for (let i = contentStart; i <= end; i++) {
		const trimmed = stripped[i - start].trim();
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
			reversed: lines[separator].trim() === '??',
			multiline: true,
			line: contentStart,
		});
		return;
	}

	// Otherwise every line with :: / ::: is one single-line card.
	for (let i = start; i <= end; i++) {
		const raw = clean(lines[i]);
		const endToken = TOKEN_AT_END.exec(raw);
		const content = stripped[i - start];
		// Separators are checked longest-first: ::: before ::.
		const at3 = content.indexOf(':::');
		const at = at3 >= 0 ? at3 : content.indexOf('::');
		if (at < 0) continue;
		const width = at3 >= 0 ? 3 : 2;
		out.push({
			id: endToken ? endToken[1] : null,
			front: content.slice(0, at).trim(),
			back: content.slice(at + width).trim(),
			reversed: width === 3,
			multiline: false,
			line: i,
		});
	}
}

function blockText(lines: string[], from: number, to: number): string {
	const kept: string[] = [];
	for (let i = from; i <= to; i++) {
		const line = clean(lines[i]);
		if (TOKEN_ONLY.test(line.trim())) continue; // stray token lines are identity noise, never text
		kept.push(line.replace(TOKEN, ''));
	}
	return kept.join('\n');
}

function clean(line: string | undefined): string {
	return (line ?? '').replace(/\r$/, '');
}
