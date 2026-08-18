import type { App, TFile } from 'obsidian';
import type { Card as FsrsCard } from 'ts-fsrs';
import { readCardEvents } from '../log';
import {
	ID_PROPERTY,
	parseCardNote,
	readCardId,
	readCardKind,
	TYPE_PROPERTY,
	type ParsedCardNote,
} from '../core/card-note';
import type { BuryEvent, ReviewEvent } from '../core/events';
import { newCardId } from '../core/id';
import { selectCards, type NoteCard } from '../core/queue';
import { foldEvents, makeFsrs } from '../core/scheduler';
import type { RememberSettings } from '../settings';
import { parentPath } from '../vault-folders';

export interface RememberSnapshotIssues {
	duplicates: NoteCard[];
}

export interface RememberSnapshot {
	loadedAt: Date;
	cards: NoteCard[];
	events: ReviewEvent[];
	buries: BuryEvent[];
	states: Map<string, FsrsCard>;
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
	constructor(
		private app: App,
		private settings: RememberSettings,
	) {}

	async load(): Promise<RememberSnapshot> {
		const [cards, cardEvents] = await Promise.all([
			this.scanCards(),
			readCardEvents(this.app, this.settings.rootFolder),
		]);
		const events = cardEvents.filter((event): event is ReviewEvent => event.k === 'r');
		const buries = cardEvents.filter((event): event is BuryEvent => event.k === 'b');
		const selection = selectCards(cards);
		const fsrs = makeFsrs(this.settings.desiredRetention);
		return {
			loadedAt: new Date(),
			cards: selection.kept,
			events,
			buries,
			states: foldEvents(
				fsrs,
				events,
				this.settings.rescheduleOnRetentionChange ? 'current' : 'review',
			),
			issues: {
				duplicates: selection.dropped,
			},
		};
	}

	/**
	 * Every complete card note in the root folder. Notes that are not recognizable as
	 * cards are left untouched; incomplete cards (no siblings yet) are adopted but
	 * produce nothing to review until the user finishes them.
	 */
	private async scanCards(): Promise<NoteCard[]> {
		const root = this.settings.rootFolder;
		const cards: NoteCard[] = [];
		for (const file of this.app.vault.getMarkdownFiles()) {
			if (!isUnderFolder(file.path, root)) continue;
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
