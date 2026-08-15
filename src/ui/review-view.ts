// One transient workspace view, desktop and mobile: deck list -> card front -> card back.

import {
	Component,
	ItemView,
	MarkdownRenderer,
	Notice,
	setIcon,
	setTooltip,
	TFile,
	type IconName,
	type WorkspaceLeaf,
} from 'obsidian';
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
	introducedTodaySiblingKeys,
	isDescendantDeck,
	returnsToCurrentSession,
	reviewedTodaySiblingKeys,
	selectCards,
	type DeckCounts,
	type NoteCard,
	type QueueItem,
} from '../core/queue';
import { STRINGS } from '../i18n';
import { effectiveNewCardsPerDay, type RememberSettings } from '../settings';
import { stampNote } from '../stamper';
import { REMEMBER_VIEW_DEFINITION } from './remember-view-definition';

interface DeckNode {
	path: string;
	name: string;
	children: DeckNode[];
}

interface UndoEntry {
	/** The item as presented — its state is the pre-rating state. */
	item: QueueItem;
	event: ReviewEvent;
	advancedProgress: boolean;
}

export class ReviewView extends ItemView {
	private fsrs: FSRS;
	private phase: 'decks' | 'question' | 'answer' = 'decks';
	private queue: QueueItem[] = [];
	private current: QueueItem | null = null;
	private undoStack: UndoEntry[] = [];
	private sessionTotal = 0;
	private sessionCompleted = 0;
	private sessionDeck: string | null = null;
	private progressEl: HTMLElement | null = null;
	private progressCurrentEl: HTMLElement | null = null;
	private renderer = new Component();
	private busy = false;
	/** ItemView uses `titleEl` internally. */
	private contentTitleEl: HTMLElement | null = null;
	private bodyEl: HTMLElement | null = null;

	constructor(
		leaf: WorkspaceLeaf,
		private settings: RememberSettings,
	) {
		super(leaf);
		this.navigation = false;
		this.fsrs = makeFsrs(settings.desiredRetention);
	}

	getViewType(): string {
		return REMEMBER_VIEW_DEFINITION.type;
	}

	getDisplayText(): string {
		return REMEMBER_VIEW_DEFINITION.displayText;
	}

	getIcon(): IconName {
		return REMEMBER_VIEW_DEFINITION.icon;
	}

	getState(): Record<string, unknown> {
		return {};
	}

	async onOpen(): Promise<void> {
		this.contentEl.addClass('remember-view');
		this.contentEl.empty();
		const canvas = this.contentEl.createDiv({ cls: 'remember-view-canvas' });
		const header = canvas.createDiv({ cls: 'remember-view-header' });
		this.contentTitleEl = header.createDiv({ cls: 'remember-view-title' });
		this.bodyEl = canvas.createDiv({ cls: 'remember-view-content' });
		this.renderer.load();
		await this.showDeckList();
	}

	onClose(): Promise<void> {
		this.renderer.unload();
		this.contentTitleEl = null;
		this.bodyEl = null;
		this.contentEl.empty();
		this.contentEl.removeClass('remember-session-active');
		this.contentEl.removeClass('remember-view');
		return Promise.resolve();
	}

	private get body(): HTMLElement {
		return this.bodyEl ?? this.contentEl;
	}

	// ---- deck list ----

