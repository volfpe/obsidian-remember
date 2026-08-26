import type { Card as FsrsCard } from 'ts-fsrs';
import type { BuryEvent, CardEvent, ReviewEvent } from '../core/events';
import { siblingKey, foldEventsByRetention, type RetentionReplayMode } from '../core/scheduler';
import { parseLogEventLine, type ReviewLogFile } from '../log';

const CACHE_FORMAT_VERSION = 2;
const FILES = 'files';
const EVENTS = 'events';
const UNDOS = 'undos';
const STATES = 'states';

interface StoredUndo {
	targetId: string;
}

type StoredCardEvent = CardEvent & { undone: boolean };

export interface CachedReviewLogFile extends ReviewLogFile {
	contentHash: string;
}

interface StoredSiblingState {
	key: string;
	projection: string;
	state: FsrsCard | null;
	firstReviewAt: string | null;
}

export interface SiblingProjectionRequest {
	cardId: string;
	sub: number;
	desiredRetention: number;
}

export interface ReviewProjection {
	states: Map<string, FsrsCard>;
	introducedToday: Set<string>;
	reviewedToday: Set<string>;
}

export interface ReviewHistoryCursor {
	t: string;
	i: string;
}

export interface ReviewHistoryPage {
	events: ReviewEvent[];
	next: ReviewHistoryCursor | null;
}

export interface ReviewHistoryReader {
	getHistory(
		cardId: string,
		sub: number,
		limit?: number,
		before?: ReviewHistoryCursor | null,
	): Promise<ReviewHistoryPage>;
}

/** An IndexedDB failure for which the disposable local cache may be recreated safely. */
export class ReviewCacheError extends Error {
	constructor(message: string, readonly cause?: unknown) {
		super(message);
		this.name = 'ReviewCacheError';
	}
}

/** Disposable device-local cache derived entirely from review logs. */
export class ReviewCache implements ReviewHistoryReader {
	private constructor(private db: IDBDatabase) {}

	static async open(name: string): Promise<ReviewCache> {
		let opened: IDBDatabase | null = null;
		try {
			opened = await openDatabase(name);
			validateSchema(opened);
			return new ReviewCache(opened);
		} catch (error) {
			opened?.close();
			await deleteDatabase(name);
			try {
				return new ReviewCache(await openDatabase(name));
			} catch {
				throw error;
			}
		}
	}

	static async recreate(name: string): Promise<ReviewCache> {
		await deleteDatabase(name);
		return new ReviewCache(await openDatabase(name));
	}

	close(): void {
		this.db.close();
	}

	async storedFiles(): Promise<Map<string, CachedReviewLogFile>> {
		const tx = cacheTransaction(this.db, FILES, 'readonly');
		const done = transactionDone(tx);
		const files = await readAll<CachedReviewLogFile>(tx.objectStore(FILES));
		await done;
		return new Map(files.map((file) => [file.path, file]));
	}

	async replaceFile(file: ReviewLogFile, content: string): Promise<'cached' | 'rebuild'> {
		const bytes = new TextEncoder().encode(content);
		if (bytes.byteLength !== file.size) {
			throw new Error(`Review log changed while reading: ${file.path}`);
		}
		if (content !== '' && !content.endsWith('\n')) {
			throw new Error(`Review log has an incomplete final line: ${file.path}`);
		}
		const previous = await this.storedFile(file.path);
		const contentHash = await hashBytes(bytes);
		if (!previous) {
			await this.ingestFile({ ...file, contentHash }, content);
			return 'cached';
		}
		if (file.size < previous.size) return 'rebuild';
		if (file.size === previous.size) {
			if (contentHash !== previous.contentHash) return 'rebuild';
			await this.updateFileMetadata({ ...file, contentHash });
			return 'cached';
		}
		const prefixHash = await hashBytes(bytes.slice(0, previous.size));
		if (prefixHash !== previous.contentHash) return 'rebuild';
		const appended = new TextDecoder().decode(bytes.slice(previous.size));
		await this.ingestFile({ ...file, contentHash }, appended);
		return 'cached';
	}

