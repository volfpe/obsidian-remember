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
	/** Stable sibling index supplied by the parsed card. */
	sub: number;
	/** Markdown rendered for this sibling's question and answer. */
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
	/** Due or new siblings held until another study day. */
	buried: number;
	total: number;
}

export interface DeckStatsOptions {
	introducedToday?: ReadonlySet<string>;
	reviewedToday?: ReadonlySet<string>;
	newCardsPerDay?: number;
	burySiblings?: boolean;
}

export interface QueueOptions {
	maxNewCards?: number;
	reviewedToday?: ReadonlySet<string>;
	burySiblings?: boolean;
}

interface AvailableSibling {
	card: NoteCard;
	/** Stable group identity, including before a card is stamped. */
	groupKey: string;
	key: string | null;
	sub: number;
	front: string;
	back: string;
	state: FsrsCard | null;
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

function localDayBounds(now: Date): { start: number; end: number } {
	const start = new Date(now);
	start.setHours(0, 0, 0, 0);
	const end = new Date(start);
	end.setDate(end.getDate() + 1);
	return { start: start.getTime(), end: end.getTime() };
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

	const { start, end } = localDayBounds(now);
	const introduced = new Set<string>();
	for (const [key, timestamp] of firstReviewAt) {
		if (timestamp >= start && timestamp < end) introduced.add(key);
	}
	return introduced;
}

/** Every sibling with an active review during `now`'s local calendar day. */
export function reviewedTodaySiblingKeys(events: ReviewEvent[], now: Date): Set<string> {
	const { start, end } = localDayBounds(now);
	const reviewed = new Set<string>();
	for (const event of events) {
		const timestamp = new Date(event.t).getTime();
		if (timestamp >= start && timestamp < end) reviewed.add(siblingKey(event.c, event.s));
	}
	return reviewed;
}

function availableSiblings(
	cards: NoteCard[],
	states: Map<string, FsrsCard>,
	now: Date,
): AvailableSibling[] {
	const available: AvailableSibling[] = [];
	for (const card of cards) {
		for (const sibling of card.siblings) {
			const { sub } = sibling;
			const key = card.id === null ? null : siblingKey(card.id, sub);
			const state = key === null ? null : (states.get(key) ?? null);
			if (state && state.due.getTime() > now.getTime()) continue;
			available.push({
				card,
				groupKey: card.id === null ? `unstamped:${card.path}:${card.line}` : `card:${card.id}`,
				key,
				sub,
				front: sibling.front,
				back: sibling.back,
				state,
				showAt: state ? state.due : now,
			});
		}
	}
	return available;
}

/** Selects at most one not-yet-reviewed-today sibling from each group. */
function applySiblingBurying(
	available: AvailableSibling[],
	reviewedToday: ReadonlySet<string>,
	burySiblings: boolean,
): { selected: AvailableSibling[]; buried: number } {
	if (!burySiblings) return { selected: available, buried: 0 };
	const reviewedGroups = new Set<string>();
	for (const key of reviewedToday) {
		const separator = key.lastIndexOf('#');
		if (separator >= 0) reviewedGroups.add(`card:${key.slice(0, separator)}`);
	}

	const groups = new Map<string, AvailableSibling[]>();
	for (const sibling of available) {
		const group = groups.get(sibling.groupKey);
		if (group) group.push(sibling);
		else groups.set(sibling.groupKey, [sibling]);
	}

	const selected: AvailableSibling[] = [];
	let buried = 0;
	for (const group of groups.values()) {
		if (reviewedGroups.has(group[0].groupKey)) {
			const alreadyReviewed = group.filter(
				(sibling) => sibling.key !== null && reviewedToday.has(sibling.key),
			);
			selected.push(...alreadyReviewed);
			buried += group.length - alreadyReviewed.length;
			continue;
		}

		group.sort(compareSiblingPriority);
		selected.push(group[0]);
		buried += group.length - 1;
	}
	return { selected, buried };
}

/** A scheduled sibling wins over a new one; otherwise the earliest due/index wins. */
function compareSiblingPriority(a: AvailableSibling, b: AvailableSibling): number {
	if (a.state !== null && b.state === null) return -1;
	if (a.state === null && b.state !== null) return 1;
	return a.showAt.getTime() - b.showAt.getTime() || a.sub - b.sub;
}

/** Review-sibling counts for the deck list. Unstamped cards count as new. */
export function countDeckStats(
	cards: NoteCard[],
	states: Map<string, FsrsCard>,
	now: Date,
	options: DeckStatsOptions = {},
): DeckCounts {
	const {
		introducedToday = new Set<string>(),
		reviewedToday = new Set<string>(),
		newCardsPerDay = Number.POSITIVE_INFINITY,
		burySiblings = true,
	} = options;
	let due = 0;
	let unseen = 0;
	let introduced = 0;
	let total = 0;
	for (const card of cards) {
		for (const { sub } of card.siblings) {
			total++;
			const key = card.id === null ? null : siblingKey(card.id, sub);
			if (key !== null && introducedToday.has(key)) introduced++;
		}
	}
	const selection = applySiblingBurying(
		availableSiblings(cards, states, now),
		reviewedToday,
		burySiblings,
	);
	for (const sibling of selection.selected) {
		if (sibling.state === null) unseen++;
		else due++;
	}
	const remaining = Math.max(0, newCardsPerDay - introduced);
	const available = Math.min(unseen, remaining);
	return { due, new: available, waiting: unseen - available, buried: selection.buried, total };
}

/** Due siblings by due date ascending, then the oldest stamped new siblings. */
export function buildQueue(
	cards: NoteCard[],
	states: Map<string, FsrsCard>,
	now: Date,
	options: QueueOptions = {},
): QueueItem[] {
	const {
		maxNewCards = Number.POSITIVE_INFINITY,
		reviewedToday = new Set<string>(),
		burySiblings = true,
	} = options;
	const due: { item: QueueItem; tiebreak: number }[] = [];
	const fresh: { item: QueueItem; key: string }[] = [];
	const selection = applySiblingBurying(
		availableSiblings(
			cards.filter((card) => card.id !== null),
			states,
			now,
		),
		reviewedToday,
		burySiblings,
	);
	for (const sibling of selection.selected) {
		const cardId = sibling.card.id;
		if (cardId === null || sibling.key === null) continue;
		const item: QueueItem = {
			path: sibling.card.path,
			line: sibling.card.line,
			cardId,
			sub: sibling.sub,
			front: sibling.front,
			back: sibling.back,
			state: sibling.state,
			showAt: sibling.showAt,
		};
		if (sibling.state) due.push({ item, tiebreak: Math.random() });
		else fresh.push({ item, key: sibling.key });
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
