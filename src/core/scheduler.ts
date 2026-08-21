// Pure events -> per-sibling FSRS state via ts-fsrs. No Obsidian imports.

import { createEmptyCard, fsrs, generatorParameters, Rating, type Card as FsrsCard, type FSRS, type Grade } from 'ts-fsrs';
import { STRINGS } from '../i18n';
import type { ReviewEvent } from './events';

export function makeFsrs(desiredRetention: number): FSRS {
	return fsrs(generatorParameters({ request_retention: desiredRetention, enable_short_term: true }));
}

export function siblingKey(cardId: string, sub: number): string {
	return `${cardId}#${sub}`;
}

export type RetentionReplayMode = 'current' | 'review';

/** Replays every sibling's events in timestamp order. Elapsed time comes from the timestamps. */
export function foldEvents(
	f: FSRS,
	events: ReviewEvent[],
	retentionReplay: RetentionReplayMode = 'current',
): Map<string, FsrsCard> {
	return foldEventsByRetention(events, () => f.parameters.request_retention, retentionReplay, f);
}

/** Replays with the current desired retention resolved independently for each card. */
export function foldEventsByRetention(
	events: ReviewEvent[],
	desiredRetention: (cardId: string) => number,
	retentionReplay: RetentionReplayMode = 'current',
	seed?: FSRS,
): Map<string, FsrsCard> {
	const states = new Map<string, FsrsCard>();
	const schedulers = new Map<number, FSRS>();
	if (seed) schedulers.set(seed.parameters.request_retention, seed);
	const sorted = [...events].sort((a, b) =>
		a.t < b.t ? -1 : a.t > b.t ? 1 : a.i < b.i ? -1 : a.i > b.i ? 1 : 0,
	);
	for (const event of sorted) {
		const key = siblingKey(event.c, event.s);
		const retention = retentionReplay === 'review' ? event.dr : desiredRetention(event.c);
		const scheduler = schedulers.get(retention) ?? makeFsrs(retention);
		schedulers.set(retention, scheduler);
		states.set(key, applyRating(scheduler, states.get(key) ?? null, new Date(event.t), event.r));
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
	if (minutes < 1) return STRINGS.intervals.lessThanMinute;
	if (Math.round(minutes) < 60) return STRINGS.intervals.minutes(Math.round(minutes));
	const hours = minutes / 60;
	if (Math.round(hours) < 24) return STRINGS.intervals.hours(Math.round(hours));
	const days = hours / 24;
	if (Math.round(days) < 31) return STRINGS.intervals.days(Math.round(days));
	const months = days / 30.44;
	if (Math.round(months) < 12) return STRINGS.intervals.months(Math.round(months));
	return STRINGS.intervals.years((days / 365.25).toFixed(1).replace(/\.0$/, ''));
}
