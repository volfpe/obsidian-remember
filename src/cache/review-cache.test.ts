import { Rating, type Grade } from 'ts-fsrs';
import { describe, expect, it, vi } from 'vitest';
import type { ReviewEvent } from '../core/events';
import { ReviewCache, ReviewCacheError } from './review-cache';

function review(
	id: string,
	timestamp: string,
	rating: Grade = Rating.Good,
	cardId = 'card',
): ReviewEvent {
	return {
		v: 1,
		k: 'r',
		i: id,
		t: timestamp,
		c: cardId,
		s: 0,
		r: rating,
		dr: 0.9,
	};
}

function jsonl(...events: object[]): string {
	return events.map((event) => JSON.stringify(event)).join('\n') + '\n';
}

function file(path: string, content: string, mtime = 1) {
	return { path, size: new TextEncoder().encode(content).byteLength, mtime };
}

async function projection(cache: ReviewCache) {
	return cache.projection(
		[{ cardId: 'card', sub: 0, desiredRetention: 0.9 }],
		'current',
		new Date('2026-08-25T12:00:00.000Z'),
	);
}

async function openCache(): Promise<ReviewCache> {
	return ReviewCache.open(`remember-test-${crypto.randomUUID()}`);
}

describe('local review cache', () => {
	it('rebuilds a database with a missing schema', async () => {
		const name = `remember-test-${crypto.randomUUID()}`;
		await new Promise<void>((resolve, reject) => {
			const opening = indexedDB.open(name, 2);
			opening.onsuccess = () => {
				opening.result.close();
				resolve();
			};
			opening.onerror = () => reject(opening.error ?? new Error('Could not create test index'));
		});

		const cache = await ReviewCache.open(name);

		expect(await cache.storedFiles()).toEqual(new Map());
		cache.close();
	});

	it('rebuilds a database with missing indexes', async () => {
		const name = `remember-test-${crypto.randomUUID()}`;
		await new Promise<void>((resolve, reject) => {
			const opening = indexedDB.open(name, 2);
			opening.onupgradeneeded = () => {
				const db = opening.result;
				db.createObjectStore('files', { keyPath: 'path' });
				db.createObjectStore('events', { keyPath: 'i' });
				db.createObjectStore('undos', { keyPath: 'targetId' });
				db.createObjectStore('states', { keyPath: 'key' });
			};
			opening.onsuccess = () => {
				opening.result.close();
				resolve();
			};
			opening.onerror = () => reject(opening.error ?? new Error('Could not create test index'));
		});

		const cache = await ReviewCache.open(name);
		const content = jsonl(review('review', '2026-08-20T10:00:00.000Z'));
		await cache.replaceFile(file('events.rememberlog', content), content);

		expect((await projection(cache)).states.get('card#0')?.reps).toBe(1);
		cache.close();
	});

	it('labels IndexedDB operation failures for safe cache recovery', async () => {
		const cache = await openCache();
		cache.close();

		await expect(cache.storedFiles()).rejects.toBeInstanceOf(ReviewCacheError);
	});

	it('deduplicates events from conflict copies', async () => {
		const cache = await openCache();
		const first = review('first', '2026-08-20T10:00:00.000Z');
		const second = review('second', '2026-08-21T10:00:00.000Z');
		const one = jsonl(first);
		const both = jsonl(first, second);

		await cache.replaceFile(file('one.rememberlog', one), one);
		await cache.replaceFile(file('conflict.rememberlog', both), both);
		expect((await projection(cache)).states.get('card#0')?.reps).toBe(2);
		expect((await cache.getHistory('card', 0)).events.map((event) => event.i)).toEqual([
			'second',
			'first',
		]);
		cache.close();
	});

	it('requests a rebuild when a cached log is rewritten', async () => {
		const cache = await openCache();
		const first = jsonl(review('first', '2026-08-20T10:00:00.000Z'));
		const second = jsonl(review('other', '2026-08-21T10:00:00.000Z'));
		await cache.replaceFile(file('changed.rememberlog', first), first);

		expect(await cache.replaceFile(file('changed.rememberlog', second, 2), second)).toBe(
			'rebuild',
		);
		expect((await cache.getHistory('card', 0)).events.map((event) => event.i)).toEqual([
			'first',
		]);
		cache.close();
	});

	it('requests a rebuild when a grown log does not preserve its old prefix', async () => {
		const cache = await openCache();
		const first = review('first', '2026-08-20T10:00:00.000Z');
		const before = jsonl(first);
		await cache.replaceFile(file('changed.rememberlog', before), before);
		const after = jsonl(
			{ ...first, r: Rating.Hard },
			review('second', '2026-08-21T10:00:00.000Z'),
		);

		expect(await cache.replaceFile(file('changed.rememberlog', after, 2), after)).toBe(
			'rebuild',
		);
		cache.close();
	});

	it('handles an undo before its review', async () => {
		const cache = await openCache();
		const event = review('review', '2026-08-20T10:00:00.000Z');
		const undo = jsonl({ v: 1, k: 'u', t: '2026-08-21T10:00:00.000Z', u: event.i });
		await cache.replaceFile(file('undo.rememberlog', undo), undo);
		const events = jsonl(event);
		await cache.replaceFile(file('event.rememberlog', events), events);

		expect((await projection(cache)).states.size).toBe(0);
		expect((await cache.getHistory('card', 0)).events).toEqual([]);
		cache.close();
	});

	it('returns sibling history in stable newest-first pages', async () => {
		const cache = await openCache();
		const content = jsonl(
			review('first', '2026-08-20T10:00:00.000Z'),
			review('second', '2026-08-21T10:00:00.000Z', Rating.Hard),
			review('third', '2026-08-22T10:00:00.000Z', Rating.Easy),
		);
		await cache.replaceFile(file('history.rememberlog', content), content);

		const first = await cache.getHistory('card', 0, 2);
		expect(first.events.map((event) => event.i)).toEqual(['third', 'second']);
		expect(first.next).toEqual({ t: '2026-08-21T10:00:00.000Z', i: 'second' });
		const second = await cache.getHistory('card', 0, 2, first.next);
		expect(second.events.map((event) => event.i)).toEqual(['first']);
		expect(second.next).toBeNull();
		cache.close();
	});

	it('replays only the sibling changed by an append to an existing segment', async () => {
		const cache = await openCache();
		const initial = Array.from({ length: 70 }, (_, position) =>
			review(
				`initial-${position}`,
				'2026-08-20T10:00:00.000Z',
				Rating.Good,
				`card-${position}`,
			),
		);
		const requests = initial.map((event) => ({
			cardId: event.c,
			sub: event.s,
			desiredRetention: 0.9,
		}));
		const before = jsonl(...initial);
		await cache.replaceFile(file('active.rememberlog', before), before);
		await cache.projection(requests, 'current', new Date('2026-08-25T12:00:00.000Z'));

		const appended = review(
			'appended',
			'2026-08-21T10:00:00.000Z',
			Rating.Good,
			'card-0',
		);
		const after = jsonl(...initial, appended);
		expect(await cache.replaceFile(file('active.rememberlog', after, 2), after)).toBe(
			'cached',
		);
		const siblingQueries = vi.spyOn(IDBIndex.prototype, 'getAll');

		const result = await cache.projection(
			requests,
			'current',
			new Date('2026-08-25T12:00:00.000Z'),
		);

		expect(result.states.get('card-0#0')?.reps).toBe(2);
		expect(result.states.get('card-69#0')?.reps).toBe(1);
		expect(siblingQueries).toHaveBeenCalledTimes(1);
		siblingQueries.mockRestore();
		cache.close();
	});
});
