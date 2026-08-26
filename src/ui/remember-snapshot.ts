import type { App, TFile } from 'obsidian';
import type { Card as FsrsCard } from 'ts-fsrs';
import {
	getDeviceId,
	listReviewLogFiles,
	readReviewLogFile,
	type ReviewLogFile,
} from '../log';
import {
	ID_PROPERTY,
	parseCardNote,
	readCardId,
	readCardKind,
	TYPE_PROPERTY,
	type ParsedCardNote,
} from '../core/card-note';
import type { BuryEvent } from '../core/events';
import { newCardId } from '../core/id';
import { selectCards, type NoteCard } from '../core/queue';
import {
	DeckSettingsIndex,
	isDeckSettingsPath,
	parseDeckSettings,
	type DeckSettingsOverride,
} from '../deck-settings';
import type { RememberSettings } from '../settings';
import { parentPath } from '../vault-folders';
import {
	ReviewCache,
	ReviewCacheError,
	reviewCacheName,
	type ReviewHistoryReader,
	type SiblingProjectionRequest,
} from '../cache/review-cache';

export interface RememberSnapshotIssues {
	duplicates: NoteCard[];
}

export interface RememberSnapshot {
	loadedAt: Date;
	cards: NoteCard[];
	buries: BuryEvent[];
	states: Map<string, FsrsCard>;
	introducedToday: Set<string>;
	reviewedToday: Set<string>;
	reviewHistory: ReviewHistoryReader;
	deckSettings: DeckSettingsIndex;
	issues: RememberSnapshotIssues;
}


/** True when the path is inside the folder (never the folder itself). */
export function isUnderFolder(path: string, folder: string): boolean {
	return folder !== '' && path.startsWith(folder + '/');
}

/** The deck of a card note: its folder path relative to the root folder; '' is the root deck. */
export function deckOfPath(path: string, rootFolder: string): string {
	const parent = parentPath(path);
	return parent === rootFolder ? '' : parent.slice(rootFolder.length + 1);
}

/** Builds one consistent in-memory source for every non-session Remember page. */
export class RememberSnapshotRepository {
	private cachePromise: Promise<ReviewCache> | null = null;

	constructor(
		private app: App,
		private settings: RememberSettings,
	) {}

	async load(): Promise<RememberSnapshot> {
		try {
			return await this.loadFromCache();
		} catch (error) {
			if (!(error instanceof ReviewCacheError)) throw error;
			console.warn('Remember: rebuilding the local review cache', error);
			await this.recreateCache();
			return this.loadFromCache();
		}
	}

	private async loadFromCache(): Promise<RememberSnapshot> {
		const files = this.app.vault.getMarkdownFiles();
		const deckSettings = this.scanDeckSettings(files);
		const [cards, cache] = await Promise.all([
			this.scanCards(files),
			this.reconciledCache(),
		]);
		const selection = selectCards(cards);
		const projectionRequests: SiblingProjectionRequest[] = selection.kept.flatMap((card) =>
			card.id === null
				? []
				: card.siblings.map((sibling) => ({
						cardId: card.id!,
						sub: sibling.sub,
						desiredRetention: deckSettings.resolve(card.deck).values.desiredRetention,
					})),
		);
		const loadedAt = new Date();
		const [projection, buries] = await Promise.all([
			cache.projection(
				projectionRequests,
				this.settings.rescheduleOnRetentionChange ? 'current' : 'review',
				loadedAt,
			),
			cache.activeBuries(loadedAt),
		]);
		return {
			loadedAt,
			cards: selection.kept,
			buries,
			states: projection.states,
			introducedToday: projection.introducedToday,
			reviewedToday: projection.reviewedToday,
			reviewHistory: cache,
			deckSettings,
			issues: {
				duplicates: selection.dropped,
			},
		};
	}

	close(): void {
		void this.cachePromise?.then(
			(cache) => cache.close(),
			() => undefined,
		);
		this.cachePromise = null;
	}

	private async reconciledCache(): Promise<ReviewCache> {
		const cache = await this.openCache();
		const [stored, current] = await Promise.all([
			cache.storedFiles(),
			listReviewLogFiles(this.app, this.settings.rootFolder),
		]);
		const currentByPath = new Map(current.map((file) => [file.path, file]));
		for (const path of stored.keys()) {
			if (!currentByPath.has(path)) return this.rebuildFromLogs(current);
		}
		for (const file of current) {
			const previous = stored.get(file.path);
			if (previous?.size === file.size && previous.mtime === file.mtime) continue;
			const result = await cache.replaceFile(
				file,
				await readReviewLogFile(this.app, file.path),
			);
			if (result === 'rebuild') return this.rebuildFromLogs(current);
		}
		return cache;
	}

