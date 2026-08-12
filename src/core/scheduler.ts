// Pure events -> per-sibling FSRS state via ts-fsrs. No Obsidian imports.

import { createEmptyCard, fsrs, generatorParameters, Rating, type Card as FsrsCard, type FSRS, type Grade } from 'ts-fsrs';
import type { ReviewEvent } from './events';

export function makeFsrs(desiredRetention: number): FSRS {
	return fsrs(generatorParameters({ request_retention: desiredRetention, enable_short_term: true }));
}

export function siblingKey(cardId: string, sub: number): string {
	return `${cardId}#${sub}`;
}

/** Replays every sibling's events in timestamp order. Elapsed time comes from the timestamps. */
export function foldEvents(f: FSRS, events: ReviewEvent[]): Map<string, FsrsCard> {
	const states = new Map<string, FsrsCard>();
	const sorted = [...events].sort((a, b) =>
		a.t < b.t ? -1 : a.t > b.t ? 1 : a.i < b.i ? -1 : a.i > b.i ? 1 : 0,
	);
	for (const event of sorted) {
		const key = siblingKey(event.c, event.s);
		states.set(key, applyRating(f, states.get(key) ?? null, new Date(event.t), event.r));
	}
	return states;
}

/** One rating applied to a sibling's state (null = never reviewed). */
export function applyRating(f: FSRS, state: FsrsCard | null, when: Date, rating: Grade): FsrsCard {
	return f.next(state ?? createEmptyCard(when), when, rating).card;
}

/** The due date each rating would produce — labels the four answer buttons. */
export function previewDue(f: FSRS, state: FsrsCard | null, now: Date): Record<Grade, Date> {
	const preview = f.repeat(state ?? createEmptyCard(now), now);
	return {
		[Rating.Again]: preview[Rating.Again].card.due,
		[Rating.Hard]: preview[Rating.Hard].card.due,
		[Rating.Good]: preview[Rating.Good].card.due,
		[Rating.Easy]: preview[Rating.Easy].card.due,
	};
}

export function formatInterval(from: Date, to: Date): string {
	const minutes = (to.getTime() - from.getTime()) / 60_000;
	if (minutes < 1) return '<1m';
	if (Math.round(minutes) < 60) return `${Math.round(minutes)}m`;
	const hours = minutes / 60;
	if (Math.round(hours) < 24) return `${Math.round(hours)}h`;
	const days = hours / 24;
	if (Math.round(days) < 31) return `${Math.round(days)}d`;
	const months = days / 30.44;
	if (Math.round(months) < 12) return `${Math.round(months)}mo`;
	return `${(days / 365.25).toFixed(1).replace(/\.0$/, '')}y`;
}
