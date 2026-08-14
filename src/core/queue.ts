// Pure cards + states -> ordered review queue and due/new counts. No Obsidian imports.

import type { Card as FsrsCard } from 'ts-fsrs';
import type { ReviewEvent } from './events';
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

export interface DeckCounts {
	due: number;
	/** Never-reviewed siblings still available to introduce today. */
	new: number;
	/** Never-reviewed siblings held back by the daily limit. */
	waiting: number;
	total: number;
}

export function isDescendantDeck(deck: string, ancestor: string): boolean {
	return deck === ancestor || deck.startsWith(ancestor + '/');
}

/** Copy-pasting a stamped card duplicates its id; the earliest path/line keeps the queue slot. */
export function dedupeById(cards: NoteCard[]): { kept: NoteCard[]; dropped: NoteCard[] } {
	const seen = new Set<string>();
	const kept: NoteCard[] = [];
	const dropped: NoteCard[] = [];
	const ordered = [...cards].sort((a, b) => compareStrings(a.path, b.path) || a.line - b.line);
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

function compareStrings(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}

function subsOf(card: NoteCard): readonly (0 | 1)[] {
	return card.reversed ? [0, 1] : [0];
}

/** Siblings whose first active review falls within `now`'s local calendar day. */
export function introducedTodaySiblingKeys(events: ReviewEvent[], now: Date): Set<string> {
	const firstReviewAt = new Map<string, number>();
	for (const event of events) {
		const key = siblingKey(event.c, event.s);
		const timestamp = new Date(event.t).getTime();
		const first = firstReviewAt.get(key);
		if (first === undefined || timestamp < first) firstReviewAt.set(key, timestamp);
	}

	const start = new Date(now);
	start.setHours(0, 0, 0, 0);
	const end = new Date(start);
	end.setDate(end.getDate() + 1);
	const introduced = new Set<string>();
	for (const [key, timestamp] of firstReviewAt) {
		if (timestamp >= start.getTime() && timestamp < end.getTime()) introduced.add(key);
	}
	return introduced;
}

/** Review-sibling counts for the deck list. Unstamped cards count as new. */
export function countDeckStats(
	cards: NoteCard[],
	states: Map<string, FsrsCard>,
	now: Date,
	introducedToday: ReadonlySet<string> = new Set(),
	newCardsPerDay = Number.POSITIVE_INFINITY,
): DeckCounts {
	let due = 0;
	let unseen = 0;
	let introduced = 0;
	let total = 0;
	for (const card of cards) {
		for (const sub of subsOf(card)) {
			total++;
			const key = card.id === null ? null : siblingKey(card.id, sub);
			const state = key === null ? undefined : states.get(key);
			if (!state) unseen++;
			else if (state.due.getTime() <= now.getTime()) due++;
			if (key !== null && introducedToday.has(key)) introduced++;
		}
	}
	const remaining = Math.max(0, newCardsPerDay - introduced);
	const available = Math.min(unseen, remaining);
	return { due, new: available, waiting: unseen - available, total };
}

/** Due siblings by due date ascending, then the oldest stamped new siblings. */
export function buildQueue(
	cards: NoteCard[],
	states: Map<string, FsrsCard>,
	now: Date,
	maxNewCards = Number.POSITIVE_INFINITY,
): QueueItem[] {
	const due: { item: QueueItem; tiebreak: number }[] = [];
	const fresh: { item: QueueItem; key: string }[] = [];
	for (const card of cards) {
		if (card.id === null) continue;
		for (const sub of subsOf(card)) {
			const state = states.get(siblingKey(card.id, sub)) ?? null;
			if (state && state.due.getTime() > now.getTime()) continue;
			const key = siblingKey(card.id, sub);
			const item: QueueItem = {
				path: card.path,
				line: card.line,
				cardId: card.id,
				sub,
				front: sub === 0 ? card.front : card.back,
				back: sub === 0 ? card.back : card.front,
				state,
				showAt: state ? state.due : now,
			};
			if (state) due.push({ item, tiebreak: Math.random() });
			else fresh.push({ item, key });
		}
	}
	due.sort((a, b) => a.item.showAt.getTime() - b.item.showAt.getTime() || a.tiebreak - b.tiebreak);
	fresh.sort((a, b) => compareStrings(a.key, b.key));
	const selectedFresh = fresh
		.slice(0, maxNewCards)
		.map(({ item }) => ({ item, tiebreak: Math.random() }))
		.sort((a, b) => a.tiebreak - b.tiebreak)
		.map(({ item }) => item);
	return [...due.map(({ item }) => item), ...selectedFresh];
}
