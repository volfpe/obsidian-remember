import { Rating, type Grade } from 'ts-fsrs';
import { App } from 'obsidian-test-mocks/obsidian';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { QueueItem } from '../core/queue';
import { makeFsrs } from '../core/scheduler';
import { DEFAULT_SETTINGS } from '../settings';
import { RememberSnapshotRepository } from './remember-snapshot';
import { ReviewSession } from './review-session';

interface ReviewSessionHarness {
	busy: boolean;
	container: HTMLElement | null;
	current: QueueItem | null;
	leave(): Promise<void>;
	phase: 'idle' | 'question' | 'answer';
	queue: QueueItem[];
	sessionCompleted: number;
	rate(grade: Grade): Promise<void>;
	undo(): Promise<void>;
}

function item(cardId: string): QueueItem {
	return {
		path: 'note.md',
		line: 0,
		cardId,
		sub: 0,
		front: `front of ${cardId}`,
		back: `back of ${cardId}`,
		state: null,
		showAt: new Date('2026-08-11T09:00:00.000Z'),
	};
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
	let resolve!: () => void;
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

function makeHarness(): {
	app: ReturnType<App['asOriginalType__']>;
	finished: ReturnType<typeof vi.fn>;
	session: ReviewSessionHarness;
} {
	const mockApp = App.createConfigured__({ files: { 'note.md': 'q::a' } });
	mockApp.saveLocalStorage('remember-device-id', 'device0000001');
	const app = mockApp.asOriginalType__();
	const settings = { ...DEFAULT_SETTINGS };
	const fsrs = makeFsrs(settings.desiredRetention);
	const repository = new RememberSnapshotRepository(app, settings, fsrs);
	const finished = vi.fn(async () => undefined);
	const actual = new ReviewSession(app, settings, fsrs, repository, finished);
	actual.load();
	const session = actual as unknown as ReviewSessionHarness;
	session.container = createDiv();
	session.current = item('first');
	session.queue = [item('second')];
	session.phase = 'answer';
	return { app, finished, session };
}

afterEach(() => vi.restoreAllMocks());

describe('rating durability', () => {
	it('does not advance when appending the rating fails', async () => {
		const { app, session } = makeHarness();
		vi.spyOn(app.vault.adapter, 'append').mockRejectedValue(new Error('disk full'));

		await session.rate(Rating.Good);

		expect(session.current?.cardId).toBe('first');
		expect(session.queue.map((queued) => queued.cardId)).toEqual(['second']);
		expect(session.busy).toBe(false);
	});

	it('ignores another rating while an append is pending and advances exactly once afterward', async () => {
		const { app, session } = makeHarness();
		const appendStarted = deferred();
		const allowAppend = deferred();
		const originalAppend = app.vault.adapter.append.bind(app.vault.adapter);
		vi.spyOn(app.vault.adapter, 'append').mockImplementation(async (...args) => {
			appendStarted.resolve();
			await allowAppend.promise;
			await originalAppend(...args);
		});

		const rating = session.rate(Rating.Easy);
		await appendStarted.promise;
		await session.rate(Rating.Again);
		expect(session.current?.cardId).toBe('first');
		allowAppend.resolve();
		await rating;

		expect(session.current?.cardId).toBe('second');
		expect(session.queue).toEqual([]);
	});
});

describe('session progress', () => {
	it('advances for a completed card and rolls back on undo', async () => {
		const { session } = makeHarness();

		await session.rate(Rating.Easy);
		expect(session.sessionCompleted).toBe(1);

		await session.undo();

		expect(session.current?.cardId).toBe('first');
		expect(session.sessionCompleted).toBe(0);
	});

	it('returns to Study when leaving early', async () => {
		const { finished, session } = makeHarness();

		await session.leave();

		expect(session.phase).toBe('idle');
		expect(session.current).toBeNull();
		expect(session.queue).toEqual([]);
		expect(finished).toHaveBeenCalledOnce();
	});
});
