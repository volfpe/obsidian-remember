import { Rating } from 'ts-fsrs';
import { describe, expect, it } from 'vitest';
import type { BuryEvent, ReviewEvent } from './events';
import {
	buildQueue,
	classifyDeckSiblings,
	countDeckStats,
	dedupeById,
	introducedTodaySiblingKeys,
	isDescendantDeck,
	manuallyBuriedCardIds,
	returnsToCurrentSession,
	reviewedTodaySiblingKeys,
	selectCards,
	type NoteCard,
} from './queue';
import { foldEvents, makeFsrs } from './scheduler';

const f = makeFsrs(0.9);
const now = new Date('2026-01-10T12:00:00.000Z');

function card(id: string | null, overrides: Partial<NoteCard> & { reversed?: boolean } = {}): NoteCard {
	const { reversed = false, suspended = false, ...noteOverrides } = overrides;
	const front = `front of ${id}`;
	const back = `back of ${id}`;
	return {
		id,
		suspended,
		kind: 'basic',
		siblings: [
			{ sub: 0, front, back },
			...(reversed ? [{ sub: 1, front: back, back: front }] : []),
		],
		multiline: false,
		line: 0,
		path: 'note.md',
		deck: 'deck',
		...noteOverrides,
	};
}

/** States from real events: one Good review at `t` per card id (sub 0). */
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
	return foldEvents(f, events);
}

describe('isDescendantDeck', () => {
	it('matches the deck itself and nested decks, not prefixes', () => {
		expect(isDescendantDeck('lang', 'lang')).toBe(true);
		expect(isDescendantDeck('lang/spanish', 'lang')).toBe(true);
		expect(isDescendantDeck('language', 'lang')).toBe(false);
	});
});

describe('returnsToCurrentSession', () => {
	it('includes due times up to and including the ten-minute learn-ahead limit', () => {
		expect(returnsToCurrentSession(new Date(now.getTime() + 10 * 60 * 1000), now)).toBe(true);
		expect(returnsToCurrentSession(new Date(now.getTime() + 10 * 60 * 1000 + 1), now)).toBe(false);
	});
});

describe('dedupeById', () => {
	it('chooses duplicates globally by path before filtering by deck', () => {
		const first = card('dup', { path: 'a.md', deck: 'a' });
		const second = card('dup', { path: 'z.md', deck: 'b' });
		const fresh = card(null, { path: 'z.md', line: 1, deck: 'b' });
		const { kept, dropped } = dedupeById([second, fresh, first]);
		expect(kept).toHaveLength(2);
		expect(kept[0]).toBe(first);
		expect(dropped).toEqual([second]);
		expect(selectCards([second, fresh, first], 'b').kept).toEqual([fresh]);
	});
});

describe('countDeckStats', () => {
	it('counts only one new sibling per group and reports the other as buried', () => {
		const counts = countDeckStats([card(null), card('a', { reversed: true })], new Map(), now);
		expect(counts).toEqual({ due: 0, new: 2, waiting: 0, buried: 1, suspended: 0, total: 3 });
	});

	it('counts a past due as due and a future due as neither', () => {
		// A Good first review lands ~10 minutes later: days ago -> due now, a minute ago -> still pending.
		const states = statesAfterGood([
			['past', '2026-01-08T12:00:00.000Z'],
			['future', '2026-01-10T11:59:00.000Z'],
		]);
		expect(countDeckStats([card('past'), card('future')], states, now)).toEqual({
			due: 1,
			new: 0,
			waiting: 0,
			buried: 0,
			suspended: 0,
			total: 2,
		});
	});

	it('subtracts introductions in the selected deck from the daily allowance', () => {
		const events: ReviewEvent[] = ['introduced-a', 'introduced-b'].map((c, index) => ({
			v: 1,
			k: 'r',
			i: `review-${index}`,
			t: new Date(2026, 0, 10, 9, index).toISOString(),
			c,
			s: 0,
			r: Rating.Good,
			dr: 0.9,
		}));
		const localNow = new Date(2026, 0, 10, 12);
		const states = foldEvents(f, events);
		const cards = [card('introduced-a'), card('introduced-b'), card('fresh-a'), card('fresh-b'), card('fresh-c')];

		expect(countDeckStats(cards, states, localNow, {
			introducedToday: introducedTodaySiblingKeys(events, localNow),
			newCardsPerDay: 3,
		})).toEqual({
			due: 2,
			new: 1,
			waiting: 2,
			buried: 0,
			suspended: 0,
			total: 5,
		});
	});

	it('marks every unseen sibling as waiting when its group is beyond the daily limit', () => {
		const cards = [card('a', { reversed: true }), card('b', { reversed: true })];

		expect(countDeckStats(cards, new Map(), now, { newCardsPerDay: 1 })).toEqual({
			due: 0,
			new: 1,
			waiting: 2,
			buried: 1,
			suspended: 0,
			total: 4,
		});
		expect(
			Object.fromEntries(classifyDeckSiblings(cards, new Map(), now, { newCardsPerDay: 1 })),
		).toEqual({
			'a#0': 'new',
			'a#1': 'buried',
			'b#0': 'waiting',
			'b#1': 'waiting',
		});
		expect(
			buildQueue(cards, new Map(), now, { maxNewCards: 1 }).map(
				(item) => `${item.cardId}#${item.sub}`,
			),
		).toEqual(['a#0']);
	});

	it('counts every eligible sibling when burying is disabled', () => {
		expect(
			countDeckStats([card('a', { reversed: true })], new Map(), now, { burySiblings: false }),
		).toEqual({ due: 0, new: 2, waiting: 0, buried: 0, suspended: 0, total: 2 });
	});
});

