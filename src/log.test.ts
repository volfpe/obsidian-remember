import { App } from 'obsidian-test-mocks/obsidian';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BuryEvent, ReviewEvent } from './core/events';
import {
	appendEvent,
	appendUndoEvent,
	cleanOwnConflictCopies,
	getDeviceId,
	readCardEvents,
	readEvents,
} from './log';

const deviceId = 'device0000001';
const root = 'Remember';

function event(t: string, c: string, r: 1 | 2 | 3 | 4 = 3): ReviewEvent {
	return { v: 1, k: 'r', i: `${c}-${t}`, t, c, s: 0, r, dr: 0.9 };
}

function jsonl(...events: ReviewEvent[]): string {
	return events.map((entry) => JSON.stringify(entry)).join('\n') + '\n';
}

function mockAppWithFiles(files: Record<string, string> = {}) {
	const mockApp = App.createConfigured__({ files });
	mockApp.saveLocalStorage('remember-device-id', deviceId);
	return mockApp;
}

async function writeFiles(mockApp: App, files: Record<string, string>): Promise<void> {
	for (const [path, content] of Object.entries(files)) {
		await mockApp.vault.adapter.write(path, content);
	}
	mockApp.vault.reconcile__();
}

afterEach(() => vi.restoreAllMocks());

describe('device id and append', () => {
	it('mints once and persists the device id in Obsidian local storage', () => {
		const mockApp = App.createConfigured__();
		const app = mockApp.asOriginalType__();

		const first = getDeviceId(app);

		expect(first).toMatch(/^[0-9a-z]{13}$/);
		expect(getDeviceId(app)).toBe(first);
		expect(mockApp.loadLocalStorage('remember-device-id')).toBe(first);
	});

	it('appends one complete JSON line to its device log inside the root folder', async () => {
		const mockApp = mockAppWithFiles();
		const app = mockApp.asOriginalType__();
		const review = event('2026-08-11T09:14:03.120Z', 'card1');

		await appendEvent(app, root, review);

		expect(await app.vault.adapter.read(`${root}/reviews-${deviceId}.rememberlog`)).toBe(jsonl(review));
	});
});

describe('readEvents', () => {
	it('reads only root-folder logs, skips one malformed line, and deduplicates events', async () => {
		const first = event('2026-08-11T09:14:03.120Z', 'card1');
		const second = event('2026-08-11T09:15:03.120Z', 'card2', 1);
		const mockApp = mockAppWithFiles();
		const app = mockApp.asOriginalType__();
		await writeFiles(mockApp, {
			[`${root}/reviews-a.rememberlog`]: `${jsonl(first)}not json\n`,
			[`${root}/reviews-b conflict.rememberlog`]: jsonl(first, second),
			'reviews-outside.rememberlog': jsonl(event('2026-08-11T09:16:03.120Z', 'ignored')),
			[`${root}/unrelated.md`]: 'not a log',
		});
		const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

		const reviews = await readEvents(app, root);

		expect(reviews).toEqual([first, second]);
		expect(warning).toHaveBeenCalledOnce();
	});

});

describe('conflict cleanup', () => {
	it('merges only own missing lines into the root-folder log and leaves other devices alone', async () => {
		const first = event('2026-08-11T09:14:03.120Z', 'card1');
		const second = event('2026-08-11T09:15:03.120Z', 'card2');
		const other = event('2026-08-11T09:16:03.120Z', 'card3');
		const mockApp = mockAppWithFiles();
		const app = mockApp.asOriginalType__();
		const ownPath = `${root}/reviews-${deviceId}.rememberlog`;
		const conflictPath = `${root}/reviews-${deviceId} (conflict).rememberlog`;
		const otherPath = 'reviews-otherdevice1.rememberlog';
		await writeFiles(mockApp, {
			[ownPath]: jsonl(first),
			[conflictPath]: jsonl(first, second),
			[otherPath]: jsonl(other),
		});
		vi.spyOn(console, 'log').mockImplementation(() => undefined);

		await cleanOwnConflictCopies(app, root);

		expect(await app.vault.adapter.read(ownPath)).toBe(jsonl(first, second));
		expect(await app.vault.adapter.exists(conflictPath)).toBe(false);
		expect(await app.vault.adapter.read(otherPath)).toBe(jsonl(other));
	});

	it('leaves history with the own name in an old location untouched', async () => {
		const first = event('2026-08-11T09:14:03.120Z', 'card1');
		const mockApp = mockAppWithFiles();
		const app = mockApp.asOriginalType__();
		const legacyPath = `reviews-${deviceId}.rememberlog`;
		await writeFiles(mockApp, { [legacyPath]: jsonl(first) });

		await cleanOwnConflictCopies(app, root);

		expect(await app.vault.adapter.read(legacyPath)).toBe(jsonl(first));
		expect(await app.vault.adapter.exists(`${root}/reviews-${deviceId}.rememberlog`)).toBe(false);
	});
});

describe('append-only undo', () => {
	it('appends a tombstone and excludes its review when logs are read', async () => {
		const first = event('2026-08-11T09:14:03.120Z', 'card1');
		const second = event('2026-08-11T09:15:03.120Z', 'card2');
		const mockApp = mockAppWithFiles();
		const app = mockApp.asOriginalType__();
		const path = `${root}/reviews-${deviceId}.rememberlog`;
		await writeFiles(mockApp, { [path]: jsonl(first, second) });

		await appendUndoEvent(app, root, first.i);

		const lines = (await app.vault.adapter.read(path)).trim().split('\n');
		expect(lines).toHaveLength(3);
		expect(JSON.parse(lines[2])).toMatchObject({ v: 1, k: 'u', u: first.i });
		expect(await readEvents(app, root)).toEqual([second]);
	});

	it('uses the same tombstone to undo a temporary bury event', async () => {
		const bury: BuryEvent = {
			v: 1,
			k: 'b',
			i: 'bury-card1',
			t: '2026-08-11T09:14:03.120Z',
			c: 'card1',
			x: '2026-08-12T00:00:00.000Z',
		};
		const mockApp = mockAppWithFiles();
		const app = mockApp.asOriginalType__();

		await appendEvent(app, root, bury);
		mockApp.vault.reconcile__();
		expect(await readCardEvents(app, root)).toEqual([bury]);
		await appendUndoEvent(app, root, bury.i);

		expect(await readCardEvents(app, root)).toEqual([]);
	});
});
