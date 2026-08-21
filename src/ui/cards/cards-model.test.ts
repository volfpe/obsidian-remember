import { Rating, State, type Card as FsrsCard } from 'ts-fsrs';
import { describe, expect, it } from 'vitest';
import type { ReviewEvent } from '../../core/events';
import type { NoteCard } from '../../core/queue';
import { DeckSettingsIndex } from '../../deck-settings';
import { DEFAULT_SETTINGS } from '../../settings';
import type { RememberSnapshot } from '../remember-snapshot';
import { buildCardDeckGroups, cardStateKind } from './cards-model';

function reviewState(due = '2026-08-20T10:00:00.000Z'): FsrsCard {
	return {
		due: new Date(due),
		stability: 1,
		difficulty: 5,
		elapsed_days: 1,
		scheduled_days: 1,
		reps: 1,
		lapses: 0,
		state: State.Review,
		last_review: new Date('2026-08-15T10:00:00.000Z'),
		learning_steps: 0,
	};
}

function event(id: string, timestamp: string, sub: number): ReviewEvent {
	return {
		v: 1,
		k: 'r',
		i: id,
		t: timestamp,
		c: 'card-one',
		s: sub,
		r: Rating.Good,
		dr: 0.9,
	};
}

function snapshot(cards: NoteCard[], events: ReviewEvent[] = []): RememberSnapshot {
	return {
		loadedAt: new Date('2026-08-15T12:00:00.000Z'),
		cards,
		events,
		buries: [],
		states: new Map([['card-one#0', reviewState()]]),
		deckSettings: new DeckSettingsIndex(DEFAULT_SETTINGS),
		issues: { duplicates: [] },
	};
}

describe('Cards catalog', () => {
	it('groups reviewable siblings by deck and keeps independent state', () => {
		const cards: NoteCard[] = [
			{
				id: 'card-one',
				suspended: false,
				kind: 'basic',
				reverse: false,
				line: 4,
				path: 'language/dog.md',
				deck: 'Language',
				siblings: [
					{ sub: 0, front: 'perro', back: 'dog' },
					{ sub: 1, front: 'dog', back: 'perro' },
				],
			},
		];
		const events = [
			event('older', '2026-08-10T10:00:00.000Z', 0),
			event('newer', '2026-08-15T10:00:00.000Z', 0),
		];

		const groups = buildCardDeckGroups(
			snapshot(cards, events),
			'Language',
			new Date('2026-08-15T12:00:00.000Z'),
		);

		expect(groups).toHaveLength(1);
		expect(groups[0].items.map((item) => item.key)).toEqual(['card-one#0', 'card-one#1']);
		expect(groups[0].items[0].history.map((review) => review.i)).toEqual(['newer', 'older']);
		expect(cardStateKind(groups[0].items[0].state)).toBe('review');
		expect(cardStateKind(groups[0].items[1].state)).toBe('new');
		expect(groups[0].items.map((item) => item.availability)).toEqual(['scheduled', 'buried']);
	});

	it('uses a non-persistent key for an unstamped cloze without creating history', () => {
		const cards: NoteCard[] = [
			{
				id: null,
				suspended: false,
				kind: 'cloze',
				reverse: false,
				line: 8,
				path: 'geography.md',
				deck: 'Geography',
				siblings: [{ sub: 3, front: 'Capital is […]', back: 'Capital is Paris' }],
			},
		];

		const item = buildCardDeckGroups(
			snapshot(cards),
			'Geography',
			new Date('2026-08-15T12:00:00.000Z'),
		)[0].items[0];

		expect(item.key).toBe('unstamped:geography.md:8:3');
		expect(item.sibling).toEqual({ kind: 'cloze', number: 2 });
		expect(item.history).toEqual([]);
		expect(item.availability).toBe('new');
	});

	it('shows every unseen sibling as waiting when the daily limit is exhausted', () => {
		const data = snapshot([
			{
				id: 'waiting-card',
				suspended: false,
				kind: 'basic',
				reverse: false,
				line: 4,
				path: 'language/dog.md',
				deck: 'Language',
				siblings: [
					{ sub: 0, front: 'perro', back: 'dog' },
					{ sub: 1, front: 'dog', back: 'perro' },
				],
			},
		]);
		data.states.clear();
		data.deckSettings = new DeckSettingsIndex({
			...DEFAULT_SETTINGS,
			limitNewCardsPerDay: true,
			newCardsPerDay: 0,
		});

		const groups = buildCardDeckGroups(
			data,
			'Language',
			new Date('2026-08-15T12:00:00.000Z'),
		);

		expect(groups[0].items.map((item) => item.availability)).toEqual(['waiting', 'waiting']);
	});

	it('includes descendant decks but excludes unrelated decks', () => {
		const cards: NoteCard[] = [
			{
				id: null,
				suspended: false,
				kind: 'basic',
				reverse: false,
				line: 1,
				path: 'spanish.md',
				deck: 'Language/Spanish',
				siblings: [{ sub: 0, front: 'hola', back: 'hello' }],
			},
			{
				id: null,
				suspended: false,
				kind: 'basic',
				reverse: false,
				line: 1,
				path: 'capital.md',
				deck: 'Geography',
				siblings: [{ sub: 0, front: 'Paris', back: 'France' }],
			},
		];

		const groups = buildCardDeckGroups(
			snapshot(cards),
			'Language',
			new Date('2026-08-15T12:00:00.000Z'),
		);

		expect(groups.map((group) => group.deck)).toEqual(['Language/Spanish']);
	});

	it('keeps a suspended card visible with suspended availability', () => {
		const suspended: NoteCard = {
			id: 'paused',
			suspended: true,
			kind: 'basic',
			reverse: false,
			line: 2,
			path: 'paused.md',
			deck: 'Language',
			siblings: [{ sub: 0, front: 'hola', back: 'hello' }],
		};

		const groups = buildCardDeckGroups(
			{ ...snapshot([suspended]), states: new Map() },
			'Language',
			new Date('2026-08-15T12:00:00.000Z'),
		);

		expect(groups[0].items[0].availability).toBe('suspended');
	});
});
