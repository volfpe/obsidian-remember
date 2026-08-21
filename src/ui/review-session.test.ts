import { Rating, type Grade } from 'ts-fsrs';
import { App } from 'obsidian-test-mocks/obsidian';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PracticeSessionQueue } from '../core/practice';
import type { QueueItem } from '../core/queue';
import { applyRating, makeFsrs } from '../core/scheduler';
import { DeckSettingsIndex } from '../deck-settings';
import { DEFAULT_SETTINGS } from '../settings';
import type { RememberSettings } from '../settings';
import { ReviewSession } from './review-session';

interface ReviewSessionHarness {
	busy: boolean;
	container: HTMLElement | null;
	current: QueueItem | null;
	deckSettings: DeckSettingsIndex;
	leave(): Promise<void>;
	phase: 'idle' | 'question' | 'answer';
	mode: 'review' | 'practice';
	queue: QueueItem[];
	practiceQueue: PracticeSessionQueue | null;
	refreshCurrentDefinition(): Promise<void>;
	sessionTotal: number;
	sessionCompleted: number;
	bury(): Promise<void>;
	rate(grade: Grade): Promise<void>;
	practiceRate(grade: Grade, when?: Date): void;
	showAnswer(): void;
	undo(): Promise<void>;
}

function item(cardId: string): QueueItem {
	return {
		path: 'note.md',
		line: 0,
		deck: '',
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

function makeHarness(overrides: Partial<RememberSettings> = {}): {
	app: ReturnType<App['asOriginalType__']>;
	finished: ReturnType<typeof vi.fn>;
	session: ReviewSessionHarness;
} {
	const noteContent = ['---', 'remember-id: first', 'remember-type: basic', '---', '', '# Front', '', 'q', '', '# Back', '', 'a', ''].join('\n');
	const mockApp = App.createConfigured__({ files: { 'note.md': noteContent } });
	mockApp.saveLocalStorage('remember-device-id', 'device0000001');
	const app = mockApp.asOriginalType__();
	const settings = { ...DEFAULT_SETTINGS, ...overrides };
	const finished = vi.fn(async () => undefined);
	const actual = new ReviewSession(app, settings, finished);
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
	it('records the loaded retention', async () => {
		const { app, session } = makeHarness({ desiredRetention: 0.95 });

		await session.rate(Rating.Easy);

		const [event] = (await app.vault.adapter.read('Remember/reviews-device0000001.rememberlog'))
			.trim()
			.split('\n')
			.map((line) => JSON.parse(line) as Record<string, unknown>);
		expect(event.dr).toBe(0.95);
	});

	it('records retention from the card deck', async () => {
		const { app, session } = makeHarness();
		session.current = { ...item('first'), deck: 'Language/Spanish' };
		session.deckSettings = new DeckSettingsIndex(
			DEFAULT_SETTINGS,
			new Map([['Language', { desiredRetention: 0.95 }]]),
		);

		await session.rate(Rating.Easy);

		const [event] = (await app.vault.adapter.read('Remember/reviews-device0000001.rememberlog'))
			.trim()
			.split('\n')
			.map((line) => JSON.parse(line) as Record<string, unknown>);
		expect(event.dr).toBe(0.95);
	});

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
	it('returns a short-delay card behind the available queue by default', async () => {
		const { session } = makeHarness();

		await session.rate(Rating.Good);

		expect(session.current?.cardId).toBe('second');
		expect(session.queue.map((queued) => queued.cardId)).toEqual(['first']);
		expect(session.sessionCompleted).toBe(0);
	});

	it('completes a short-delay card when learn ahead is disabled', async () => {
		const { session } = makeHarness({ learnAhead: false });

		await session.rate(Rating.Good);

		expect(session.current?.cardId).toBe('second');
		expect(session.queue).toEqual([]);
		expect(session.sessionCompleted).toBe(1);
	});

	it('completes a card whose delay exceeds a custom learn-ahead limit', async () => {
		const { session } = makeHarness({ learnAheadMinutes: 5 });

		await session.rate(Rating.Good);

		expect(session.current?.cardId).toBe('second');
		expect(session.queue).toEqual([]);
		expect(session.sessionCompleted).toBe(1);
	});

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
		const lines = (await app.vault.adapter.read('Remember/reviews-device0000001.rememberlog'))
			.trim()
			.split('\n')
			.map((line) => JSON.parse(line) as Record<string, unknown>);
		expect(lines[0]).toMatchObject({ k: 'b', c: 'first' });
		expect(lines[0]).not.toHaveProperty('s');
		expect(new Date(String(lines[0].x)).getTime()).toBeGreaterThan(new Date(String(lines[0].t)).getTime());

		await session.undo();

		expect(session.current?.cardId).toBe('first');
		expect(session.sessionCompleted).toBe(0);
		const finalLines = (await app.vault.adapter.read('Remember/reviews-device0000001.rememberlog'))
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
		await app.vault.modify(
			file,
			['---', 'remember-id: first', 'remember-type: basic', 'remember-suspend: true', '---', '', '# Front', '', 'q', '', '# Back', '', 'a', ''].join('\n'),
		);

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

describe('Practice mode', () => {
	function enterPractice(session: ReviewSessionHarness): void {
		session.mode = 'practice';
		session.phase = 'answer';
		session.sessionTotal = 2;
		session.sessionCompleted = 0;
		session.practiceQueue = new PracticeSessionQueue(session.queue);
		session.queue = [];
	}

	it('keeps ratings in memory and learns ahead when only a retry remains', async () => {
		const { app, session } = makeHarness();
		enterPractice(session);
		session.current!.state = applyRating(
			makeFsrs(0.9),
			null,
			new Date('2026-08-01T10:00:00.000Z'),
			Rating.Good,
		);
		const realState = session.current!.state;
		const realDue = realState.due.getTime();
		const when = new Date();

		session.practiceRate(Rating.Again, when);

		expect(session.current?.cardId).toBe('second');
		expect(realState.due.getTime()).toBe(realDue);

		session.phase = 'answer';
		session.practiceRate(Rating.Good, when);

		expect(session.current?.cardId).toBe('first');
		expect(session.current?.state).toBe(realState);
		expect(session.sessionCompleted).toBe(1);
		expect(await app.vault.adapter.exists('Remember/reviews-device0000001.rememberlog')).toBe(false);
	});

	it('renders temporary delays only for Again and Hard and offers no bury action', () => {
		const { session } = makeHarness();
		enterPractice(session);

		session.showAnswer();

		expect(
			Array.from(session.container!.querySelectorAll('.remember-interval')).map(
				(element) => element.textContent,
			),
		).toEqual(['1m', '10m']);
		expect(session.container!.querySelectorAll('.remember-session-return')).toHaveLength(2);
		expect(
			Array.from(session.container!.querySelectorAll('.remember-session-return')).map((element) =>
				element.getAttribute('aria-label'),
			),
		).toEqual([
			'Repeats in 1 minute during this practice session',
			'Repeats in 10 minutes during this practice session',
		]);
		expect(session.container!.textContent).toContain('Again1m');
		expect(session.container!.textContent).toContain('Hard10m');
		expect(session.container!.querySelector('.remember-session-bury')).toBeNull();
		expect(session.container!.querySelector('.remember-session-undo')).toBeNull();
	});
});