	async projection(
		requests: SiblingProjectionRequest[],
		mode: RetentionReplayMode,
		now: Date,
	): Promise<ReviewProjection> {
		const wanted = new Map<string, { request: SiblingProjectionRequest; projection: string }>();
		for (const sibling of requests) {
			wanted.set(siblingKey(sibling.cardId, sibling.sub), {
				request: sibling,
				projection: projectionKey(mode, sibling.desiredRetention),
			});
		}
		const stored = await this.readStates([...wanted.keys()]);
		const dirty = new Map(
			[...wanted].filter(([key, value]) => stored.get(key)?.projection !== value.projection),
		);
		if (dirty.size > 0) await this.rebuildStates(dirty, mode);

		const current = dirty.size === 0 ? stored : await this.readStates([...wanted.keys()]);
		const states = new Map<string, FsrsCard>();
		const introducedToday = new Set<string>();
		const { start, end } = localDayBounds(now);
		for (const [key, state] of current) {
			if (state.state !== null) states.set(key, normalizeFsrsCard(state.state));
			if (state.firstReviewAt !== null) {
				const first = Date.parse(state.firstReviewAt);
				if (first >= start && first < end) introducedToday.add(key);
			}
		}
		return {
			states,
			introducedToday,
			reviewedToday: await this.reviewedBetween(start, end),
		};
	}

	async activeBuries(now: Date): Promise<BuryEvent[]> {
		const tx = cacheTransaction(this.db, EVENTS, 'readonly');
		const done = transactionDone(tx);
		const events = await readAll<StoredCardEvent>(
			tx.objectStore(EVENTS).index('byKind'),
			IDBKeyRange.only('b'),
		);
		await done;
		return events.filter(
			(event): event is BuryEvent & { undone: false } =>
				event.k === 'b' && !event.undone && Date.parse(event.x) > now.getTime(),
		);
	}

	async getHistory(
		cardId: string,
		sub: number,
		limit = 50,
		before: ReviewHistoryCursor | null = null,
	): Promise<ReviewHistoryPage> {
		const count = Math.max(1, Math.floor(limit));
		const lower: IDBValidKey = [cardId, sub, '', ''];
		const upper: IDBValidKey = before
			? [cardId, sub, before.t, before.i]
			: [cardId, sub, '\uffff', '\uffff'];
		const range = IDBKeyRange.bound(lower, upper, false, before !== null);
		const tx = cacheTransaction(this.db, EVENTS, 'readonly');
		const done = transactionDone(tx);
		const index = tx.objectStore(EVENTS).index('bySibling');
		const events: ReviewEvent[] = [];
		await iterateCursor(index.openCursor(range, 'prev'), (event: StoredCardEvent) => {
			if (event.k === 'r' && !event.undone) events.push(withoutUndone(event));
			return events.length < count + 1;
		});
		await done;
		const hasMore = events.length > count;
		if (hasMore) events.pop();
		const oldest = events[events.length - 1];
		return {
			events,
			next: hasMore && oldest ? { t: oldest.t, i: oldest.i } : null,
		};
	}

	private async storedFile(path: string): Promise<CachedReviewLogFile | undefined> {
		const tx = cacheTransaction(this.db, FILES, 'readonly');
		const done = transactionDone(tx);
		const file = await readOne<CachedReviewLogFile>(tx.objectStore(FILES), path);
		await done;
		return file;
	}

	private async updateFileMetadata(file: CachedReviewLogFile): Promise<void> {
		const tx = cacheTransaction(this.db, FILES, 'readwrite');
		const done = transactionDone(tx);
		tx.objectStore(FILES).put(file);
		await done;
	}