describe('classifyDeckSiblings', () => {
	it('separates due, scheduled, new, waiting, and buried siblings', () => {
		const states = statesAfterGood([
			['due', '2026-01-08T12:00:00.000Z'],
			['scheduled', '2026-01-10T11:59:00.000Z'],
		]);
		const availability = classifyDeckSiblings(
			[
				card('due'),
				card('scheduled'),
				card('paired', { reversed: true }),
				card('waiting'),
			],
			states,
			now,
			{ newCardsPerDay: 1 },
		);

		expect(Object.fromEntries(availability)).toEqual({
			'due#0': 'due',
			'scheduled#0': 'scheduled',
			'paired#0': 'new',
			'paired#1': 'buried',
			'waiting#0': 'waiting',
		});
	});

	it('keeps suspended definitions in the catalog and out of queues', () => {
		const suspended = card('paused', { suspended: true, reversed: true });
		const availability = classifyDeckSiblings([suspended], new Map(), now);

		expect([...availability.values()]).toEqual(['suspended', 'suspended']);
		expect(countDeckStats([suspended], new Map(), now)).toEqual({
			due: 0,
			new: 0,
			waiting: 0,
			buried: 0,
			suspended: 2,
			total: 2,
		});
		expect(buildQueue([suspended], new Map(), now)).toEqual([]);
	});
});

describe('manual burying', () => {
	const bury = (x: string): BuryEvent => ({
		v: 1,
		k: 'b',
		i: `bury-${x}`,
		t: '2026-01-10T09:00:00.000Z',
		c: 'a',
		x,
	});

	it('excludes every sibling in a manually buried card until its explicit expiry', () => {
		const active = manuallyBuriedCardIds([bury('2026-01-11T00:00:00.000Z')], now);
		expect([...active]).toEqual(['a']);
		const reversed = card('a', { reversed: true });
		expect(buildQueue([reversed], new Map(), now, { manuallyBuriedCardIds: active })).toEqual([]);
		expect(
			countDeckStats([reversed], new Map(), now, { manuallyBuriedCardIds: active }).buried,
		).toBe(2);
	});

	it('releases a manually buried card at the expiry time', () => {
		const expired = manuallyBuriedCardIds([bury(now.toISOString())], now);
		expect(expired.size).toBe(0);
		expect(buildQueue([card('a')], new Map(), now, { manuallyBuriedCardIds: expired })).toHaveLength(1);
	});
});

describe('introducedTodaySiblingKeys', () => {
	it('counts only siblings whose first active review occurred on the local day', () => {
		const localNow = new Date(2026, 0, 10, 12);
		const event = (i: string, c: string, sub: number, when: Date): ReviewEvent => ({
			v: 1,
			k: 'r',
			i,
			t: when.toISOString(),
			c,
			s: sub,
			r: Rating.Good,
			dr: 0.9,
		});
		const introduced = introducedTodaySiblingKeys(
			[
				event('old-first', 'old', 0, new Date(2026, 0, 9, 9)),
				event('old-again', 'old', 0, new Date(2026, 0, 10, 9)),
				event('forward', 'reversed', 0, new Date(2026, 0, 10, 10)),
				event('reverse', 'reversed', 1, new Date(2026, 0, 10, 11)),
			],
			localNow,
		);

		expect([...introduced].sort()).toEqual(['reversed#0', 'reversed#1']);
	});

	it('finds every sibling reviewed today, not only siblings first introduced today', () => {
		const localNow = new Date(2026, 0, 10, 12);
		const events: ReviewEvent[] = [
			{ v: 1, k: 'r', i: 'old', t: new Date(2026, 0, 9, 9).toISOString(), c: 'a', s: 0, r: Rating.Good, dr: 0.9 },
			{ v: 1, k: 'r', i: 'today', t: new Date(2026, 0, 10, 9).toISOString(), c: 'a', s: 0, r: Rating.Good, dr: 0.9 },
			{ v: 1, k: 'r', i: 'other', t: new Date(2026, 0, 10, 10).toISOString(), c: 'b', s: 2, r: Rating.Good, dr: 0.9 },
		];

		expect([...reviewedTodaySiblingKeys(events, localNow)].sort()).toEqual(['a#0', 'b#2']);
	});
});

