// The one note mutation in the codebase: inserting %%rem:<id>%% identity tokens (durability rule 1).

import type { App, TFile } from 'obsidian';
import { randomId } from './core/id';
import { parseCards } from './core/parser';

/**
 * Returns the text with a fresh id token inserted for every unstamped card.
 * Single-line cards get the token at the end of the line; multi-line cards get it
 * on its own line directly above the block.
 */
export function stampText(text: string, mint: () => string = randomId): string {
	const unstamped = parseCards(text).filter((card) => card.id === null);
	if (unstamped.length === 0) return text;
	const lines = text.split('\n');
	// Bottom-up, so earlier insertions don't shift later line numbers.
	for (const card of unstamped.sort((a, b) => b.line - a.line)) {
		const token = `%%rem:${mint()}%%`;
		if (card.multiline) lines.splice(card.line, 0, token + (lines[card.line]?.endsWith('\r') ? '\r' : ''));
		else lines[card.line] = lines[card.line].replace(/\r?$/, (eol) => ` ${token}${eol}`);
	}
	return lines.join('\n');
}

/**
 * Stamps every unstamped card of one note, atomically. The callback re-parses the fresh
 * content to locate insertion points — never stale positions. Resolves to the new text,
 * so the session can be built from exactly what was written.
 */
export function stampNote(app: App, file: TFile): Promise<string> {
	return app.vault.process(file, (text) => stampText(text));
}
