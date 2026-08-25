// Device id + the per-device append-only event logs (<deviceId>.rememberlog).
// These logs are the only scheduling store: no snapshot, no cache file, no database.
// Events are written and read only inside the Remember root folder; logs anywhere
// else are ignored. The root folder setting warns users to move the folder (and the
// logs with it) instead of leaving history behind.

import type { App, TFile } from 'obsidian';
import type { CardEvent, LogEvent, ReviewEvent } from './core/events';
import { randomId } from './core/id';
import { ensureFolder, parentPath } from './vault-folders';

const DEVICE_ID_KEY = 'remember-device-id';
const LOG_EXTENSION = '.rememberlog';

/** Device-local (localStorage never syncs). Losing it is harmless: a new log starts, old ones keep being read. */
export function getDeviceId(app: App): string {
	const stored: unknown = app.loadLocalStorage(DEVICE_ID_KEY);
	if (typeof stored === 'string' && stored !== '') return stored;
	const minted = randomId();
	app.saveLocalStorage(DEVICE_ID_KEY, minted);
	return minted;
}

function ownLogName(app: App): string {
	return `${getDeviceId(app)}${LOG_EXTENSION}`;
}

function ownLogPath(app: App, rootFolder: string): string {
	return rootFolder === '' ? ownLogName(app) : `${rootFolder}/${ownLogName(app)}`;
}

/** True append via the adapter — no read-modify-write. */
export async function appendEvent(app: App, rootFolder: string, event: CardEvent): Promise<void> {
	await appendLogEvent(app, rootFolder, event);
}

/** Appends a tombstone for a reversible event. The original event remains in the log. */
export async function appendUndoEvent(app: App, rootFolder: string, eventId: string): Promise<void> {
	await appendLogEvent(app, rootFolder, { v: 1, k: 'u', t: new Date().toISOString(), u: eventId });
}

async function appendLogEvent(app: App, rootFolder: string, event: LogEvent): Promise<void> {
	await ensureFolder(app, rootFolder);
	await app.vault.adapter.append(ownLogPath(app, rootFolder), JSON.stringify(event) + '\n');
}

/** Every review log inside the root folder. */
export function listLogFiles(app: App, rootFolder: string): TFile[] {
	return app.vault
		.getFiles()
		.filter((file) => isLogFile(file.name) && parentPath(file.path) === rootFolder);
}

/** Active reviews across every device's log. Undo tombstones are applied independent of file order. */
export async function readEvents(app: App, rootFolder: string): Promise<ReviewEvent[]> {
	return (await readCardEvents(app, rootFolder)).filter((event): event is ReviewEvent => event.k === 'r');
}

/** Active reviews and temporary card actions across every device's log. */
export async function readCardEvents(app: App, rootFolder: string): Promise<CardEvent[]> {
	const seenEvents = new Set<string>();
	const events: CardEvent[] = [];
	const undone = new Set<string>();
	// The own log is read by its known path: a log created moments ago may not be
	// in the vault's file index yet.
	const paths = new Set(listLogFiles(app, rootFolder).map((file) => file.path));
	const own = ownLogPath(app, rootFolder);
	if (!paths.has(own) && (await app.vault.adapter.exists(own))) paths.add(own);
	for (const path of paths) {
		let content: string;
		try {
			content = await app.vault.adapter.read(path);
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
			if (seenEvents.has(event.i)) continue;
			seenEvents.add(event.i);
			events.push(event);
		}
	}
	return events.filter((event) => !undone.has(event.i));
}

/**
 * Merges sync-conflict copies of the own device's log back into it and deletes them.
 * Safe: this device is the only writer of both. Copies of other devices' files are
 * left alone, and only the root folder is touched.
 */
export async function cleanOwnConflictCopies(app: App, rootFolder: string): Promise<void> {
	const adapter = app.vault.adapter;
	const own = ownLogName(app);
	const prefix = own.slice(0, -LOG_EXTENSION.length);
	const copies = listLogFiles(app, rootFolder)
		.filter((file) => file.name !== own && file.name.startsWith(prefix))
		.map((file) => file.path);
	if (copies.length === 0) return;

	const ownPath = ownLogPath(app, rootFolder);
	const ownLines = new Set(
		(await adapter.exists(ownPath)) ? (await adapter.read(ownPath)).split('\n').filter((line) => line.trim() !== '') : [],
	);
	await ensureFolder(app, rootFolder);
	for (const copy of copies) {
		const missing = (await adapter.read(copy)).split('\n').filter((line) => line.trim() !== '' && !ownLines.has(line));
		if (missing.length > 0) {
			await adapter.append(ownPath, missing.join('\n') + '\n');
			for (const line of missing) ownLines.add(line);
		}
		await adapter.remove(copy);
	}
}

function isLogFile(name: string): boolean {
	return name.endsWith(LOG_EXTENSION);
}

function parseLogEventLine(line: string): LogEvent | null {
	try {
		const value: unknown = JSON.parse(line);
		if (typeof value !== 'object' || value === null) return null;
		const { v, k, i, t, c, s, r, dr, x, u } = value as Record<string, unknown>;
		if (v !== 1) return null;
		if (typeof t !== 'string' || Number.isNaN(Date.parse(t))) return null;
		if (k === 'u') {
			if (typeof u !== 'string' || u === '') return null;
			return { v, k, t, u };
		}
		if (typeof i !== 'string' || i === '') return null;
		if (typeof c !== 'string' || c === '') return null;
		if (k === 'b') {
			if (typeof x !== 'string' || Number.isNaN(Date.parse(x))) return null;
			return { v, k, i, t, c, x };
		}
		if (k !== 'r') return null;
		if (typeof s !== 'number' || !Number.isInteger(s) || s < 0) return null;
		if (typeof dr !== 'number' || !Number.isFinite(dr) || dr <= 0 || dr > 1) return null;
		if (r === 1 || r === 2 || r === 3 || r === 4) return { v, k, i, t, c, s, r, dr };
		return null;
	} catch {
		return null;
	}
}
