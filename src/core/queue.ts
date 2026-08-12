// Pure cards + states -> ordered review queue and due/new counts. No Obsidian imports.

import type { Card as FsrsCard } from 'ts-fsrs';
import type { ParsedCard } from './parser';
import { siblingKey } from './scheduler';

/** A rated sibling may re-enter the current session within this learn-ahead limit. */
export const LEARN_AHEAD_LIMIT_MS = 10 * 60 * 1000;

/** A parsed card located in the vault. */
export interface NoteCard extends ParsedCard {
	path: string;
	deck: string;
}

export interface QueueItem {
	path: string;
	line: number;
	cardId: string;
	sub: 0 | 1;
	/** Question/answer for this direction: sub 1 swaps the card's sides. */
	front: string;
	back: string;
	/** Folded FSRS state; null = new (never rated). */
	state: FsrsCard | null;
	/** Queue position: the sibling's due date, or `now` for new cards. */
	showAt: Date;
}

export function isDescendantDeck(deck: string, ancestor: string): boolean {
	return deck === ancestor || deck.startsWith(ancestor + '/');
}

/** Copy-pasting a stamped card duplicates its id; the earliest path/line keeps the queue slot. */
export function dedupeById(cards: NoteCard[]): { kept: NoteCard[]; dropped: NoteCard[] } {
	const seen = new Set<string>();
	const kept: NoteCard[] = [];
	const dropped: NoteCard[] = [];
	const ordered = [...cards].sort((a, b) => comparePath(a.path, b.path) || a.line - b.line);
	for (const card of ordered) {
		if (card.id !== null && seen.has(card.id)) {
			dropped.push(card);
			continue;
		}
		if (card.id !== null) seen.add(card.id);
		kept.push(card);
	}
	return { kept, dropped };
}

/** Globally deduplicates first, then restricts the result to a deck and its descendants. */
export function selectCards(cards: NoteCard[], deck?: string): { kept: NoteCard[]; dropped: NoteCard[] } {
	const { kept, dropped } = dedupeById(cards);
	return {
		kept: deck === undefined ? kept : kept.filter((card) => isDescendantDeck(card.deck, deck)),
		dropped,
	};
}

function comparePath(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}

function subsOf(card: NoteCard): readonly (0 | 1)[] {
	return card.reversed ? [0, 1] : [0];
}

/** Review-sibling counts for the deck list. Unstamped cards count as new. */
export function countDeckStats(
	cards: NoteCard[],
	states: Map<string, FsrsCard>,
	now: Date,
): { due: number; new: number; total: number } {
	let due = 0;
	let fresh = 0;
	let total = 0;
	for (const card of cards) {
		for (const sub of subsOf(card)) {
			total++;
			const state = card.id === null ? undefined : states.get(siblingKey(card.id, sub));
			if (!state) fresh++;
			else if (state.due.getTime() <= now.getTime()) due++;
		}
	}
	return { due, new: fresh, total };
}

/** Due siblings by due date ascending, then new siblings; ties shuffled. Cards must be stamped. */
export function buildQueue(cards: NoteCard[], states: Map<string, FsrsCard>, now: Date): QueueItem[] {
	const entries: { item: QueueItem; tiebreak: number }[] = [];
	for (const card of cards) {
		if (card.id === null) continue;
		for (const sub of subsOf(card)) {
			const state = states.get(siblingKey(card.id, sub)) ?? null;
			if (state && state.due.getTime() > now.getTime()) continue;
			entries.push({
				item: {
					path: card.path,
					line: card.line,
					cardId: card.id,
					sub,
					front: sub === 0 ? card.front : card.back,
					back: sub === 0 ? card.back : card.front,
					state,
					showAt: state ? state.due : now,
				},
				tiebreak: Math.random(),
			});
		}
	}
	entries.sort((a, b) => a.item.showAt.getTime() - b.item.showAt.getTime() || a.tiebreak - b.tiebreak);
	return entries.map((entry) => entry.item);
}
