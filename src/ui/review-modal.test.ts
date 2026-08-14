import { Rating, type Grade } from 'ts-fsrs';
import { App } from 'obsidian-test-mocks/obsidian';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NoteCard, QueueItem } from '../core/queue';
import { DEFAULT_SETTINGS } from '../settings';
import { ReviewModal } from './review-modal';

interface ReviewModalHarness {
	busy: boolean;
	contentEl: HTMLElement;
	current: QueueItem | null;
	phase: 'decks' | 'question' | 'answer';
	queue: QueueItem[];
	rate(grade: Grade): Promise<void>;
	scanCards(): Promise<NoteCard[]>;
	showDeckList(): Promise<void>;
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

function makeHarness(): { app: ReturnType<App['asOriginalType__']>; modal: ReviewModalHarness } {
	const mockApp = App.createConfigured__({ files: { 'note.md': 'q::a' } });
	mockApp.saveLocalStorage('remember-device-id', 'device0000001');
	const app = mockApp.asOriginalType__();
	const modal = new ReviewModal(app, { ...DEFAULT_SETTINGS }) as unknown as ReviewModalHarness;
	modal.current = item('first');
	modal.queue = [item('second')];
	modal.phase = 'answer';
	return { app, modal };
}

afterEach(() => vi.restoreAllMocks());

describe('rating durability', () => {
	it('does not advance when appending the rating fails', async () => {
		const { app, modal } = makeHarness();
		vi.spyOn(app.vault.adapter, 'append').mockRejectedValue(new Error('disk full'));

		await modal.rate(Rating.Good);

		expect(modal.current?.cardId).toBe('first');
		expect(modal.queue.map((queued) => queued.cardId)).toEqual(['second']);
		expect(modal.busy).toBe(false);
	});

	it('ignores another rating while an append is pending and advances exactly once afterward', async () => {
		const { app, modal } = makeHarness();
		const appendStarted = deferred();
		const allowAppend = deferred();
		const originalAppend = app.vault.adapter.append.bind(app.vault.adapter);
		vi.spyOn(app.vault.adapter, 'append').mockImplementation(async (...args) => {
			appendStarted.resolve();
			await allowAppend.promise;
			await originalAppend(...args);
		});

		const rating = modal.rate(Rating.Easy);
		await appendStarted.promise;
		await modal.rate(Rating.Again);
		const currentWhilePending = modal.current?.cardId;
		allowAppend.resolve();
		await rating;

		expect(currentWhilePending).toBe('first');
		expect(modal.current?.cardId).toBe('second');
		expect(modal.queue).toEqual([]);
	});
});

describe('deck list', () => {
	function freshCard(id: string): NoteCard {
		return {
			id,
			front: `front of ${id}`,
			back: `back of ${id}`,
			reversed: false,
			multiline: false,
			line: 0,
			path: `${id}.md`,
			deck: 'deck',
		};
	}

	it('shows Waiting only when the daily limit holds back unseen cards', async () => {
		const { app } = makeHarness();
		const limited = new ReviewModal(app, {
			...DEFAULT_SETTINGS,
			limitNewCardsPerDay: true,
			newCardsPerDay: 1,
		}) as unknown as ReviewModalHarness;
		limited.scanCards = async () => [freshCard('a'), freshCard('b')];

		await limited.showDeckList();

		expect(limited.contentEl.querySelector('.remember-deck-header')?.textContent).toContain('Waiting');
		expect(limited.contentEl.querySelector('.remember-count-new')?.textContent).toBe('1');
		expect(limited.contentEl.querySelector('.remember-count-waiting')?.textContent).toBe('1');

		const roomy = new ReviewModal(app, {
			...DEFAULT_SETTINGS,
			limitNewCardsPerDay: true,
			newCardsPerDay: 2,
		}) as unknown as ReviewModalHarness;
		roomy.scanCards = async () => [freshCard('a'), freshCard('b')];

		await roomy.showDeckList();

		expect(roomy.contentEl.querySelector('.remember-deck-header')?.textContent).not.toContain('Waiting');
		expect(roomy.contentEl.querySelector('.remember-count-waiting')).toBeNull();
	});

	it('leaves new card introductions unlimited by default', async () => {
		const { app } = makeHarness();
		const modal = new ReviewModal(app, { ...DEFAULT_SETTINGS }) as unknown as ReviewModalHarness;
		modal.scanCards = async () => Array.from({ length: 25 }, (_, index) => freshCard(`card-${index}`));

		await modal.showDeckList();

		expect(modal.contentEl.querySelector('.remember-count-new')?.textContent).toBe('25');
		expect(modal.contentEl.querySelector('.remember-count-waiting')).toBeNull();
	});

	it('explains every visible count header with an accessible tooltip', async () => {
		const { app } = makeHarness();
		const modal = new ReviewModal(app, {
			...DEFAULT_SETTINGS,
			limitNewCardsPerDay: true,
			newCardsPerDay: 1,
		}) as unknown as ReviewModalHarness;
		modal.scanCards = async () => [freshCard('a'), freshCard('b')];

		await modal.showDeckList();

		const labels = ['Due', 'New', 'Waiting', 'Total'];
		for (const label of labels) {
			expect(modal.contentEl.querySelector(`[aria-label^="${label}:"]`)?.textContent).toBe(label);
		}
	});
});