	private async showDeckList(): Promise<void> {
		this.phase = 'decks';
		this.current = null;
		this.queue = [];
		this.undoStack = [];
		this.sessionTotal = 0;
		this.sessionCompleted = 0;
		this.sessionDeck = null;
		this.progressEl = null;
		this.progressCurrentEl = null;
		this.contentTitleEl?.setText(REMEMBER_VIEW_DEFINITION.displayText);
		this.contentEl.removeClass('remember-session-active');
		this.body.empty();

		const selection = selectCards(await this.scanCards());
		this.reportDuplicates(selection.dropped);
		const cards = selection.kept;
		if (cards.length === 0) {
			this.body.createEl('p', {
				cls: 'remember-empty',
				text: STRINGS.review.noCards(this.settings.deckProperty),
			});
			return;
		}
		const events = await readEvents(this.app);
		const states = foldEvents(this.fsrs, events);
		const now = new Date();
		const introducedToday = introducedTodaySiblingKeys(events, now);
		const reviewedToday = reviewedTodaySiblingKeys(events, now);
		const newCardsPerDay = effectiveNewCardsPerDay(this.settings);
		const tree = buildDeckTree(cards);
		const statsByDeck = new Map<string, DeckCounts>();
		const collectStats = (node: DeckNode) => {
			statsByDeck.set(
				node.path,
				countDeckStats(
					cards.filter((card) => isDescendantDeck(card.deck, node.path)),
					states,
					now,
					{
						introducedToday,
						reviewedToday,
						newCardsPerDay,
						burySiblings: this.settings.burySiblings,
					},
				),
			);
			for (const child of node.children) collectStats(child);
		};
		for (const node of tree) collectStats(node);
		const showWaiting = [...statsByDeck.values()].some((counts) => counts.waiting > 0);
		const showBuried = [...statsByDeck.values()].some((counts) => counts.buried > 0);

		const listEl = this.body.createDiv({ cls: 'remember-decks' });
		listEl.toggleClass('remember-has-waiting', showWaiting);
		listEl.toggleClass('remember-has-buried', showBuried);
		const header = listEl.createDiv({ cls: 'remember-deck-header' });
		header.createSpan({ cls: 'remember-deck-header-name', text: STRINGS.review.deckHeader });
		createCountHeader(header, STRINGS.review.counts.due);
		createCountHeader(header, STRINGS.review.counts.new);
		if (showWaiting) {
			createCountHeader(header, STRINGS.review.counts.waiting);
		}
		if (showBuried) {
			createCountHeader(header, STRINGS.review.counts.buried);
		}
		createCountHeader(header, STRINGS.review.counts.total);
		const renderNode = (node: DeckNode, depth: number) => {
			const counts = statsByDeck.get(node.path)!;
			const row = listEl.createEl('button', { cls: 'remember-deck-row' });
			row.style.setProperty('--remember-depth', String(depth));
			row.createSpan({ cls: 'remember-deck-name', text: node.name });
			const countsEl = row.createSpan({ cls: 'remember-deck-counts' });
			countsEl.createSpan({ cls: 'remember-count-due', text: String(counts.due) });
			countsEl.createSpan({ cls: 'remember-count-new', text: String(counts.new) });
			if (showWaiting) {
				countsEl.createSpan({ cls: 'remember-count-waiting', text: String(counts.waiting) });
			}
			if (showBuried) {
				countsEl.createSpan({ cls: 'remember-count-buried', text: String(counts.buried) });
			}
			countsEl.createSpan({ cls: 'remember-count-total', text: String(counts.total) });
			if (counts.due + counts.new === 0) row.disabled = true;
			else row.addEventListener('click', () => void this.startSession(node.path));
			for (const child of node.children) renderNode(child, depth + 1);
		};
		for (const node of tree) renderNode(node, 0);
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
			new Notice(STRINGS.notices.duplicateCardId(dup.path));
		}
	}

	private deckOf(file: TFile): string | null {
		const raw: unknown = this.app.metadataCache.getFileCache(file)?.frontmatter?.[this.settings.deckProperty];
		if (raw === null || raw === undefined) return null;
		if (typeof raw !== 'string' && typeof raw !== 'number' && typeof raw !== 'boolean') {
			new Notice(STRINGS.notices.invalidDeckProperty(file.path));
			return null;
		}
		const deck = String(raw).trim();
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
		const events = await readEvents(this.app);
		const states = foldEvents(this.fsrs, events);
		const now = new Date();
		const newCardsPerDay = effectiveNewCardsPerDay(this.settings);
		const introducedToday = introducedTodaySiblingKeys(events, now);
		const reviewedToday = reviewedTodaySiblingKeys(events, now);
		const counts = countDeckStats(
			selection.kept,
			states,
			now,
			{
				introducedToday,
				reviewedToday,
				newCardsPerDay,
				burySiblings: this.settings.burySiblings,
			},
		);
		this.queue = buildQueue(selection.kept, states, now, {
			maxNewCards: counts.new,
			reviewedToday,
			burySiblings: this.settings.burySiblings,
		});
		this.sessionTotal = this.queue.length;
		this.sessionCompleted = 0;
		this.undoStack = [];
		this.sessionDeck = deck;
		this.contentEl.addClass('remember-session-active');
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

	private renderSessionHeader(parent: HTMLElement): void {
		const header = parent.createDiv({ cls: 'remember-session-header' });
		header.createSpan({ cls: 'remember-session-title-name', text: this.sessionDeck ?? '' });
		this.progressEl = header.createSpan({ cls: 'remember-progress' });
		this.progressCurrentEl = this.progressEl.createSpan({ cls: 'remember-progress-current' });
		this.progressEl.createSpan({ cls: 'remember-progress-separator', text: STRINGS.review.progressSeparator });
		this.progressEl.createSpan({ cls: 'remember-progress-total', text: String(this.sessionTotal) });
		const back = header.createEl('button', { cls: 'clickable-icon remember-session-back' });
		setIcon(back, 'x');
		setTooltip(back, STRINGS.review.backToDecks);
		back.setAttribute('aria-label', STRINGS.review.backToDecks);
		back.addEventListener('click', () => void this.leaveSession());
		this.updateProgress();
	}

	private updateProgress(): void {
		if (!this.progressEl || !this.progressCurrentEl) return;
		const current = Math.min(this.sessionCompleted + 1, this.sessionTotal);
		this.progressCurrentEl.setText(String(current));
		this.progressEl.setAttribute('aria-label', STRINGS.review.progressAria(current, this.sessionTotal));
	}

	private async leaveSession(): Promise<void> {
		if (this.busy) return;
		this.busy = true;
		try {
			await this.showDeckList();
		} finally {
			this.busy = false;
		}
	}

	private showQuestion(): void {
		if (!this.current) return;
		this.phase = 'question';
		this.body.empty();
		const review = this.body.createDiv({ cls: 'remember-review' });
		this.renderSessionHeader(review);
		const card = review.createDiv({ cls: 'remember-card-scroll' });
		this.renderSide(card, this.current.front);
		const footer = review.createDiv({ cls: 'remember-footer' });
		const buttons = footer.createDiv({ cls: 'remember-buttons remember-question-buttons' });
		const show = buttons.createEl('button', { cls: 'remember-response remember-show-answer' });
		show.createSpan({ cls: 'remember-response-label', text: STRINGS.review.showAnswer });
		show.addEventListener('click', () => this.showAnswer());
		this.renderSessionActions(footer);
	}

	private showAnswer(): void {
		if (!this.current) return;
		this.phase = 'answer';
		this.body.empty();
		const review = this.body.createDiv({ cls: 'remember-review' });
		this.renderSessionHeader(review);
		const card = review.createDiv({ cls: 'remember-card-scroll' });
		this.renderSide(card, this.current.front);
		card.createEl('hr', { cls: 'remember-divider' });
		this.renderSide(card, this.current.back);

		const now = new Date();
		const previews = previewDue(this.fsrs, this.current.state, now);
		const footer = review.createDiv({ cls: 'remember-footer' });
		const buttons = footer.createDiv({ cls: 'remember-buttons remember-rating-buttons' });
		const ratings: [Grade, string, string][] = [
			[Rating.Again, STRINGS.review.ratings.again, 'again'],
			[Rating.Hard, STRINGS.review.ratings.hard, 'hard'],
			[Rating.Good, STRINGS.review.ratings.good, 'good'],
			[Rating.Easy, STRINGS.review.ratings.easy, 'easy'],
		];
		for (const [grade, label, tone] of ratings) {
			const due = previews[grade];
			const button = buttons.createEl('button', {
				cls: `remember-response remember-rate remember-rate-${tone}`,
			});
			const text = button.createSpan({ cls: 'remember-response-text' });
			text.createSpan({ cls: 'remember-response-label', text: label });
			const details = text.createSpan({ cls: 'remember-response-details' });
			details.createSpan({ cls: 'remember-interval', text: formatInterval(now, due) });
			if (returnsToCurrentSession(due, now)) {
				const returns = details.createSpan({ cls: 'remember-session-return' });
				setIcon(returns, 'repeat-2');
				setTooltip(returns, STRINGS.review.returnsThisSession);
				returns.setAttribute('aria-label', STRINGS.review.returnsThisSession);
			}
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
				new Notice(STRINGS.notices.couldNotSaveReview(error));
				return;
			}
			const next = applyRating(this.fsrs, item.state, when, grade);
			const reentersSession = returnsToCurrentSession(next.due, when);
			this.undoStack.push({ item, event, advancedProgress: !reentersSession });
			if (reentersSession) {
				this.enqueue({ ...item, state: next, showAt: next.due }); // re-enters at its due position
			} else {
				this.sessionCompleted++;
			}
			this.showNext();
		} finally {
			this.busy = false;
		}
	}

	private async undo(): Promise<void> {
		if (this.busy) return;
		const entry = this.undoStack[this.undoStack.length - 1];
		this.busy = true;
		try {
			try {
				await appendUndoEvent(this.app, entry.event.i);
			} catch (error) {
				console.warn('Remember: undo failed', error);
				new Notice(STRINGS.notices.couldNotSaveUndo(error));
				return;
			}
			this.undoStack.pop();
			if (entry.advancedProgress) this.sessionCompleted--;
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
		undo.setAttribute('aria-label', STRINGS.review.undoAria);
		undo.addEventListener('click', () => void this.undo());
	}

	/** Inserts keeping showAt order, after any equal positions. */
	private enqueue(item: QueueItem): void {
		const index = this.queue.findIndex((queued) => queued.showAt.getTime() > item.showAt.getTime());
		if (index === -1) this.queue.push(item);
		else this.queue.splice(index, 0, item);
	}

}

function createCountHeader(parent: HTMLElement, copy: { label: string; tooltip: string }): void {
	const header = parent.createSpan({ cls: 'remember-deck-header-count', text: copy.label });
	setTooltip(header, copy.tooltip);
	header.setAttribute('aria-label', STRINGS.review.countHeaderAria(copy.label, copy.tooltip));
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
