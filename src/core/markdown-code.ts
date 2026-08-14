export interface MarkdownLine {
	raw: string;
	/** Same length as raw, with Markdown code replaced by spaces. */
	searchable: string;
}

interface Fence {
	marker: '`' | '~';
	length: number;
}

/**
 * Masks fenced code blocks and inline backtick spans without changing offsets.
 * The result can be searched for card syntax and indexed back into the raw line.
 */
export function maskMarkdownCode(lines: readonly string[]): MarkdownLine[] {
	let fence: Fence | null = null;

	return lines.map((raw) => {
		if (fence !== null) {
			const searchable = spaces(raw);
			if (isFenceClose(raw, fence)) fence = null;
			return { raw, searchable };
		}

		const opening = fenceOpen(raw);
		if (opening !== null) {
			fence = opening;
			return { raw, searchable: spaces(raw) };
		}

		return { raw, searchable: maskInlineCode(raw) };
	});
}

function fenceOpen(line: string): Fence | null {
	const match = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
	if (match === null) return null;
	const run = match[1];
	if (run[0] === '`' && match[2].includes('`')) return null;
	return { marker: run[0] as '`' | '~', length: run.length };
}

function isFenceClose(line: string, fence: Fence): boolean {
	const match = /^ {0,3}(`{3,}|~{3,})[\t ]*$/.exec(line);
	return match !== null && match[1][0] === fence.marker && match[1].length >= fence.length;
}

function maskInlineCode(line: string): string {
	let searchable = line;
	let cursor = 0;

	while (cursor < line.length) {
		const opening = line.indexOf('`', cursor);
		if (opening < 0) break;
		const openingLength = runLength(line, opening, '`');
		if (isEscaped(line, opening)) {
			cursor = opening + openingLength;
			continue;
		}

		let closing = opening + openingLength;
		while (closing < line.length) {
			closing = line.indexOf('`', closing);
			if (closing < 0) break;
			const closingLength = runLength(line, closing, '`');
			if (closingLength === openingLength) break;
			closing += closingLength;
		}

		if (closing < 0) {
			cursor = opening + openingLength;
			continue;
		}

		const end = closing + openingLength;
		searchable = searchable.slice(0, opening) + spaces(line.slice(opening, end)) + searchable.slice(end);
		cursor = end;
	}

	return searchable;
}

function runLength(text: string, start: number, character: string): number {
	let end = start;
	while (text[end] === character) end++;
	return end - start;
}

function isEscaped(text: string, index: number): boolean {
	let slashes = 0;
	for (let i = index - 1; i >= 0 && text[i] === '\\'; i--) slashes++;
	return slashes % 2 === 1;
}

function spaces(text: string): string {
	return ' '.repeat(text.length);
}
