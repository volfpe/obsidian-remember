import { Rating, type Grade } from 'ts-fsrs';
import { App } from 'obsidian-test-mocks/obsidian';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { QueueItem } from '../core/queue';
import { makeFsrs } from '../core/scheduler';
import { DEFAULT_SETTINGS } from '../settings';
import { ReviewSession } from './review-session';

interface ReviewSessionHarness {
	busy: boolean;
	container: HTMLElement | null;
	current: QueueItem | null;
	leave(): Promise<void>;
	phase: 'idle' | 'question' | 'answer';
	queue: QueueItem[];
	refreshCurrentDefinition(): Promise<void>;
	sessionTotal: number;
	sessionCompleted: number;
	bury(): Promise<void>;
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
	const finished = vi.fn(async () => undefined);
	const actual = new ReviewSession(app, settings, fsrs, finished);
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

	it('shows undo only before revealing the current card and keeps source available', async () => {
		const { session } = makeHarness();

		await session.rate(Rating.Easy);

		expect(session.container?.querySelector('.remember-session-undo')).not.toBeNull();
		expect(session.container?.querySelector('.remember-session-source')).not.toBeNull();
		expect(session.container?.querySelector('.remember-session-bury')).not.toBeNull();
		session.container?.querySelector<HTMLButtonElement>('.remember-show-answer')?.click();
		expect(session.container?.querySelector('.remember-session-undo')).toBeNull();
		expect(session.container?.querySelector('.remember-session-source')).not.toBeNull();
		expect(session.container?.querySelector('.remember-session-bury')).not.toBeNull();
	});

	it('buries the current card until tomorrow and restores it through normal undo', async () => {
		const { app, session } = makeHarness();

		await session.bury();

		expect(session.current?.cardId).toBe('second');
		expect(session.sessionCompleted).toBe(1);
		const lines = (await app.vault.adapter.read('reviews-device0000001.rememberlog'))
			.trim()
			.split('\n')
			.map((line) => JSON.parse(line) as Record<string, unknown>);
		expect(lines[0]).toMatchObject({ k: 'b', c: 'first' });
		expect(lines[0]).not.toHaveProperty('s');
		expect(new Date(String(lines[0].x)).getTime()).toBeGreaterThan(new Date(String(lines[0].t)).getTime());

		await session.undo();

		expect(session.current?.cardId).toBe('first');
		expect(session.sessionCompleted).toBe(0);
		const finalLines = (await app.vault.adapter.read('reviews-device0000001.rememberlog'))
			.trim()
			.split('\n')
			.map((line) => JSON.parse(line) as Record<string, unknown>);
		expect(finalLines[1]).toMatchObject({ k: 'u', u: lines[0].i });
	});

	it('removes and restores every queued sibling when manually burying a card', async () => {
		const { session } = makeHarness();
		const sibling = { ...item('first'), sub: 1 };
		session.queue = [sibling, item('second')];
		session.sessionTotal = 3;

		await session.bury();

		expect(session.current?.cardId).toBe('second');
		expect(session.queue).toEqual([]);
		expect(session.sessionCompleted).toBe(2);

		await session.undo();

		expect(session.current).toMatchObject({ cardId: 'first', sub: 0 });
		expect(session.queue).toEqual(expect.arrayContaining([sibling, expect.objectContaining({ cardId: 'second' })]));
		expect(session.sessionCompleted).toBe(0);
	});

	it('skips the current card after its source is marked as suspended', async () => {
		const { app, session } = makeHarness();
		session.sessionTotal = 2;
		const file = app.vault.getFileByPath('note.md')!;
		await app.vault.modify(file, '{suspend} q::a %%rem:first%%');

		await session.refreshCurrentDefinition();

		expect(session.current?.cardId).toBe('second');
		expect(session.sessionTotal).toBe(1);
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
