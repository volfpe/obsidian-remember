import { Rating, State } from 'ts-fsrs';
import { describe, expect, it } from 'vitest';
import type { ReviewEvent } from './events';
import {
	buildPracticeQueue,
	hasPracticeCards,
	PracticeSessionQueue,
} from './practice';
import type { NoteCard } from './queue';
import { foldEvents, makeFsrs } from './scheduler';

const fsrs = makeFsrs(0.9);
const now = new Date('2026-01-10T12:00:00.000Z');

function card(id: string, suspended = false): NoteCard {
	return {
		id,
		suspended,
		kind: 'basic',
		reverse: false,
		siblings: [{ sub: 0, front: `front of ${id}`, back: `back of ${id}` }],
		line: 0,
		path: `${id}.md`,
		deck: 'deck',
	};
}

function statesAfterGood(entries: [string, string][]) {
	const events: ReviewEvent[] = entries.map(([c, t]) => ({
		v: 1,
		k: 'r',
		i: `${c}-${t}`,
		t,
		c,
		s: 0,
		r: Rating.Good,
		dr: 0.9,
	}));
	return foldEvents(fsrs, events);
}

describe('Practice eligibility', () => {
	it('includes only future, learned, unsuspended, unburied siblings', () => {
		const future = statesAfterGood([
			['eligible', '2026-01-10T11:59:00.000Z'],
			['suspended', '2026-01-10T11:59:00.000Z'],
			['buried', '2026-01-10T11:59:00.000Z'],
		]);
		const states = new Map([
			...future,
			...statesAfterGood([['due', '2026-01-01T12:00:00.000Z']]),
		]);
		states.set('existing-new#0', { ...states.get('eligible#0')!, state: State.New });
		const cards = [
			card('fresh'),
			card('existing-new'),
			card('due'),
			card('eligible'),
			card('suspended', true),
			card('buried'),
		];
		const options = { manuallyBuriedCardIds: new Set(['buried']) };

		expect(buildPracticeQueue(cards, states, now, options).map((item) => item.cardId)).toEqual([
			'eligible',
		]);
		expect(hasPracticeCards(cards, states, now, options)).toBe(true);
	});

	it('orders an unlimited queue by real due date and stable sibling key', () => {
		const entries: [string, string][] = [
			...Array.from({ length: 1001 }, (_, index) => [
				`card-${String(index).padStart(4, '0')}`,
				'2026-01-10T11:59:00.000Z',
			] as [string, string]),
			['earliest', '2026-01-10T11:58:00.000Z'],
		];
		const states = statesAfterGood(entries);
		const queue = buildPracticeQueue(entries.map(([id]) => card(id)).reverse(), states, now);

		expect(queue).toHaveLength(1002);
		expect(queue.slice(0, 4).map((item) => item.cardId)).toEqual([
			'earliest',
			'card-0000',
			'card-0001',
			'card-0002',
		]);
	});
});

describe('PracticeSessionQueue', () => {
	it('respects retries while cards remain and learns ahead when they do not', () => {
		const states = statesAfterGood([
			['a', '2026-01-10T11:59:00.000Z'],
			['b', '2026-01-10T11:59:00.000Z'],
		]);
		const session = new PracticeSessionQueue(buildPracticeQueue([card('a'), card('b')], states, now));
		const first = session.next(now)!;

		expect(session.answer(first, Rating.Hard, now)).toBe(false);
		expect(session.next(now)?.cardId).toBe('b');
		expect(session.next(now)?.cardId).toBe('a');
	});
});