	private async ingestFile(file: CachedReviewLogFile, content: string): Promise<void> {
		const parsed = parseLog(content, file.path);
		const tx = cacheTransaction(this.db, [FILES, EVENTS, UNDOS, STATES], 'readwrite');
		const done = transactionDone(tx);
		const events = tx.objectStore(EVENTS);
		const undos = tx.objectStore(UNDOS);
		const states = tx.objectStore(STATES);
		for (const targetId of parsed.undoTargets) {
			undos.put({ targetId } satisfies StoredUndo);
		}
		const [existingEvents, eventUndos] = await Promise.all([
			Promise.all(parsed.events.map((event) => readOne<StoredCardEvent>(events, event.i))),
			Promise.all(parsed.events.map((event) => readOne<StoredUndo>(undos, event.i))),
		]);
		const dirtyKeys = new Set<string>();
		for (const [position, event] of parsed.events.entries()) {
			// Conflict copies reuse immutable event ids and therefore collapse here.
			if (existingEvents[position]) continue;
			events.put({ ...event, undone: eventUndos[position] !== undefined } satisfies StoredCardEvent);
			if (event.k === 'r') dirtyKeys.add(siblingKey(event.c, event.s));
		}
		const undoTargets = await Promise.all(
			parsed.undoTargets.map((targetId) => readOne<StoredCardEvent>(events, targetId)),
		);
		for (const target of undoTargets) {
			if (!target || target.undone) continue;
			target.undone = true;
			events.put(target);
			if (target.k === 'r') dirtyKeys.add(siblingKey(target.c, target.s));
		}
		for (const key of dirtyKeys) states.delete(key);
		tx.objectStore(FILES).put(file);
		await done;
	}

	private async readStates(keys: string[]): Promise<Map<string, StoredSiblingState>> {
		if (keys.length === 0) return new Map();
		const tx = cacheTransaction(this.db, STATES, 'readonly');
		const done = transactionDone(tx);
		const store = tx.objectStore(STATES);
		let values: (StoredSiblingState | undefined)[];
		if (keys.length > 64) {
			const wanted = new Set(keys);
			values = (await readAll<StoredSiblingState>(store)).filter((value) =>
				wanted.has(value.key),
			);
		} else {
			values = await Promise.all(
				keys.map((key) => readOne<StoredSiblingState>(store, key)),
			);
		}
		await done;
		return new Map(values.flatMap((value) => (value ? [[value.key, value] as const] : [])));
	}

	private async rebuildStates(
		wanted: Map<string, { request: SiblingProjectionRequest; projection: string }>,
		mode: RetentionReplayMode,
	): Promise<void> {
		const rebuilt = await this.queryStates(wanted, mode);
		const tx = cacheTransaction(this.db, STATES, 'readwrite');
		const done = transactionDone(tx);
		const states = tx.objectStore(STATES);
		for (const state of rebuilt) states.put(state);
		await done;
	}

	private async queryStates(
		wanted: Map<string, { request: SiblingProjectionRequest; projection: string }>,
		mode: RetentionReplayMode,
	): Promise<StoredSiblingState[]> {
		const tx = cacheTransaction(this.db, EVENTS, 'readonly');
		const done = transactionDone(tx);
		const index = tx.objectStore(EVENTS).index('bySibling');
		const output: StoredSiblingState[] = [];
		for (const [key, value] of wanted) {
			const { cardId, sub } = value.request;
			const events = await readAll<StoredCardEvent>(index, siblingRange(cardId, sub));
			output.push(foldSibling(key, value, activeReviews(events), mode));
		}
		await done;
		return output;
	}

	private async reviewedBetween(start: number, end: number): Promise<Set<string>> {
		const tx = cacheTransaction(this.db, EVENTS, 'readonly');
		const done = transactionDone(tx);
		const index = tx.objectStore(EVENTS).index('byTime');
		const range = IDBKeyRange.bound(
			[new Date(start).toISOString(), ''],
			[new Date(end).toISOString(), ''],
			false,
			true,
		);
		const reviewed = new Set<string>();
		await iterateCursor(index.openCursor(range), (event: StoredCardEvent) => {
			if (event.k === 'r' && !event.undone) reviewed.add(siblingKey(event.c, event.s));
			return true;
		});
		await done;
		return reviewed;
	}
}