	private async rebuildFromLogs(files: ReviewLogFile[]): Promise<ReviewCache> {
		const cache = await this.recreateCache();
		for (const file of files) {
			await cache.replaceFile(file, await readReviewLogFile(this.app, file.path));
		}
		return cache;
	}

	private openCache(): Promise<ReviewCache> {
		this.cachePromise ??= ReviewCache.open(this.cacheName());
		return this.cachePromise;
	}

	private async recreateCache(): Promise<ReviewCache> {
		const previous = this.cachePromise;
		this.cachePromise = null;
		await previous?.then(
			(cache) => cache.close(),
			() => undefined,
		);
		const rebuilding = ReviewCache.recreate(this.cacheName());
		this.cachePromise = rebuilding;
		try {
			return await rebuilding;
		} catch (error) {
			if (this.cachePromise === rebuilding) this.cachePromise = null;
			throw error;
		}
	}

	private cacheName(): string {
		return reviewCacheName(
			`${getDeviceId(this.app)}:${this.app.vault.getName()}`,
			this.settings.rootFolder,
		);
	}

	/**
	 * Every complete card note in the root folder. Notes that are not recognizable as
	 * cards are left untouched; incomplete cards (no siblings yet) are adopted but
	 * produce nothing to review until the user finishes them.
	 */
	private async scanCards(files: TFile[]): Promise<NoteCard[]> {
		const root = this.settings.rootFolder;
		const cards: NoteCard[] = [];
		for (const file of files) {
			if (!isUnderFolder(file.path, root)) continue;
			if (isDeckSettingsPath(file.path)) continue;
			let parsed: ParsedCardNote;
			try {
				parsed = await this.parseFile(file);
			} catch (error) {
				console.warn(`Remember: cannot read ${file.path}`, error);
				continue;
			}
			if (parsed.kind === null) continue;
			parsed = await this.adopt(file, parsed);
			if (parsed.kind === null || parsed.siblings.length === 0) continue;
			cards.push({
				id: parsed.id,
				kind: parsed.kind,
				suspended: parsed.suspended,
				reverse: parsed.reverse,
				siblings: parsed.siblings,
				line: parsed.line,
				path: file.path,
				deck: deckOfPath(file.path, root),
			});
		}
		return cards;
	}

	private scanDeckSettings(files: TFile[]): DeckSettingsIndex {
		const root = this.settings.rootFolder;
		const overrides = new Map<string, DeckSettingsOverride>();
		const paths = new Map<string, string>();
		for (const file of files) {
			if (!isUnderFolder(file.path, root) || !isDeckSettingsPath(file.path)) continue;
			const deck = deckOfPath(file.path, root);
			overrides.set(
				deck,
				parseDeckSettings(this.app.metadataCache.getFileCache(file)?.frontmatter),
			);
			paths.set(deck, file.path);
		}
		return new DeckSettingsIndex(this.settings, overrides, paths);
	}

	private async parseFile(file: TFile, frontmatter?: Record<string, unknown>): Promise<ParsedCardNote> {
		const text = await this.app.vault.cachedRead(file);
		return parseCardNote(text, frontmatter ?? this.app.metadataCache.getFileCache(file)?.frontmatter);
	}

	/**
	 * Writes missing identity frontmatter (id, type) into a recognizable card note,
	 * then re-parses so line numbers match the written note. The metadata cache can
	 * lag behind the file, so the write only fills values the file itself is missing —
	 * a real id is never overwritten. Adoption failures are logged and leave the card
	 * unstamped; the queue keeps working with provisional keys.
	 */
	private async adopt(file: TFile, parsed: ParsedCardNote): Promise<ParsedCardNote> {
		if (parsed.id !== null && parsed.declaredKind !== null) return parsed;
		let id = parsed.id ?? newCardId();
		let kind = parsed.kind;
		if (kind === null) return parsed;
		const frontmatter = { ...this.app.metadataCache.getFileCache(file)?.frontmatter };
		try {
			await this.app.fileManager.processFrontMatter(file, (stored: Record<string, unknown>) => {
				const storedId = readCardId(stored);
				if (storedId === null) stored[ID_PROPERTY] = id;
				else id = storedId;
				const storedKind = readCardKind(stored);
				if (storedKind === null) stored[TYPE_PROPERTY] = kind;
				else kind = storedKind;
			});
		} catch (error) {
			console.warn(`Remember: could not stamp ${file.path}; its card stays unstamped`, error);
			return parsed;
		}
		return this.parseFile(file, { ...frontmatter, [ID_PROPERTY]: id, [TYPE_PROPERTY]: kind });
	}
}