describe('buildQueue', () => {
	it('orders due siblings by due date ascending, new siblings after them', () => {
		const states = statesAfterGood([
			['older', '2026-01-05T12:00:00.000Z'],
			['newer', '2026-01-08T12:00:00.000Z'],
		]);
		const queue = buildQueue([card('fresh'), card('newer'), card('older')], states, now);
		expect(queue.map((item) => item.cardId)).toEqual(['older', 'newer', 'fresh']);
		expect(queue[2].state).toBeNull();
		expect(queue[2].showAt).toEqual(now);
	});

	it('excludes siblings due in the future and cards without an id', () => {
		const states = statesAfterGood([['pending', '2026-01-10T11:59:00.000Z']]);
		expect(buildQueue([card('pending'), card(null)], states, now)).toEqual([]);
	});

	it('expands a reversed card into two siblings with swapped sides', () => {
		const queue = buildQueue([card('r', { reversed: true })], new Map(), now, {
			burySiblings: false,
		});
		expect(queue).toHaveLength(2);
		const forward = queue.find((item) => item.sub === 0)!;
		const reverse = queue.find((item) => item.sub === 1)!;
		expect(forward.front).toBe('front of r');
		expect(reverse.front).toBe('back of r');
		expect(reverse.back).toBe('front of r');
	});

	it('queues explicitly rendered cloze siblings with their reserved indexes', () => {
		const cloze = card('c', {
			kind: 'cloze',
			siblings: [
				{ sub: 2, front: 'A […] C', back: 'A B C' },
				{ sub: 4, front: 'A B […]', back: 'A B C' },
			],
		});
		const queue = buildQueue([cloze], new Map(), now, { burySiblings: false });

		expect(queue.map(({ sub, front, back }) => ({ sub, front, back })).sort((a, b) => a.sub - b.sub)).toEqual([
			{ sub: 2, front: 'A […] C', back: 'A B C' },
			{ sub: 4, front: 'A B […]', back: 'A B C' },
		]);
	});

	it('keeps cloze schedules independent using their explicit sibling indexes', () => {
		const cloze = card('c', {
			kind: 'cloze',
			siblings: [
				{ sub: 2, front: 'A […] C', back: 'A B C' },
				{ sub: 3, front: 'A B […]', back: 'A B C' },
			],
		});
		const states = foldEvents(f, [
			{
				v: 1,
				k: 'r',
				i: 'review-cloze-one',
				t: '2026-01-05T12:00:00.000Z',
				c: 'c',
				s: 2,
				r: Rating.Good,
				dr: 0.9,
			},
		]);
		const queue = buildQueue([cloze], states, now, { burySiblings: false });

		expect(queue.find((item) => item.sub === 2)?.state).not.toBeNull();
		expect(queue.find((item) => item.sub === 3)?.state).toBeNull();
	});

	it('shuffles ties: new cards come out in varying order', () => {
		const cards = Array.from({ length: 10 }, (_, i) => card(`c${i}`));
		const firsts = new Set(Array.from({ length: 20 }, () => buildQueue(cards, new Map(), now)[0].cardId));
		expect(firsts.size).toBeGreaterThan(1);
	});

	it('limits only new cards and selects the same oldest cohort on every build', () => {
		const states = statesAfterGood([['due', '2026-01-05T12:00:00.000Z']]);
		const cards = [card('due'), ...Array.from({ length: 10 }, (_, i) => card(`new-${i}`))];
		const first = buildQueue(cards, states, now, { maxNewCards: 3 });
		const tomorrow = new Date(now);
		tomorrow.setDate(tomorrow.getDate() + 1);
		const second = buildQueue([...cards].reverse(), states, tomorrow, { maxNewCards: 3 });

		expect(first[0].cardId).toBe('due');
		expect(second[0].cardId).toBe('due');
		expect(first).toHaveLength(4);
		expect(second).toHaveLength(4);
		const selected = first.slice(1).map((item) => item.cardId).sort();
		expect(selected).toEqual(['new-0', 'new-1', 'new-2']);
		expect(second.slice(1).map((item) => item.cardId).sort()).toEqual(selected);
	});

	it('applies one rating per sibling only (a rated forward leaves the reverse new)', () => {
		const states = foldEvents(f, [
			{ v: 1, k: 'r', i: 'review-r', t: '2026-01-08T12:00:00.000Z', c: 'r', s: 0, r: Rating.Good, dr: 0.9 },
		]);
		const queue = buildQueue([card('r', { reversed: true })], states, now, {
			burySiblings: false,
		});
		expect(queue.find((item) => item.sub === 0)!.state).not.toBeNull();
		expect(queue.find((item) => item.sub === 1)!.state).toBeNull();
	});

	it('selects the earliest-due sibling and buries the other', () => {
		const states = foldEvents(f, [
			{ v: 1, k: 'r', i: 'later', t: '2026-01-08T12:00:00.000Z', c: 'r', s: 0, r: Rating.Good, dr: 0.9 },
			{ v: 1, k: 'r', i: 'earlier', t: '2026-01-05T12:00:00.000Z', c: 'r', s: 1, r: Rating.Good, dr: 0.9 },
		]);

		const queue = buildQueue([card('r', { reversed: true })], states, now);
		expect(queue).toHaveLength(1);
		expect(queue[0].sub).toBe(1);
	});

	it('selects a scheduled sibling before a new sibling', () => {
		const states = foldEvents(f, [
			{ v: 1, k: 'r', i: 'due', t: '2026-01-05T12:00:00.000Z', c: 'r', s: 1, r: Rating.Good, dr: 0.9 },
		]);

		const queue = buildQueue([card('r', { reversed: true })], states, now);
		expect(queue.map((item) => item.sub)).toEqual([1]);
	});

	it('keeps other siblings buried after the reviewed sibling is no longer due', () => {
		const events: ReviewEvent[] = [
			{ v: 1, k: 'r', i: 'today', t: '2026-01-10T11:59:00.000Z', c: 'r', s: 0, r: Rating.Good, dr: 0.9 },
		];
		const states = foldEvents(f, events);
		const reviewedToday = reviewedTodaySiblingKeys(events, now);

		expect(buildQueue([card('r', { reversed: true })], states, now, { reviewedToday })).toEqual([]);
		expect(countDeckStats([card('r', { reversed: true })], states, now, { reviewedToday })).toEqual({
			due: 0,
			new: 0,
			waiting: 0,
			buried: 1,
			suspended: 0,
			total: 2,
		});
	});

	it('allows the reviewed sibling to repeat while its other sibling stays buried', () => {
		const events: ReviewEvent[] = [
			{ v: 1, k: 'r', i: 'today', t: '2026-01-10T09:00:00.000Z', c: 'r', s: 0, r: Rating.Good, dr: 0.9 },
		];
		const states = foldEvents(f, events);
		const queue = buildQueue([card('r', { reversed: true })], states, now, {
			reviewedToday: reviewedTodaySiblingKeys(events, now),
		});

		expect(queue.map((item) => item.sub)).toEqual([0]);
	});

	it('releases the untouched sibling on the next local day', () => {
		const events: ReviewEvent[] = [
			{ v: 1, k: 'r', i: 'today', t: '2026-01-10T09:00:00.000Z', c: 'r', s: 0, r: Rating.Easy, dr: 0.9 },
		];
		const states = foldEvents(f, events);
		const tomorrow = new Date('2026-01-11T12:00:00.000Z');
		const queue = buildQueue([card('r', { reversed: true })], states, tomorrow, {
			reviewedToday: reviewedTodaySiblingKeys(events, tomorrow),
		});

		expect(queue.map((item) => item.sub)).toEqual([1]);
	});

	it('applies the new-card limit after choosing distinct sibling groups', () => {
		const cards = Array.from({ length: 4 }, (_, index) => card(`r-${index}`, { reversed: true }));
		const queue = buildQueue(cards, new Map(), now, { maxNewCards: 3 });

		expect(queue).toHaveLength(3);
		expect(new Set(queue.map((item) => item.cardId)).size).toBe(3);
		expect(queue.every((item) => item.sub === 0)).toBe(true);
	});
});