function openDatabase(name: string): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const opening = indexedDB.open(name, CACHE_FORMAT_VERSION);
		opening.onupgradeneeded = () => {
			const db = opening.result;
			for (const store of Array.from(db.objectStoreNames)) db.deleteObjectStore(store);
			db.createObjectStore(FILES, { keyPath: 'path' });
			const events = db.createObjectStore(EVENTS, { keyPath: 'i' });
			events.createIndex('bySibling', ['c', 's', 't', 'i']);
			events.createIndex('byTime', ['t', 'i']);
			events.createIndex('byKind', 'k');
			db.createObjectStore(UNDOS, { keyPath: 'targetId' });
			db.createObjectStore(STATES, { keyPath: 'key' });
		};
		opening.onsuccess = () => resolve(opening.result);
		opening.onerror = () => reject(opening.error ?? new Error('Could not open the review cache'));
		opening.onblocked = () => reject(new Error('Review cache upgrade was blocked'));
	});
}

function deleteDatabase(name: string): Promise<void> {
	return new Promise((resolve, reject) => {
		const deletion = indexedDB.deleteDatabase(name);
		deletion.onsuccess = () => resolve();
		deletion.onerror = () => reject(deletion.error ?? new Error('Could not delete the review cache'));
		deletion.onblocked = () => reject(new Error('Review cache deletion was blocked'));
	});
}

function validateSchema(db: IDBDatabase): void {
	for (const name of [FILES, EVENTS, UNDOS, STATES]) {
		if (!db.objectStoreNames.contains(name)) throw new Error(`Review cache is missing ${name}`);
	}
	const tx = db.transaction([FILES, EVENTS, UNDOS, STATES], 'readonly');
	validateKeyPath(tx.objectStore(FILES).keyPath, 'path', FILES);
	validateKeyPath(tx.objectStore(EVENTS).keyPath, 'i', EVENTS);
	validateKeyPath(tx.objectStore(UNDOS).keyPath, 'targetId', UNDOS);
	validateKeyPath(tx.objectStore(STATES).keyPath, 'key', STATES);
	const events = tx.objectStore(EVENTS);
	const indexes = new Map<string, string | string[]>([
		['bySibling', ['c', 's', 't', 'i']],
		['byTime', ['t', 'i']],
		['byKind', 'k'],
	]);
	for (const [indexName, keyPath] of indexes) {
		if (!events.indexNames.contains(indexName)) {
			throw new Error(`Review cache is missing ${EVENTS}.${indexName}`);
		}
		validateKeyPath(events.index(indexName).keyPath, keyPath, `${EVENTS}.${indexName}`);
	}
}

function validateKeyPath(
	actual: string | string[] | null,
	expected: string | string[],
	name: string,
): void {
	if (JSON.stringify(actual) !== JSON.stringify(expected)) {
		throw new Error(`Review cache has an invalid key for ${name}`);
	}
}

function parseLog(content: string, path: string): { events: CardEvent[]; undoTargets: string[] } {
	const events = new Map<string, CardEvent>();
	const undoTargets = new Set<string>();
	for (const line of content.split('\n')) {
		if (line.trim() === '') continue;
		const event = parseLogEventLine(line);
		if (event === null) {
			console.warn(`Remember: skipping bad log line in ${path}: ${line}`);
			continue;
		}
		if (event.k === 'u') undoTargets.add(event.u);
		else if (!events.has(event.i)) events.set(event.i, event);
	}
	return { events: [...events.values()], undoTargets: [...undoTargets] };
}

