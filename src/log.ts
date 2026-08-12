// Device id + the per-device append-only event logs (reviews-<deviceId>.jsonl).
// These logs are the only scheduling store: no snapshot, no cache file, no database.

import { normalizePath, type App } from 'obsidian';
import type { LogEvent, ReviewEvent } from './core/events';
import { randomId } from './core/id';

const DEVICE_ID_KEY = 'remember-device-id';

/** Device-local (localStorage never syncs). Losing it is harmless: a new log starts, old ones keep being read. */
export function getDeviceId(app: App): string {
	const stored: unknown = app.loadLocalStorage(DEVICE_ID_KEY);
	if (typeof stored === 'string' && stored !== '') return stored;
	const minted = randomId();
	app.saveLocalStorage(DEVICE_ID_KEY, minted);
	return minted;
}

function ownLogName(app: App): string {
	return `reviews-${getDeviceId(app)}.jsonl`;
}

function ownLogPath(app: App, folder: string): string {
	return normalizePath(`${folder}/${ownLogName(app)}`);
}

/** True append via the adapter — no read-modify-write. Creates the log folder on demand. */
export async function appendEvent(app: App, folder: string, event: ReviewEvent): Promise<void> {
	await appendLogEvent(app, folder, event);
}

/** Appends a tombstone for a review. The original event remains in the log. */
export async function appendUndoEvent(app: App, folder: string, reviewId: string): Promise<void> {
	await appendLogEvent(app, folder, { v: 1, k: 'u', t: new Date().toISOString(), u: reviewId });
}

async function appendLogEvent(app: App, folder: string, event: LogEvent): Promise<void> {
	await ensureFolder(app, folder);
	await app.vault.adapter.append(ownLogPath(app, folder), JSON.stringify(event) + '\n');
}

/** Active reviews across every device's log. Undo tombstones are applied independent of file order. */
export async function readEvents(app: App, folder: string): Promise<ReviewEvent[]> {
	const adapter = app.vault.adapter;
	const dir = normalizePath(folder);
	if (!(await adapter.exists(dir))) return [];
	const seenReviews = new Set<string>();
	const reviews: ReviewEvent[] = [];
	const undone = new Set<string>();
	for (const path of (await adapter.list(dir)).files) {
		if (!isLogFile(baseName(path))) continue;
		let content: string;
		try {
			content = await adapter.read(path);
		} catch (error) {
			console.warn(`Remember: cannot read ${path}; skipping it`, error);
			continue;
		}
		for (const line of content.split('\n')) {
			if (line.trim() === '') continue;
			const event = parseLogEventLine(line);
			if (!event) {
				console.warn(`Remember: skipping bad log line in ${path}: ${line}`);
				continue;
			}
			if (event.k === 'u') {
				undone.add(event.u);
				continue;
			}
			if (seenReviews.has(event.i)) continue;
			seenReviews.add(event.i);
			reviews.push(event);
		}
	}
	return reviews.filter((event) => !undone.has(event.i));
}

/**
 * Merges sync-conflict copies of the own device's log back into it and deletes them.
 * Safe: this device is the only writer of both. Copies of other devices' files are left alone.
 */
export async function cleanOwnConflictCopies(app: App, folder: string): Promise<void> {
	const adapter = app.vault.adapter;
	const dir = normalizePath(folder);
	if (!(await adapter.exists(dir))) return;
	const own = ownLogName(app);
	const prefix = own.slice(0, -'.jsonl'.length);
	const copies = (await adapter.list(dir)).files.filter((path) => {
		const name = baseName(path);
		return isLogFile(name) && name !== own && name.startsWith(prefix);
	});
	if (copies.length === 0) return;

	const ownPath = ownLogPath(app, folder);
	const ownLines = new Set(
		(await adapter.exists(ownPath)) ? (await adapter.read(ownPath)).split('\n').filter((line) => line.trim() !== '') : [],
	);
	for (const copy of copies) {
		const missing = (await adapter.read(copy)).split('\n').filter((line) => line.trim() !== '' && !ownLines.has(line));
		if (missing.length > 0) {
			await adapter.append(ownPath, missing.join('\n') + '\n');
			for (const line of missing) ownLines.add(line);
		}
		await adapter.remove(copy);
	}
}

async function ensureFolder(app: App, folder: string): Promise<void> {
	let path = '';
	for (const part of normalizePath(folder).split('/')) {
		path = path === '' ? part : `${path}/${part}`;
		if (!(await app.vault.adapter.exists(path))) await app.vault.adapter.mkdir(path);
	}
}

function baseName(path: string): string {
	return path.slice(path.lastIndexOf('/') + 1);
}

function isLogFile(name: string): boolean {
	return name.startsWith('reviews-') && name.endsWith('.jsonl');
}

function parseLogEventLine(line: string): LogEvent | null {
	try {
		const value: unknown = JSON.parse(line);
		if (typeof value !== 'object' || value === null) return null;
		const { v, k, i, t, c, s, r, dr, u } = value as Record<string, unknown>;
		if (v !== 1) return null;
		if (typeof t !== 'string' || Number.isNaN(Date.parse(t))) return null;
		if (k === 'u') {
			if (typeof u !== 'string' || u === '') return null;
			return { v, k, t, u };
		}
		if (k !== 'r') return null;
		if (typeof i !== 'string' || i === '') return null;
		if (typeof c !== 'string' || c === '') return null;
		if (typeof s !== 'number' || !Number.isInteger(s) || s < 0) return null;
		if (typeof dr !== 'number' || !Number.isFinite(dr) || dr <= 0 || dr > 1) return null;
		if (r === 1 || r === 2 || r === 3 || r === 4) return { v, k, i, t, c, s, r, dr };
		return null;
	} catch {
		return null;
	}
}
