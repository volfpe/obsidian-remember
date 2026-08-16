import type { Card as FsrsCard } from 'ts-fsrs';
import type { BuryEvent, ReviewEvent } from '../core/events';
import {
	classifyDeckSiblings,
	introducedTodaySiblingKeys,
	manuallyBuriedCardIds,
	noteSiblingKey,
	reviewedTodaySiblingKeys,
	type NoteCard,
} from '../core/queue';

export interface ForecastDay {
	date: Date;
	scheduled: number;
	new: number;
}

export interface ForecastOptions {
	days?: number;
	newCardsPerDay?: number;
	burySiblings?: boolean;
	buries?: BuryEvent[];
}

/**
 * Projects daily workload from the current snapshot. Each simulated day assumes
 * its available scheduled and new cards are completed; future rating outcomes
 * are intentionally not guessed.
 */
export function forecastDeck(
	cards: NoteCard[],
	states: Map<string, FsrsCard>,
	events: ReviewEvent[],
	now: Date,
	options: ForecastOptions = {},
): ForecastDay[] {
	const days = Math.max(0, Math.floor(options.days ?? 14));
	const newCardsPerDay = options.newCardsPerDay ?? Number.POSITIVE_INFINITY;
	const burySiblings = options.burySiblings ?? true;
	const buries = options.buries ?? [];
	const introducedToday = introducedTodaySiblingKeys(events, now);
	const reviewedToday = reviewedTodaySiblingKeys(events, now);
	let remaining = cards.map((card) => ({
		...card,
		siblings: [...card.siblings],
	}));
	const forecast: ForecastDay[] = [];

	for (let offset = 0; offset < days; offset++) {
		const availability = classifyDeckSiblings(remaining, states, endOfLocalDay(now, offset), {
			introducedToday: offset === 0 ? introducedToday : undefined,
			reviewedToday: offset === 0 ? reviewedToday : undefined,
			newCardsPerDay,
			burySiblings,
			manuallyBuriedCardIds: manuallyBuriedCardIds(buries, endOfLocalDay(now, offset)),
		});
		const completed = new Set<string>();
		let scheduled = 0;
		let fresh = 0;
		for (const [key, status] of availability) {
			if (status === 'due') {
				scheduled++;
				completed.add(key);
			} else if (status === 'new') {
				fresh++;
				completed.add(key);
			}
		}

		forecast.push({ date: startOfLocalDay(now, offset), scheduled, new: fresh });
		remaining = removeCompleted(remaining, completed);
	}
	return forecast;
}

function removeCompleted(cards: NoteCard[], completed: ReadonlySet<string>): NoteCard[] {
	const remaining: NoteCard[] = [];
	for (const card of cards) {
		const siblings = card.siblings.filter((sibling) => !completed.has(noteSiblingKey(card, sibling.sub)));
		if (siblings.length > 0) remaining.push({ ...card, siblings });
	}
	return remaining;
}

function startOfLocalDay(now: Date, offset: number): Date {
	return new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
}

function endOfLocalDay(now: Date, offset: number): Date {
	return new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset + 1, 0, 0, 0, -1);
}
