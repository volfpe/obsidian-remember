// Pure card-note file content and file naming. No Obsidian imports.

import {
	BACK_HEADING,
	FRONT_HEADING,
	ID_PROPERTY,
	REVERSE_PROPERTY,
	SUSPEND_PROPERTY,
	TYPE_PROPERTY,
	type CardKind,
} from './card-note';

export const CLOZE_PLACEHOLDER_ANSWER = 'answer';
export const CLOZE_PLACEHOLDER = `==c1:${CLOZE_PLACEHOLDER_ANSWER}==`;

export interface NewCardSpec {
	id: string;
	kind: CardKind;
	/** Basic cards only. */
	reverse?: boolean;
	suspended?: boolean;
	/** Basic front markdown. */
	front?: string;
	/** Basic back markdown. */
	back?: string;
	/** Cloze body markdown; defaults to a placeholder cloze. */
	body?: string;
}

/** The full text of a new card note. Always ends with a newline. */
export function cardNoteContent(spec: NewCardSpec): string {
	const frontmatter = ['---', `${ID_PROPERTY}: ${spec.id}`, `${TYPE_PROPERTY}: ${spec.kind}`];
	if (spec.kind === 'basic') {
		frontmatter.push(`${REVERSE_PROPERTY}: ${spec.reverse === true ? 'true' : 'false'}`);
	}
	if (spec.suspended === true) frontmatter.push(`${SUSPEND_PROPERTY}: true`);
	frontmatter.push('---');

	const body =
		spec.kind === 'basic'
			? [FRONT_HEADING, '', ...section(spec.front), BACK_HEADING, '', ...section(spec.back)]
			: [(spec.body ?? CLOZE_PLACEHOLDER).replace(/\s+$/, '')];
	return [...frontmatter, '', ...body].join('\n') + '\n';
}

function section(text: string | undefined): string[] {
	const trimmed = text?.replace(/\s+$/, '') ?? '';
	return trimmed === '' ? [''] : [...trimmed.split('\n'), ''];
}

/**
 * A file base name (without .md) derived from the card name: Obsidian-forbidden and
 * link-breaking characters removed, whitespace collapsed, length capped. Falls back
 * to the card id when nothing usable remains.
 */
export function cardFileBaseName(name: string, fallbackId: string): string {
	const cleaned = name
		.replace(/[*"\\/<>:|?#^[\]]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim()
		.replace(/^\.+/, '')
		.replace(/\.+$/, '')
		.trim();
	const capped = cleaned.length > 60 ? cleaned.slice(0, 60).replace(/\S*$/, '').trim() || cleaned.slice(0, 60).trim() : cleaned;
	return capped === '' ? fallbackId : capped;
}

/**
 * Human-readable file-name source: the whole front text (or cloze body with answers
 * revealed), flattened to one line and stripped of Markdown decoration. Length capping
 * and character sanitizing happen in cardFileBaseName.
 */
export function slugSource(spec: NewCardSpec): string {
	const text = spec.kind === 'cloze' ? (spec.body ?? '') : (spec.front ?? '');
	return text
		.replace(/==c[0-9]+:(.*?)==/g, '$1')
		.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
		.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
		.replace(/[*_~`>|]/g, '')
		.split('\n')
		.join(' ');
}

export interface CursorTarget {
	line: number;
	ch: number;
	/** Selection end for a pre-selected placeholder, when present. */
	toCh?: number;
}

/** Where the editor cursor belongs in freshly created content: the first thing to fill in. */
export function newCardCursor(content: string, spec: NewCardSpec): CursorTarget | null {
	const lines = content.split('\n');
	if (spec.kind === 'cloze') {
		if (spec.body !== undefined) return endOfContent(lines);
		const line = lines.findIndex((text) => text.includes(CLOZE_PLACEHOLDER));
		if (line < 0) return null;
		const ch = lines[line].indexOf(CLOZE_PLACEHOLDER) + '==c1:'.length;
		return { line, ch, toCh: ch + CLOZE_PLACEHOLDER_ANSWER.length };
	}
	const front = spec.front ?? '';
	const back = spec.back ?? '';
	if (front !== '' && back !== '') return endOfContent(lines);
	const heading = front === '' ? FRONT_HEADING : BACK_HEADING;
	const at = lines.findIndex((text) => text === heading);
	if (at < 0) return null;
	return { line: at + 1, ch: 0 };
}

function endOfContent(lines: string[]): CursorTarget {
	for (let i = lines.length - 1; i >= 0; i--) {
		if (lines[i].trim() !== '') return { line: i, ch: lines[i].length };
	}
	return { line: 0, ch: 0 };
}
