import { TFile, type App } from 'obsidian';
import type { Card as FsrsCard, FSRS } from 'ts-fsrs';
import { readCardEvents } from '../log';
import type { BuryEvent, ReviewEvent } from '../core/events';
import { parseCards } from '../core/parser';
import { selectCards, type NoteCard } from '../core/queue';
import { foldEvents } from '../core/scheduler';
import type { RememberSettings } from '../settings';
import { stampNote } from '../stamper';

export interface RememberSnapshotIssues {
	duplicates: NoteCard[];
	invalidDeckPaths: string[];
}

export interface RememberSnapshot {
	loadedAt: Date;
	cards: NoteCard[];
	events: ReviewEvent[];
	buries: BuryEvent[];
	states: Map<string, FsrsCard>;
	issues: RememberSnapshotIssues;
}

export interface CardScan {
	cards: NoteCard[];
	invalidDeckPaths: string[];
}

type DeckResult = { kind: 'none' } | { kind: 'invalid' } | { kind: 'deck'; deck: string };

/** Builds one consistent in-memory source for every non-session Remember page. */
export class RememberSnapshotRepository {
	constructor(
		private app: App,
		private settings: RememberSettings,
		private fsrs: FSRS,
	) {}

	async load(): Promise<RememberSnapshot> {
		const [initialScan, cardEvents] = await Promise.all([this.scanCards(), readCardEvents(this.app)]);
		const scan = await this.initializeCardIds(initialScan);
		const events = cardEvents.filter((event): event is ReviewEvent => event.k === 'r');
		const buries = cardEvents.filter((event): event is BuryEvent => event.k === 'b');
		const selection = selectCards(scan.cards);
		return {
			loadedAt: new Date(),
			cards: selection.kept,
			events,
			buries,
			states: foldEvents(this.fsrs, events),
			issues: {
				duplicates: selection.dropped,
				invalidDeckPaths: scan.invalidDeckPaths,
			},
		};
	}

	/** Every card in every note carrying the deck property, including duplicate ids. */
	async scanCards(): Promise<CardScan> {
		const cards: NoteCard[] = [];
		const invalidDeckPaths: string[] = [];
		for (const file of this.app.vault.getMarkdownFiles()) {
			const result = this.deckOf(file);
			if (result.kind === 'invalid') {
				invalidDeckPaths.push(file.path);
				continue;
			}
			if (result.kind === 'none') continue;
			try {
				const text = await this.app.vault.cachedRead(file);
				for (const card of parseCards(text)) {
					cards.push({ ...card, path: file.path, deck: result.deck });
				}
			} catch (error) {
				console.warn(`Remember: cannot read ${file.path}`, error);
			}
		}
		return { cards, invalidDeckPaths };
	}

	/** Stamps every unstamped card found in a deck note and returns exactly what was written. */
	private async initializeCardIds(scan: CardScan): Promise<CardScan> {
		const byPath = new Map<string, NoteCard[]>();
		for (const card of scan.cards) {
			const fileCards = byPath.get(card.path);
			if (fileCards) fileCards.push(card);
			else byPath.set(card.path, [card]);
		}
		for (const [path, fileCards] of byPath) {
			if (fileCards.every((card) => card.id !== null)) continue;
			const file = this.app.vault.getAbstractFileByPath(path);
			if (!(file instanceof TFile)) {
				byPath.delete(path);
				continue;
			}
			try {
				const stamped = await stampNote(this.app, file);
				byPath.set(
					path,
					parseCards(stamped).map((card) => ({ ...card, path, deck: fileCards[0].deck })),
				);
			} catch (error) {
				console.warn(`Remember: could not stamp ${path}; its cards remain unstamped`, error);
			}
		}
		return { cards: [...byPath.values()].flat(), invalidDeckPaths: scan.invalidDeckPaths };
	}

	private deckOf(file: TFile): DeckResult {
		const raw: unknown = this.app.metadataCache.getFileCache(file)?.frontmatter?.[
			this.settings.deckProperty
		];
		if (raw === null || raw === undefined) return { kind: 'none' };
		if (typeof raw !== 'string' && typeof raw !== 'number' && typeof raw !== 'boolean') {
			return { kind: 'invalid' };
		}
		const deck = String(raw).trim();
		return deck === '' ? { kind: 'none' } : { kind: 'deck', deck };
	}
}
