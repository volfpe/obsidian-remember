import { Rating, type Grade } from 'ts-fsrs';
import { App, WorkspaceLeaf } from 'obsidian-test-mocks/obsidian';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { QueueItem } from '../core/queue';
import { DEFAULT_SETTINGS } from '../settings';
import { ReviewView } from './review-view';

interface ReviewViewHarness {
	busy: boolean;
	current: QueueItem | null;
	leaveSession(): Promise<void>;
	phase: 'decks' | 'question' | 'answer';
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

function makeHarness(): { app: ReturnType<App['asOriginalType__']>; view: ReviewViewHarness } {
	const mockApp = App.createConfigured__({ files: { 'note.md': 'q::a' } });
	mockApp.saveLocalStorage('remember-device-id', 'device0000001');
	const app = mockApp.asOriginalType__();
	const leaf = WorkspaceLeaf.create2__(mockApp).asOriginalType3__();
	const view = new ReviewView(leaf, { ...DEFAULT_SETTINGS }) as unknown as ReviewViewHarness;
	view.current = item('first');
	view.queue = [item('second')];
	view.phase = 'answer';
	return { app, view };
}

afterEach(() => vi.restoreAllMocks());

describe('rating durability', () => {
	it('does not advance when appending the rating fails', async () => {
		const { app, view } = makeHarness();
		vi.spyOn(app.vault.adapter, 'append').mockRejectedValue(new Error('disk full'));

		await view.rate(Rating.Good);

		expect(view.current?.cardId).toBe('first');
		expect(view.queue.map((queued) => queued.cardId)).toEqual(['second']);
		expect(view.busy).toBe(false);
	});

	it('ignores another rating while an append is pending and advances exactly once afterward', async () => {
		const { app, view } = makeHarness();
		const appendStarted = deferred();
		const allowAppend = deferred();
		const originalAppend = app.vault.adapter.append.bind(app.vault.adapter);
		vi.spyOn(app.vault.adapter, 'append').mockImplementation(async (...args) => {
			appendStarted.resolve();
			await allowAppend.promise;
			await originalAppend(...args);
		});

		const rating = view.rate(Rating.Easy);
		await appendStarted.promise;
		await view.rate(Rating.Again);
		expect(view.current?.cardId).toBe('first');
		allowAppend.resolve();
		await rating;

		expect(view.current?.cardId).toBe('second');
		expect(view.queue).toEqual([]);
	});
});

describe('session progress', () => {
	it('advances for a completed card and rolls back on undo', async () => {
		const { view } = makeHarness();

		await view.rate(Rating.Easy);
		expect(view.sessionCompleted).toBe(1);

		await view.undo();

		expect(view.current?.cardId).toBe('first');
		expect(view.sessionCompleted).toBe(0);
	});

	it('returns to a freshly computed deck list when leaving early', async () => {
		const { view } = makeHarness();

		await view.leaveSession();

		expect(view.phase).toBe('decks');
		expect(view.current).toBeNull();
		expect(view.queue).toEqual([]);
	});
});

describe('view persistence', () => {
	it('does not persist session state', () => {
		const mockApp = App.createConfigured__();
		const leaf = WorkspaceLeaf.create2__(mockApp).asOriginalType3__();
		const view = new ReviewView(leaf, { ...DEFAULT_SETTINGS });

		expect(view.getState()).toEqual({});
	});
});