function projectionKey(mode: RetentionReplayMode, retention: number): string {
	return mode === 'review' ? 'review' : `current:${retention}`;
}

function activeReviews(events: StoredCardEvent[]): ReviewEvent[] {
	return events.filter(
		(event): event is ReviewEvent & { undone: false } => event.k === 'r' && !event.undone,
	).map(withoutUndone);
}

function withoutUndone(event: ReviewEvent & { undone: boolean }): ReviewEvent {
	const { undone: _undone, ...review } = event;
	return review;
}

function foldSibling(
	key: string,
	value: { request: SiblingProjectionRequest; projection: string },
	events: ReviewEvent[],
	mode: RetentionReplayMode,
): StoredSiblingState {
	return {
		key,
		projection: value.projection,
		state:
			foldEventsByRetention(events, () => value.request.desiredRetention, mode).get(key) ?? null,
		firstReviewAt:
			events.length === 0
				? null
				: events.reduce((first, event) => (event.t < first ? event.t : first), events[0].t),
	};
}

function siblingRange(cardId: string, sub: number): IDBKeyRange {
	return IDBKeyRange.bound([cardId, sub, '', ''], [cardId, sub, '\uffff', '\uffff']);
}

function normalizeFsrsCard(card: FsrsCard): FsrsCard {
	return {
		...card,
		due: new Date(card.due),
		last_review: card.last_review ? new Date(card.last_review) : undefined,
	};
}

function localDayBounds(now: Date): { start: number; end: number } {
	const start = new Date(now);
	start.setHours(0, 0, 0, 0);
	const end = new Date(start);
	end.setDate(end.getDate() + 1);
	return { start: start.getTime(), end: end.getTime() };
}

async function hashBytes(bytes: Uint8Array): Promise<string> {
	const input = new ArrayBuffer(bytes.byteLength);
	new Uint8Array(input).set(bytes);
	const digest = await crypto.subtle.digest('SHA-256', input);
	return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function cacheTransaction(
	db: IDBDatabase,
	stores: string | string[],
	mode: IDBTransactionMode,
): IDBTransaction {
	try {
		return db.transaction(stores, mode);
	} catch (error) {
		throw new ReviewCacheError('Could not start a review cache transaction', error);
	}
}

function request<T>(value: IDBRequest<T>): Promise<T> {
	return new Promise((resolve, reject) => {
		value.onsuccess = () => resolve(value.result);
		value.onerror = () => reject(new ReviewCacheError('Review cache request failed', value.error));
	});
}

function readAll<T>(source: IDBObjectStore | IDBIndex, query?: IDBValidKey | IDBKeyRange): Promise<T[]> {
	return request(source.getAll(query) as IDBRequest<T[]>);
}

function readOne<T>(source: IDBObjectStore | IDBIndex, key: IDBValidKey | IDBKeyRange): Promise<T | undefined> {
	return request(source.get(key) as IDBRequest<T | undefined>);
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
	return new Promise((resolve, reject) => {
		transaction.oncomplete = () => resolve();
		transaction.onabort = () =>
			reject(new ReviewCacheError('Review cache transaction aborted', transaction.error));
		transaction.onerror = () =>
			reject(new ReviewCacheError('Review cache transaction failed', transaction.error));
	});
}

function iterateCursor<T>(
	requestValue: IDBRequest<IDBCursorWithValue | null>,
	visit: (value: T) => boolean,
): Promise<void> {
	return new Promise((resolve, reject) => {
		requestValue.onerror = () =>
			reject(new ReviewCacheError('Review cache cursor failed', requestValue.error));
		requestValue.onsuccess = () => {
			const cursor = requestValue.result;
			if (cursor === null || !visit(cursor.value as T)) {
				resolve();
				return;
			}
			cursor.continue();
		};
	});
}

export function reviewCacheName(vaultName: string, rootFolder: string): string {
	return `remember-review-cache:${vaultName}:${rootFolder}`;
}
