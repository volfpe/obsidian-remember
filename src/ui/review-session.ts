import {
	Component,
	MarkdownRenderer,
	Notice,
	setIcon,
	setTooltip,
	TFile,
	type App,
} from 'obsidian';
import { Rating, type FSRS, type Grade } from 'ts-fsrs';
import { appendEvent, appendUndoEvent, readEvents } from '../log';
import type { ReviewEvent } from '../core/events';
import { randomId } from '../core/id';
import { parseCards } from '../core/parser';
import {
	buildQueue,
	countDeckStats,
	introducedTodaySiblingKeys,
	returnsToCurrentSession,
	reviewedTodaySiblingKeys,
	selectCards,
	type NoteCard,
	type QueueItem,
} from '../core/queue';
import { applyRating, foldEvents, formatInterval, previewDue } from '../core/scheduler';
import { STRINGS } from '../i18n';
import { effectiveNewCardsPerDay, type RememberSettings } from '../settings';
import { stampNote } from '../stamper';
import type { RememberSnapshotRepository } from './remember-snapshot';

interface UndoEntry {
	/** The item as presented — its state is the pre-rating state. */
	item: QueueItem;
	event: ReviewEvent;
	advancedProgress: boolean;
}

export class ReviewSession extends Component {
	private phase: 'idle' | 'question' | 'answer' = 'idle';
	private container: HTMLElement | null = null;
	private queue: QueueItem[] = [];
	private current: QueueItem | null = null;
	private undoStack: UndoEntry[] = [];
	private sessionTotal = 0;
	private sessionCompleted = 0;
	private sessionDeck: string | null = null;
	private progressEl: HTMLElement | null = null;
	private progressCurrentEl: HTMLElement | null = null;
	private busy = false;

	constructor(
		private app: App,
		private settings: RememberSettings,
		private fsrs: FSRS,
		private snapshotRepository: RememberSnapshotRepository,
		private onFinish: () => Promise<void>,
	) {
		super();
	}

	get active(): boolean {
		return this.phase !== 'idle';
	}

	override onunload(): void {
		this.reset();
	}

	async start(parent: HTMLElement, deck: string): Promise<void> {
		if (this.busy) return;
		this.busy = true;
		this.container = parent;
		try {
			const allCards = (await this.snapshotRepository.scanCards()).cards;
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
					allByPath.set(
						path,
						parseCards(stamped).map((card) => ({ ...card, path, deck: fileCards[0].deck })),
					);
				} catch (error) {
					console.warn(
						`Remember: could not stamp ${path}; its unstamped cards sit this session out`,
						error,
					);
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
			const counts = countDeckStats(selection.kept, states, now, {
				introducedToday,
				reviewedToday,
				newCardsPerDay,
				burySiblings: this.settings.burySiblings,
			});
			this.queue = buildQueue(selection.kept, states, now, {
				maxNewCards: counts.new,
				reviewedToday,
				burySiblings: this.settings.burySiblings,
			});
			this.sessionTotal = this.queue.length;
			this.sessionCompleted = 0;
			this.undoStack = [];
			this.sessionDeck = deck;
			this.showNext();
		} finally {
			this.busy = false;
		}
	}

	async leave(): Promise<void> {
		if (this.busy) return;
		this.busy = true;
		try {
			await this.finish();
		} finally {
			this.busy = false;
		}
	}

	private showNext(): void {
		this.current = this.queue.shift() ?? null;
		if (this.current === null) {
			void this.finish();
			return;
		}
		this.showQuestion();
	}

	private renderSessionHeader(parent: HTMLElement): void {
		const header = parent.createDiv({ cls: 'remember-session-header' });
		header.createSpan({ cls: 'remember-session-title-name', text: this.sessionDeck ?? '' });
		this.progressEl = header.createSpan({ cls: 'remember-progress' });
		this.progressCurrentEl = this.progressEl.createSpan({ cls: 'remember-progress-current' });
		this.progressEl.createSpan({
			cls: 'remember-progress-separator',
			text: STRINGS.review.progressSeparator,
		});
		this.progressEl.createSpan({ cls: 'remember-progress-total', text: String(this.sessionTotal) });
		const back = header.createEl('button', { cls: 'clickable-icon remember-session-back' });
		setIcon(back, 'x');
		setTooltip(back, STRINGS.review.backToDecks);
		back.setAttribute('aria-label', STRINGS.review.backToDecks);
		back.addEventListener('click', () => void this.leave());
		this.updateProgress();
	}

	private updateProgress(): void {
		if (!this.progressEl || !this.progressCurrentEl) return;
		const current = Math.min(this.sessionCompleted + 1, this.sessionTotal);
		this.progressCurrentEl.setText(String(current));
		this.progressEl.setAttribute(
			'aria-label',
			STRINGS.review.progressAria(current, this.sessionTotal),
		);
	}

	private showQuestion(): void {
		if (!this.current || !this.container) return;
		this.phase = 'question';
		this.container.empty();
		const review = this.container.createDiv({ cls: 'remember-review' });
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
		if (!this.current || !this.container) return;
		this.phase = 'answer';
		this.container.empty();
		const review = this.container.createDiv({ cls: 'remember-review' });
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
		const element = parent.createDiv({ cls: 'remember-card-side markdown-rendered' });
		void MarkdownRenderer.render(this.app, markdown, element, this.current?.path ?? '', this);
	}

	async rate(grade: Grade): Promise<void> {
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
				new Notice(STRINGS.notices.couldNotSaveReview(error));
				return;
			}
			const next = applyRating(this.fsrs, item.state, when, grade);
			const reentersSession = returnsToCurrentSession(next.due, when);
			this.undoStack.push({ item, event, advancedProgress: !reentersSession });
			if (reentersSession) {
				this.enqueue({ ...item, state: next, showAt: next.due });
			} else {
				this.sessionCompleted++;
			}
			this.showNext();
		} finally {
			this.busy = false;
		}
	}

	async undo(): Promise<void> {
		if (this.busy) return;
		const entry = this.undoStack[this.undoStack.length - 1];
		if (!entry) return;
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
			this.queue = this.queue.filter((queued) => !sameSibling(queued, entry.item));
			this.showQuestion();
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

	private enqueue(item: QueueItem): void {
		const index = this.queue.findIndex((queued) => queued.showAt.getTime() > item.showAt.getTime());
		if (index === -1) this.queue.push(item);
		else this.queue.splice(index, 0, item);
	}

	private async finish(): Promise<void> {
		this.reset();
		await this.onFinish();
	}

	private reset(): void {
		this.phase = 'idle';
		this.container = null;
		this.current = null;
		this.queue = [];
		this.undoStack = [];
		this.sessionDeck = null;
		this.progressEl = null;
		this.progressCurrentEl = null;
	}

	private reportDuplicates(duplicates: NoteCard[]): void {
		for (const duplicate of duplicates) {
			new Notice(STRINGS.notices.duplicateCardId(duplicate.path));
		}
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
