import { State, type Card as FsrsCard } from 'ts-fsrs';
import { describe, expect, it } from 'vitest';
import type { NoteCard } from '../core/queue';
import { forecastDeck } from './forecast';

const now = new Date(2026, 7, 15, 12);

function card(id: string, siblings = 1): NoteCard {
	return {
		id,
		kind: 'basic',
		multiline: false,
		line: 0,
		path: `${id}.md`,
		deck: 'Deck',
		siblings: Array.from({ length: siblings }, (_, sub) => ({
			sub,
			front: `${id}-${sub}`,
			back: `${id}-${sub}`,
		})),
	};
}

function scheduledState(due: Date): FsrsCard {
	return {
		due,
		stability: 3,
		difficulty: 5,
		elapsed_days: 1,
		scheduled_days: 3,
		reps: 1,
		lapses: 0,
		state: State.Review,
		last_review: new Date(2026, 7, 12, 12),
		learning_steps: 0,
	};
}

describe('deck workload forecast', () => {
	it('redistributes waiting cards across future daily new-card allowances', () => {
		const forecast = forecastDeck(
			[card('a'), card('b'), card('c')],
			new Map(),
			[],
			now,
			{ days: 3, newCardsPerDay: 1, burySiblings: false },
		);

		expect(forecast.map((day) => day.new)).toEqual([1, 1, 1]);
	});

	it('silently rolls a buried scheduled sibling into the following day', () => {
		const states = new Map<string, FsrsCard>([
			['siblings#0', scheduledState(new Date(2026, 7, 16, 9))],
			['siblings#1', scheduledState(new Date(2026, 7, 16, 10))],
		]);
		const forecast = forecastDeck([card('siblings', 2)], states, [], now, {
			days: 3,
			newCardsPerDay: 0,
			burySiblings: true,
		});

		expect(forecast.map((day) => day.scheduled)).toEqual([0, 1, 1]);
	});

	it('keeps siblings on their scheduled date when burying is disabled', () => {
		const states = new Map<string, FsrsCard>([
			['siblings#0', scheduledState(new Date(2026, 7, 16, 9))],
			['siblings#1', scheduledState(new Date(2026, 7, 16, 10))],
		]);
		const forecast = forecastDeck([card('siblings', 2)], states, [], now, {
			days: 3,
			newCardsPerDay: 0,
			burySiblings: false,
		});

		expect(forecast.map((day) => day.scheduled)).toEqual([0, 2, 0]);
	});
});
