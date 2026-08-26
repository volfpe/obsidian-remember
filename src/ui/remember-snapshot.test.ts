import { App } from 'obsidian-test-mocks/obsidian';
import { Rating } from 'ts-fsrs';
import { describe, expect, it, vi } from 'vitest';
import type { ReviewEvent } from '../core/events';
import { DEFAULT_SETTINGS } from '../settings';
import { ReviewCache, ReviewCacheError } from '../cache/review-cache';
import { RememberSnapshotRepository } from './remember-snapshot';

function review(id: string, timestamp: string): ReviewEvent {
	return {
		v: 1,
		k: 'r',
		i: id,
		t: timestamp,
		c: 'card-id',
		s: 0,
		r: Rating.Good,
		dr: 0.9,
	};
}

function line(event: ReviewEvent): string {
	return JSON.stringify(event) + '\n';
}

const CARD_NOTE = [
	'---',
	'remember-id: card-id',
	'remember-type: basic',
	'---',
	'',
	'# Front',
	'',
	'Question',
	'',
	'# Back',
	'',
	'Answer',
].join('\n');

describe('Remember snapshot review cache', () => {
	it('reuses unchanged logs and reconciles a changed or removed log before returning', async () => {
		const logPath = 'Remember/remote.rememberlog';
		const first = review('first', '2026-08-20T10:00:00.000Z');
		const second = review('second', '2026-08-21T10:00:00.000Z');
		const mockApp = App.createConfigured__({
			files: {
				'Remember/card.md': CARD_NOTE,
				[logPath]: line(first),
			},
		});
		mockApp.saveLocalStorage('remember-device-id', `device-${crypto.randomUUID()}`);
		const app = mockApp.asOriginalType__();
		const repository = new RememberSnapshotRepository(app, { ...DEFAULT_SETTINGS });

		const initial = await repository.load();
		expect(initial.states.get('card-id#0')?.reps).toBe(1);
		expect((await initial.reviewHistory.getHistory('card-id', 0)).events).toHaveLength(1);

		const read = vi.spyOn(app.vault.adapter, 'read');
		await repository.load();
		expect(read.mock.calls.some(([path]) => path === logPath)).toBe(false);

		await app.vault.adapter.append(logPath, line(second));
		mockApp.vault.reconcile__();
		const changed = await repository.load();
		expect(changed.states.get('card-id#0')?.reps).toBe(2);

		await app.vault.adapter.remove(logPath);
		mockApp.vault.reconcile__();
		const removed = await repository.load();
		expect(removed.states.has('card-id#0')).toBe(false);
		repository.close();
	});

	it('rebuilds safely when one duplicate log disappears', async () => {
		const event = review('review', '2026-08-20T10:00:00.000Z');
		const mockApp = App.createConfigured__({
			files: {
				'Remember/card.md': CARD_NOTE,
				'Remember/original.rememberlog': line(event),
				'Remember/conflict.rememberlog': line(event),
			},
		});
		mockApp.saveLocalStorage('remember-device-id', `device-${crypto.randomUUID()}`);
		const app = mockApp.asOriginalType__();
		const repository = new RememberSnapshotRepository(app, { ...DEFAULT_SETTINGS });
		expect((await repository.load()).states.get('card-id#0')?.reps).toBe(1);

		await app.vault.adapter.remove('Remember/conflict.rememberlog');
		mockApp.vault.reconcile__();

		expect((await repository.load()).states.get('card-id#0')?.reps).toBe(1);
		repository.close();
	});

	it('rebuilds without an undo after its log disappears', async () => {
		const event = review('review', '2026-08-20T10:00:00.000Z');
		const undo = JSON.stringify({
			v: 1,
			k: 'u',
			t: '2026-08-21T10:00:00.000Z',
			u: event.i,
		}) + '\n';
		const mockApp = App.createConfigured__({
			files: {
				'Remember/card.md': CARD_NOTE,
				'Remember/review.rememberlog': line(event),
				'Remember/undo.rememberlog': undo,
			},
		});
		mockApp.saveLocalStorage('remember-device-id', `device-${crypto.randomUUID()}`);
		const app = mockApp.asOriginalType__();
		const repository = new RememberSnapshotRepository(app, { ...DEFAULT_SETTINGS });
		expect((await repository.load()).states.has('card-id#0')).toBe(false);

		await app.vault.adapter.remove('Remember/undo.rememberlog');
		mockApp.vault.reconcile__();

		expect((await repository.load()).states.get('card-id#0')?.reps).toBe(1);
		repository.close();
	});

	it('does not discard a healthy index for a temporary log read failure', async () => {
		const logPath = 'Remember/remote.rememberlog';
		const first = review('first', '2026-08-20T10:00:00.000Z');
		const second = review('second', '2026-08-21T10:00:00.000Z');
		const mockApp = App.createConfigured__({
			files: { 'Remember/card.md': CARD_NOTE, [logPath]: line(first) },
		});
		mockApp.saveLocalStorage('remember-device-id', `device-${crypto.randomUUID()}`);
		const app = mockApp.asOriginalType__();
		const repository = new RememberSnapshotRepository(app, { ...DEFAULT_SETTINGS });
		await repository.load();
		await app.vault.adapter.append(logPath, line(second));
		mockApp.vault.reconcile__();
		const realRead = app.vault.adapter.read.bind(app.vault.adapter);
		const read = vi.spyOn(app.vault.adapter, 'read').mockImplementation((path) =>
			path === logPath ? Promise.reject(new Error('temporary read failure')) : realRead(path),
		);
		const deletion = vi.spyOn(indexedDB, 'deleteDatabase');

		await expect(repository.load()).rejects.toThrow('temporary read failure');
		expect(deletion).not.toHaveBeenCalled();

		read.mockRestore();
		const recovered = await repository.load();
		expect(recovered.states.get('card-id#0')?.reps).toBe(2);
		deletion.mockRestore();
		repository.close();
	});

	it('recreates the cache after an IndexedDB failure', async () => {
		const logPath = 'Remember/remote.rememberlog';
		const event = review('review', '2026-08-20T10:00:00.000Z');
		const mockApp = App.createConfigured__({
			files: { 'Remember/card.md': CARD_NOTE, [logPath]: line(event) },
		});
		mockApp.saveLocalStorage('remember-device-id', `device-${crypto.randomUUID()}`);
		const app = mockApp.asOriginalType__();
		const repository = new RememberSnapshotRepository(app, { ...DEFAULT_SETTINGS });
		await repository.load();
		const storedFiles = vi.spyOn(ReviewCache.prototype, 'storedFiles').mockRejectedValueOnce(
			new ReviewCacheError('broken cache'),
		);
		const deletion = vi.spyOn(indexedDB, 'deleteDatabase');
		const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

		const rebuilt = await repository.load();

		expect(deletion).toHaveBeenCalledOnce();
		expect(rebuilt.states.get('card-id#0')?.reps).toBe(1);
		storedFiles.mockRestore();
		warning.mockRestore();
		deletion.mockRestore();
		repository.close();
	});
});
