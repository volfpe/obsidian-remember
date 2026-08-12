import { App } from 'obsidian-test-mocks/obsidian';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReviewEvent } from './core/events';
import { appendEvent, appendUndoEvent, cleanOwnConflictCopies, getDeviceId, readEvents } from './log';

const folder = '_remember';
const deviceId = 'device0000001';

function event(t: string, c: string, r: 1 | 2 | 3 | 4 = 3): ReviewEvent {
	return { v: 1, k: 'r', i: `${c}-${t}`, t, c, s: 0, r, dr: 0.9 };
}

function jsonl(...events: ReviewEvent[]): string {
	return events.map((entry) => JSON.stringify(entry)).join('\n') + '\n';
}

function appWithFiles(files: Record<string, string> = {}) {
	const mockApp = App.createConfigured__({ files });
	mockApp.saveLocalStorage('remember-device-id', deviceId);
	return mockApp.asOriginalType__();
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

	it('creates the folder and appends one complete JSON line', async () => {
		const app = appWithFiles();
		const review = event('2026-08-11T09:14:03.120Z', 'card1');

		await appendEvent(app, folder, review);

		expect(await app.vault.adapter.read(`${folder}/reviews-${deviceId}.jsonl`)).toBe(jsonl(review));
	});
});

describe('readEvents', () => {
	it('reads every review log, skips one malformed line, and deduplicates events', async () => {
		const first = event('2026-08-11T09:14:03.120Z', 'card1');
		const second = event('2026-08-11T09:15:03.120Z', 'card2', 1);
		const app = appWithFiles({
			[`${folder}/reviews-a.jsonl`]: `${jsonl(first)}not json\n`,
			[`${folder}/reviews-b conflict.jsonl`]: jsonl(first, second),
			[`${folder}/unrelated.jsonl`]: jsonl(event('2026-08-11T09:16:03.120Z', 'ignored')),
		});
		const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

		const reviews = await readEvents(app, folder);

		expect(reviews).toEqual([first, second]);
		expect(warning).toHaveBeenCalledOnce();
	});
});

describe('conflict cleanup', () => {
	it('merges only own missing lines, removes own conflict copies, and leaves other devices alone', async () => {
		const first = event('2026-08-11T09:14:03.120Z', 'card1');
		const second = event('2026-08-11T09:15:03.120Z', 'card2');
		const other = event('2026-08-11T09:16:03.120Z', 'card3');
		const ownPath = `${folder}/reviews-${deviceId}.jsonl`;
		const conflictPath = `${folder}/reviews-${deviceId} (conflict).jsonl`;
		const otherPath = `${folder}/reviews-otherdevice1.jsonl`;
		const app = appWithFiles({
			[ownPath]: jsonl(first),
			[conflictPath]: jsonl(first, second),
			[otherPath]: jsonl(other),
		});
		vi.spyOn(console, 'log').mockImplementation(() => undefined);

		await cleanOwnConflictCopies(app, folder);

		expect(await app.vault.adapter.read(ownPath)).toBe(jsonl(first, second));
		expect(await app.vault.adapter.exists(conflictPath)).toBe(false);
		expect(await app.vault.adapter.read(otherPath)).toBe(jsonl(other));
	});
});

describe('append-only undo', () => {
	it('appends a tombstone and excludes its review when logs are read', async () => {
		const first = event('2026-08-11T09:14:03.120Z', 'card1');
		const second = event('2026-08-11T09:15:03.120Z', 'card2');
		const path = `${folder}/reviews-${deviceId}.jsonl`;
		const app = appWithFiles({ [path]: jsonl(first, second) });

		await appendUndoEvent(app, folder, first.i);

		const lines = (await app.vault.adapter.read(path)).trim().split('\n');
		expect(lines).toHaveLength(3);
		expect(JSON.parse(lines[2])).toMatchObject({ v: 1, k: 'u', u: first.i });
		expect(await readEvents(app, folder)).toEqual([second]);
	});
});
