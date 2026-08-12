// One modal, desktop and mobile: deck list -> card front -> card back.

import { Component, MarkdownRenderer, Modal, Notice, setIcon, TFile, type App } from 'obsidian';
import { Rating, type FSRS, type Grade } from 'ts-fsrs';
import { appendEvent, appendUndoEvent, readEvents } from '../log';
import type { ReviewEvent } from '../core/events';
import { randomId } from '../core/id';
import { parseCards } from '../core/parser';
import {
	applyRating,
	foldEvents,
	formatInterval,
	makeFsrs,
	previewDue,
} from '../core/scheduler';
import {
	buildQueue,
	countDeckStats,
	isDescendantDeck,
	LEARN_AHEAD_LIMIT_MS,
	selectCards,
	type NoteCard,
	type QueueItem,
} from '../core/queue';
import type { RememberSettings } from '../settings';
import { stampNote } from '../stamper';

interface DeckNode {
	path: string;
	name: string;
	children: DeckNode[];
}

interface UndoEntry {
	/** The item as presented — its state is the pre-rating state. */
	item: QueueItem;
	event: ReviewEvent;
}

export class ReviewModal extends Modal {
	private fsrs: FSRS;
	private phase: 'decks' | 'question' | 'answer' = 'decks';
	private queue: QueueItem[] = [];
	private current: QueueItem | null = null;
	private undoStack: UndoEntry[] = [];
	private renderer = new Component();
	private busy = false;

	constructor(
		app: App,
		private settings: RememberSettings,
	) {
		super(app);
		this.fsrs = makeFsrs(settings.desiredRetention);
	}

	onOpen(): void {
		this.modalEl.addClass('remember-modal');
		this.renderer.load();
		void this.showDeckList();
	}

	onClose(): void {
		this.renderer.unload();
		this.contentEl.empty();
	}

	// ---- deck list ----

	private async showDeckList(): Promise<void> {
		this.phase = 'decks';
		this.current = null;
		this.queue = [];
		this.setTitle('Remember');
		this.contentEl.empty();

		const selection = selectCards(await this.scanCards());
		this.reportDuplicates(selection.dropped);
		const cards = selection.kept;
		if (cards.length === 0) {
			this.contentEl.createEl('p', {
				cls: 'remember-empty',
				text: `No cards found. Give a note a "${this.settings.deckProperty}" property and write "Question::Answer" lines.`,
			});
			return;
		}
		const states = foldEvents(this.fsrs, await readEvents(this.app));
		const now = new Date();

		const listEl = this.contentEl.createDiv({ cls: 'remember-decks' });
		const header = listEl.createDiv({ cls: 'remember-deck-header' });
		header.createSpan({ cls: 'remember-deck-header-name', text: 'Deck' });
		header.createSpan({ cls: 'remember-deck-header-count', text: 'Due' });
		header.createSpan({ cls: 'remember-deck-header-count', text: 'New' });
		header.createSpan({ cls: 'remember-deck-header-count', text: 'Total' });
		const renderNode = (node: DeckNode, depth: number) => {
			const counts = countDeckStats(
				cards.filter((card) => isDescendantDeck(card.deck, node.path)),
				states,
				now,
			);
			const row = listEl.createEl('button', { cls: 'remember-deck-row' });
			row.style.setProperty('--remember-depth', String(depth));
			row.createSpan({ cls: 'remember-deck-name', text: node.name });
			const countsEl = row.createSpan({ cls: 'remember-deck-counts' });
			countsEl.createSpan({ cls: 'remember-count-due', text: String(counts.due) });
			countsEl.createSpan({ cls: 'remember-count-new', text: String(counts.new) });
			countsEl.createSpan({ cls: 'remember-count-total', text: String(counts.total) });
			if (counts.due + counts.new === 0) row.disabled = true;
			else row.addEventListener('click', () => void this.startSession(node.path));
			for (const child of node.children) renderNode(child, depth + 1);
		};
		for (const node of buildDeckTree(cards)) renderNode(node, 0);
	}

	/** Every card in every note carrying the deck property, including duplicate ids. */
	private async scanCards(): Promise<NoteCard[]> {
		const all: NoteCard[] = [];
		for (const file of this.app.vault.getMarkdownFiles()) {
			const noteDeck = this.deckOf(file);
			if (noteDeck === null) continue;
			try {
				const text = await this.app.vault.cachedRead(file);
				for (const card of parseCards(text)) all.push({ ...card, path: file.path, deck: noteDeck });
			} catch (error) {
				console.warn(`Remember: cannot read ${file.path}`, error);
			}
		}
		return all;
	}

