import { Rating } from 'ts-fsrs';
import { describe, expect, it } from 'vitest';
import type { ReviewEvent } from './events';
import { buildQueue, countDeckStats, dedupeById, isDescendantDeck, selectCards, type NoteCard } from './queue';
import { applyRating, foldEvents, makeFsrs } from './scheduler';

const f = makeFsrs(0.9);
const now = new Date('2026-01-10T12:00:00.000Z');

function card(id: string | null, overrides: Partial<NoteCard> = {}): NoteCard {
	return {
		id,
		front: `front of ${id}`,
		back: `back of ${id}`,
		reversed: false,
		multiline: false,
		line: 0,
		path: 'note.md',
		deck: 'deck',
		...overrides,
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
	it('counts unstamped and never-reviewed siblings as new, reversed cards twice', () => {
		const counts = countDeckStats([card(null), card('a', { reversed: true })], new Map(), now);
		expect(counts).toEqual({ due: 0, new: 3, total: 3 });
	});

	it('counts a past due as due and a future due as neither', () => {
		// A Good first review lands ~10 minutes later: days ago -> due now, a minute ago -> still pending.
		const states = statesAfterGood([
			['past', '2026-01-08T12:00:00.000Z'],
			['future', '2026-01-10T11:59:00.000Z'],
		]);
		expect(countDeckStats([card('past'), card('future')], states, now)).toEqual({ due: 1, new: 0, total: 2 });
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
		const queue = buildQueue([card('r', { reversed: true })], new Map(), now);
		expect(queue).toHaveLength(2);
		const forward = queue.find((item) => item.sub === 0)!;
		const reverse = queue.find((item) => item.sub === 1)!;
		expect(forward.front).toBe('front of r');
		expect(reverse.front).toBe('back of r');
		expect(reverse.back).toBe('front of r');
	});

	it('shuffles ties: new cards come out in varying order', () => {
		const cards = Array.from({ length: 10 }, (_, i) => card(`c${i}`));
		const firsts = new Set(Array.from({ length: 20 }, () => buildQueue(cards, new Map(), now)[0].cardId));
		expect(firsts.size).toBeGreaterThan(1);
	});

	it('applies one rating per sibling only (a rated forward leaves the reverse new)', () => {
		const states = foldEvents(f, [
			{ v: 1, k: 'r', i: 'review-r', t: '2026-01-08T12:00:00.000Z', c: 'r', s: 0, r: Rating.Good, dr: 0.9 },
		]);
		const queue = buildQueue([card('r', { reversed: true })], states, now);
		expect(queue.find((item) => item.sub === 0)!.state).not.toBeNull();
		expect(queue.find((item) => item.sub === 1)!.state).toBeNull();
	});

	it('keeps showAt equal to the folded due date', () => {
		const when = '2026-01-08T12:00:00.000Z';
		const states = statesAfterGood([['x', when]]);
		const expected = applyRating(f, null, new Date(when), Rating.Good).due;
		expect(buildQueue([card('x')], states, now)[0].showAt).toEqual(expected);
	});

});
