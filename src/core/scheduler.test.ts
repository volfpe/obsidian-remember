import { Rating } from 'ts-fsrs';
import { describe, expect, it } from 'vitest';
import type { ReviewEvent } from './events';
import { applyRating, foldEvents, formatInterval, makeFsrs, previewDue, siblingKey } from './scheduler';

const f = makeFsrs(0.9);

function event(t: string, r: 1 | 2 | 3 | 4, c = 'card1', s = 0): ReviewEvent {
	return { v: 1, k: 'r', i: `${c}-${s}-${t}-${r}`, t, c, s, r, dr: 0.9 };
}

describe('foldEvents', () => {
	it('matches rating-by-rating application', () => {
		const events = [
			event('2026-01-01T10:00:00.000Z', Rating.Good),
			event('2026-01-01T10:09:00.000Z', Rating.Again),
			event('2026-01-01T10:12:00.000Z', Rating.Good),
			event('2026-01-05T09:00:00.000Z', Rating.Easy),
		];
		const folded = foldEvents(f, events).get(siblingKey('card1', 0))!;
		let incremental = null;
		for (const e of events) incremental = applyRating(f, incremental, new Date(e.t), e.r);
		expect(folded).toEqual(incremental);
	});

	it('replays in timestamp and event-id order', () => {
		const early = event('2026-01-01T10:00:00.000Z', Rating.Good);
		const late = event('2026-01-03T10:00:00.000Z', Rating.Good);
		expect(foldEvents(f, [late, early])).toEqual(foldEvents(f, [early, late]));

		const again = { ...event('2026-01-01T10:00:00.000Z', Rating.Again), i: 'a' };
		const easy = { ...event('2026-01-01T10:00:00.000Z', Rating.Easy), i: 'b' };
		expect(foldEvents(f, [easy, again])).toEqual(foldEvents(f, [again, easy]));
	});

	it('keeps siblings independent', () => {
		const states = foldEvents(f, [
			event('2026-01-01T10:00:00.000Z', Rating.Good, 'card1', 0),
			event('2026-01-01T11:00:00.000Z', Rating.Again, 'card1', 1),
		]);
		expect(states.size).toBe(2);
		expect(states.get(siblingKey('card1', 0))!.reps).toBe(1);
		expect(states.get(siblingKey('card1', 1))!.reps).toBe(1);
	});
});

describe('previewDue', () => {
	it('orders Again <= Hard <= Good <= Easy', () => {
		const now = new Date('2026-01-01T10:00:00.000Z');
		for (const state of [null, applyRating(f, null, new Date('2025-12-01T10:00:00.000Z'), Rating.Good)]) {
			const preview = previewDue(f, state, now);
			expect(preview[Rating.Again].getTime()).toBeGreaterThan(now.getTime());
			expect(preview[Rating.Again].getTime()).toBeLessThanOrEqual(preview[Rating.Hard].getTime());
			expect(preview[Rating.Hard].getTime()).toBeLessThanOrEqual(preview[Rating.Good].getTime());
			expect(preview[Rating.Good].getTime()).toBeLessThanOrEqual(preview[Rating.Easy].getTime());
		}
	});
});

describe('formatInterval', () => {
	const from = new Date('2026-01-01T00:00:00.000Z');
	const after = (ms: number) => new Date(from.getTime() + ms);

	it('formats minutes, hours, days, months, years', () => {
		expect(formatInterval(from, after(30_000))).toBe('<1m');
		expect(formatInterval(from, after(5 * 60_000))).toBe('5m');
		expect(formatInterval(from, after(3 * 3_600_000))).toBe('3h');
		expect(formatInterval(from, after(4 * 86_400_000))).toBe('4d');
		expect(formatInterval(from, after(61 * 86_400_000))).toBe('2mo');
		expect(formatInterval(from, after(365 * 86_400_000))).toBe('1y');
		expect(formatInterval(from, after(550 * 86_400_000))).toBe('1.5y');
	});
});