	private reportDuplicates(duplicates: NoteCard[]): void {
		for (const dup of duplicates) {
			new Notice(`Remember: duplicate card id in ${dup.path} — delete one of the copied %%rem%% tokens.`);
		}
	}

	private deckOf(file: TFile): string | null {
		const raw: unknown = this.app.metadataCache.getFileCache(file)?.frontmatter?.[this.settings.deckProperty];
		let value = raw;
		if (Array.isArray(raw)) {
			value = raw[0];
			if (raw.length > 1) {
				new Notice(`Remember: ${file.path} lists several decks; using the first and ignoring the rest.`);
			}
		}
		if (value === null || value === undefined) return null;
		if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
			new Notice(`Remember: ${file.path} has an invalid deck property; expected text or a number.`);
			return null;
		}
		const deck = String(value).trim();
		return deck === '' ? null : deck;
	}

	// ---- session ----

	private async startSession(deck: string): Promise<void> {
		const allCards = await this.scanCards();
		const parsed = selectCards(allCards, deck).kept;
		const allByPath = groupByPath(allCards);

		// Stamp every unstamped card entering the session — one atomic vault.process per note.
		const byPath = groupByPath(parsed);
		for (const [path, fileCards] of byPath) {
			if (fileCards.every((card) => card.id !== null)) continue;
			const file = this.app.vault.getAbstractFileByPath(path);
			if (!(file instanceof TFile)) {
				allByPath.delete(path);
				continue;
			}
			try {
				const stamped = await stampNote(this.app, file);
				// Replace the note's raw snapshot with exactly what was written, then deduplicate globally again below.
				allByPath.set(
					path,
					parseCards(stamped).map((card) => ({ ...card, path, deck: fileCards[0].deck })),
				);
			} catch (error) {
				console.warn(`Remember: could not stamp ${path}; its unstamped cards sit this session out`, error);
			}
		}

		const selection = selectCards([...allByPath.values()].flat(), deck);
		this.reportDuplicates(selection.dropped);
		const states = foldEvents(this.fsrs, await readEvents(this.app));
		this.queue = buildQueue(selection.kept, states, new Date());
		this.undoStack = [];
		this.setTitle(deck);
		this.showNext();
	}

	private showNext(): void {
		// The queue is ordered by due time; the earliest pending card shows early instead of waiting.
		this.current = this.queue.shift() ?? null;
		if (this.current === null) {
			void this.showDeckList(); // the session ends when the queue is empty
			return;
		}
		this.showQuestion();
	}

	private showQuestion(): void {
		if (!this.current) return;
		this.phase = 'question';
		this.contentEl.empty();
		const review = this.contentEl.createDiv({ cls: 'remember-review' });
		const card = review.createDiv({ cls: 'remember-card-scroll' });
		this.renderSide(card, this.current.front);
		const footer = review.createDiv({ cls: 'remember-footer' });
		const buttons = footer.createDiv({ cls: 'remember-buttons remember-question-buttons' });
		const show = buttons.createEl('button', { cls: 'remember-response remember-show-answer' });
		show.createSpan({ cls: 'remember-response-label', text: 'Show answer' });
		show.addEventListener('click', () => this.showAnswer());
		this.renderSessionActions(footer);
	}

	private showAnswer(): void {
		if (!this.current) return;
		this.phase = 'answer';
		this.contentEl.empty();
		const review = this.contentEl.createDiv({ cls: 'remember-review' });
		const card = review.createDiv({ cls: 'remember-card-scroll' });
		this.renderSide(card, this.current.front);
		card.createEl('hr', { cls: 'remember-divider' });
		this.renderSide(card, this.current.back);

		const now = new Date();
		const previews = previewDue(this.fsrs, this.current.state, now);
		const footer = review.createDiv({ cls: 'remember-footer' });
		const buttons = footer.createDiv({ cls: 'remember-buttons remember-rating-buttons' });
		const ratings: [Grade, string, string][] = [
			[Rating.Again, 'Again', 'again'],
			[Rating.Hard, 'Hard', 'hard'],
			[Rating.Good, 'Good', 'good'],
			[Rating.Easy, 'Easy', 'easy'],
		];
		for (const [grade, label, tone] of ratings) {
			const button = buttons.createEl('button', {
				cls: `remember-response remember-rate remember-rate-${tone}`,
			});
			const text = button.createSpan({ cls: 'remember-response-text' });
			text.createSpan({ cls: 'remember-response-label', text: label });
			text.createSpan({ cls: 'remember-interval', text: formatInterval(now, previews[grade]) });
			button.addEventListener('click', () => void this.rate(grade));
		}
	}

	private renderSide(parent: HTMLElement, markdown: string): void {
		const el = parent.createDiv({ cls: 'remember-card-side markdown-rendered' });
		void MarkdownRenderer.render(this.app, markdown, el, this.current?.path ?? '', this.renderer);
	}

	// ---- actions ----

	private async rate(grade: Grade): Promise<void> {
		const item = this.current;
		if (!item || this.phase !== 'answer' || this.busy) return;
		this.busy = true;
		try {
			const when = new Date();
			const event: ReviewEvent = {
				v: 1,
				k: 'r',
				i: randomId(),
				t: when.toISOString(),
				c: item.cardId,
				s: item.sub,
				r: grade,
				dr: this.fsrs.parameters.request_retention,
			};
			try {
				await appendEvent(this.app, event);
			} catch (error) {
				// A review is never silently lost: no advance, the session pauses on this card.
				new Notice(`Remember: could not save the review — ${String(error)}`);
				return;
			}
			this.undoStack.push({ item, event });
			const next = applyRating(this.fsrs, item.state, when, grade);
			if (next.due.getTime() - when.getTime() <= LEARN_AHEAD_LIMIT_MS) {
				this.enqueue({ ...item, state: next, showAt: next.due }); // re-enters at its due position
			}
			this.showNext();
		} finally {
			this.busy = false;
		}
	}

	private async undo(): Promise<void> {
		if (this.busy) return;
		const entry = this.undoStack[this.undoStack.length - 1];
		if (!entry) {
			new Notice('Remember: nothing to undo in this session.');
			return;
		}
		this.busy = true;
		try {
			try {
				await appendUndoEvent(this.app, entry.event.i);
			} catch (error) {
				console.warn('Remember: undo failed', error);
				new Notice(`Remember: could not save the undo — ${String(error)}`);
				return;
			}
			this.undoStack.pop();
			const shown = this.current;
			this.current = entry.item;
			if (shown && !sameSibling(shown, entry.item)) this.enqueue(shown);
			this.queue = this.queue.filter((queued) => !sameSibling(queued, entry.item)); // drop the re-entered copy
			this.showQuestion(); // the undone sibling is re-presented immediately
		} finally {
			this.busy = false;
		}
	}

	private renderSessionActions(parent: HTMLElement): void {
		if (this.undoStack.length === 0) return;
		const actions = parent.createDiv({ cls: 'remember-actions' });
		const undo = actions.createEl('button', { cls: 'clickable-icon remember-undo' });
		setIcon(undo, 'undo-2');
		undo.setAttribute('aria-label', 'Undo last review');
		undo.addEventListener('click', () => void this.undo());
	}

	/** Inserts keeping showAt order, after any equal positions. */
	private enqueue(item: QueueItem): void {
		const index = this.queue.findIndex((queued) => queued.showAt.getTime() > item.showAt.getTime());
		if (index === -1) this.queue.push(item);
		else this.queue.splice(index, 0, item);
	}

}

function sameSibling(a: QueueItem, b: QueueItem): boolean {
	return a.cardId === b.cardId && a.sub === b.sub;
}

function groupByPath(cards: NoteCard[]): Map<string, NoteCard[]> {
	const byPath = new Map<string, NoteCard[]>();
	for (const card of cards) {
		const fileCards = byPath.get(card.path);
		if (fileCards) fileCards.push(card);
		else byPath.set(card.path, [card]);
	}
	return byPath;
}

function buildDeckTree(cards: NoteCard[]): DeckNode[] {
	const roots: DeckNode[] = [];
	const byPath = new Map<string, DeckNode>();
	for (const deck of [...new Set(cards.map((card) => card.deck))].sort()) {
		let path = '';
		let siblings = roots;
		for (const part of deck.split('/')) {
			path = path === '' ? part : `${path}/${part}`;
			let node = byPath.get(path);
			if (!node) {
				node = { path, name: part, children: [] };
				byPath.set(path, node);
				siblings.push(node);
			}
			siblings = node.children;
		}
	}
	return roots;
}
