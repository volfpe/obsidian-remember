import {
	Component,
	MarkdownRenderer,
	Notice,
	setIcon,
	setTooltip,
	TFile,
	type App,
} from 'obsidian';
import { Rating, type Grade } from 'ts-fsrs';
import { appendEvent, appendUndoEvent } from '../log';
import { parseCardNote } from '../core/card-note';
import type { BuryEvent, CardEvent, ReviewEvent } from '../core/events';
import { randomId } from '../core/id';
import {
	buildPracticeQueue,
	practiceDelayMinutes,
	PracticeSessionQueue,
} from '../core/practice';
import {
	buildQueue,
	countDeckStats,
	manuallyBuriedCardIds,
	returnsToCurrentSession,
	selectCards,
	type QueueItem,
} from '../core/queue';
import { applyRating, formatInterval, makeFsrs, previewDue } from '../core/scheduler';
import { STRINGS } from '../i18n';
import { DeckSettingsIndex, type DeckSettings } from '../deck-settings';
import {
	effectiveLearnAheadMinutes,
	effectiveNewCardsPerDay,
	type RememberSettings,
} from '../settings';
import { openCardDefinition } from './open-card-definition';
import type { RememberSnapshot } from './remember-snapshot';
import { displayDeck } from './study-page';

interface UndoEntry {
	/** The item as presented before the reversible action. */
	item: QueueItem;
	event: CardEvent;
	progressDelta: number;
	removedSiblings: QueueItem[];
}

export class ReviewSession extends Component {
	private phase: 'idle' | 'question' | 'answer' = 'idle';
	private mode: 'review' | 'practice' = 'review';
	private container: HTMLElement | null = null;
	private queue: QueueItem[] = [];
	private practiceQueue: PracticeSessionQueue | null = null;
	private current: QueueItem | null = null;
	private undoStack: UndoEntry[] = [];
	private sessionTotal = 0;
	private sessionCompleted = 0;
	private sessionDeck: string | null = null;
	private progressEl: HTMLElement | null = null;
	private progressCurrentEl: HTMLElement | null = null;
	private busy = false;
	private deckSettings: DeckSettingsIndex;
	private sessionSettings: DeckSettings;

	constructor(
		private app: App,
		private settings: RememberSettings,
		private onFinish: () => Promise<void>,
	) {
		super();
		this.deckSettings = new DeckSettingsIndex(settings);
		this.sessionSettings = this.deckSettings.resolve('').values;
	}

	get active(): boolean {
		return this.phase !== 'idle';
	}

	override onload(): void {
		this.registerEvent(
			this.app.workspace.on('active-leaf-change', () => void this.refreshCurrentDefinition()),
		);
	}

	override onunload(): void {
		this.reset();
	}

	async start(parent: HTMLElement, deck: string, snapshot: RememberSnapshot): Promise<void> {
		if (this.busy) return;
		this.busy = true;
		this.container = parent;
		this.mode = 'review';
		this.practiceQueue = null;
		this.deckSettings = snapshot.deckSettings;
		this.sessionSettings = snapshot.deckSettings.resolve(deck).values;
		try {
			const selection = selectCards(snapshot.cards, deck);
			const { buries, states } = snapshot;
			const now = snapshot.loadedAt;
			const newCardsPerDay = effectiveNewCardsPerDay(this.sessionSettings);
			const { introducedToday, reviewedToday } = snapshot;
			const buriedCardIds = manuallyBuriedCardIds(buries, now);
			const counts = countDeckStats(selection.kept, states, now, {
				introducedToday,
				reviewedToday,
				manuallyBuriedCardIds: buriedCardIds,
				newCardsPerDay,
				burySiblings: this.sessionSettings.burySiblings,
			});
			this.queue = buildQueue(selection.kept, states, now, {
				maxNewCards: counts.new,
				reviewedToday,
				manuallyBuriedCardIds: buriedCardIds,
				burySiblings: this.sessionSettings.burySiblings,
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

	async startPractice(parent: HTMLElement, deck: string, snapshot: RememberSnapshot): Promise<void> {
		if (this.busy) return;
		this.busy = true;
		this.container = parent;
		this.mode = 'practice';
		this.deckSettings = snapshot.deckSettings;
		this.sessionSettings = snapshot.deckSettings.resolve(deck).values;
		try {
			// Freeze eligibility at the instant this Practice session begins.
			const now = new Date();
			const selection = selectCards(snapshot.cards, deck);
			this.practiceQueue = new PracticeSessionQueue(
				buildPracticeQueue(selection.kept, snapshot.states, now, {
					manuallyBuriedCardIds: manuallyBuriedCardIds(snapshot.buries, now),
				}),
			);
			this.queue = [];
			this.sessionTotal = this.practiceQueue.total;
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
		this.current =
			this.mode === 'practice'
				? (this.practiceQueue?.next(new Date()) ?? null)
				: (this.queue.shift() ?? null);
		if (this.current === null) {
			void this.finish();
			return;
		}
		this.showQuestion();
	}

	private renderSessionHeader(parent: HTMLElement): void {
		const header = parent.createDiv({ cls: 'remember-session-header' });
		header.createSpan({
			cls: 'remember-session-title-name',
			text:
				this.sessionDeck === null
					? ''
					: this.mode === 'practice'
						? STRINGS.review.practiceTitle(displayDeck(this.sessionDeck))
						: displayDeck(this.sessionDeck),
		});
		this.progressEl = header.createSpan({ cls: 'remember-progress' });
		this.progressCurrentEl = this.progressEl.createSpan({ cls: 'remember-progress-current' });
		this.progressEl.createSpan({
			cls: 'remember-progress-separator',
			text: STRINGS.review.progressSeparator,
		});
		this.progressEl.createSpan({ cls: 'remember-progress-total', text: String(this.sessionTotal) });
		const actions = header.createDiv({ cls: 'remember-session-actions' });
		if (this.mode === 'review' && this.phase === 'question' && this.undoStack.length > 0) {
			const undo = actions.createEl('button', {
				cls: 'clickable-icon remember-session-undo',
			});
			setIcon(undo, 'undo-2');
			setTooltip(undo, STRINGS.review.undoAria);
			undo.setAttribute('aria-label', STRINGS.review.undoAria);
			undo.addEventListener('click', () => void this.undo());
		}
		const source = actions.createEl('button', {
			cls: 'clickable-icon remember-session-source',
		});
		setIcon(source, 'file-pen-line');
		setTooltip(source, STRINGS.review.openDefinition);
		source.setAttribute('aria-label', STRINGS.review.openDefinition);
		source.addEventListener('click', () => {
			if (this.current) void openCardDefinition(this.app, this.current);
		});
		if (this.mode === 'review') {
			const bury = actions.createEl('button', {
				cls: 'clickable-icon remember-session-bury',
			});
			setIcon(bury, 'archive');
			setTooltip(bury, STRINGS.review.buryToday);
			bury.setAttribute('aria-label', STRINGS.review.buryToday);
			bury.addEventListener('click', () => void this.bury());
		}
		actions.createSpan({ cls: 'remember-session-action-divider', attr: { 'aria-hidden': 'true' } });
		const back = actions.createEl('button', {
			cls: 'clickable-icon remember-session-back',
		});
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
		const previews =
			this.mode === 'review'
				? previewDue(makeFsrs(this.retentionFor(this.current)), this.current.state, now)
				: null;
		const learnAheadMinutes = effectiveLearnAheadMinutes(this.sessionSettings);
		const footer = review.createDiv({ cls: 'remember-footer' });
		const buttons = footer.createDiv({ cls: 'remember-buttons remember-rating-buttons' });
		const ratings: [Grade, string, string][] = [
			[Rating.Again, STRINGS.review.ratings.again, 'again'],
			[Rating.Hard, STRINGS.review.ratings.hard, 'hard'],
			[Rating.Good, STRINGS.review.ratings.good, 'good'],
			[Rating.Easy, STRINGS.review.ratings.easy, 'easy'],
		];
		for (const [grade, label, tone] of ratings) {
			const button = buttons.createEl('button', {
				cls: `remember-response remember-rate remember-rate-${tone}`,
			});
			const text = button.createSpan({ cls: 'remember-response-text' });
			text.createSpan({ cls: 'remember-response-label', text: label });
			if (this.mode === 'practice') {
				const delay = practiceDelayMinutes(grade);
				if (delay !== null) {
					const tooltip =
						grade === Rating.Again
							? STRINGS.review.practiceAgainTooltip
							: STRINGS.review.practiceHardTooltip;
					const details = text.createSpan({ cls: 'remember-response-details' });
					details.createSpan({ cls: 'remember-interval', text: `${delay}m` });
					const returns = details.createSpan({ cls: 'remember-session-return' });
					setIcon(returns, 'repeat-2');
					setTooltip(returns, tooltip);
					returns.setAttribute('aria-label', tooltip);
				}
				button.addEventListener('click', () => this.practiceRate(grade));
			} else if (previews !== null) {
				const due = previews[grade];
				const details = text.createSpan({ cls: 'remember-response-details' });
				details.createSpan({ cls: 'remember-interval', text: formatInterval(now, due) });
				if (returnsToCurrentSession(due, now, learnAheadMinutes)) {
					const returns = details.createSpan({ cls: 'remember-session-return' });
					setIcon(returns, 'repeat-2');
					setTooltip(returns, STRINGS.review.returnsThisSession);
					returns.setAttribute('aria-label', STRINGS.review.returnsThisSession);
				}
				button.addEventListener('click', () => void this.rate(grade));
			}
		}
	}

	/** Practice ratings only mutate this session's in-memory retry queue. */
	practiceRate(grade: Grade, when = new Date()): void {
		const item = this.current;
		if (
			!item ||
			!this.practiceQueue ||
			this.mode !== 'practice' ||
			this.phase !== 'answer' ||
			this.busy
		) return;
		if (this.practiceQueue.answer(item, grade, when)) this.sessionCompleted++;
		this.showNext();
	}

	private renderSide(parent: HTMLElement, markdown: string): void {
		const element = parent.createDiv({ cls: 'remember-card-side markdown-rendered' });
		void MarkdownRenderer.render(this.app, markdown, element, this.current?.path ?? '', this);
	}

	async rate(grade: Grade): Promise<void> {
		const item = this.current;
		if (!item || this.mode !== 'review' || this.phase !== 'answer' || this.busy) return;
		this.busy = true;
		try {
			const when = new Date();
			const fsrs = makeFsrs(this.retentionFor(item));
			const event: ReviewEvent = {
				v: 1,
				k: 'r',
				i: randomId(),
				t: when.toISOString(),
				c: item.cardId,
				s: item.sub,
				r: grade,
				dr: fsrs.parameters.request_retention,
			};
			try {
				await appendEvent(this.app, this.settings.rootFolder, event);
			} catch (error) {
				new Notice(STRINGS.notices.couldNotSaveReview(error));
				return;
			}
			const next = applyRating(fsrs, item.state, when, grade);
			const learnAheadMinutes = effectiveLearnAheadMinutes(this.sessionSettings);
			const reentersSession = returnsToCurrentSession(next.due, when, learnAheadMinutes);
			this.undoStack.push({
				item,
				event,
				progressDelta: reentersSession ? 0 : 1,
				removedSiblings: [],
			});
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

	async bury(): Promise<void> {
		const item = this.current;
		if (!item || this.mode !== 'review' || this.phase === 'idle' || this.busy) return;
		this.busy = true;
		try {
			const when = new Date();
			const event: BuryEvent = {
				v: 1,
				k: 'b',
				i: randomId(),
				t: when.toISOString(),
				c: item.cardId,
				x: startOfNextLocalDay(when).toISOString(),
			};
			try {
				await appendEvent(this.app, this.settings.rootFolder, event);
			} catch (error) {
				new Notice(STRINGS.notices.couldNotSaveBury(error));
				return;
			}
			const removedSiblings = this.queue.filter((queued) => queued.cardId === item.cardId);
			this.queue = this.queue.filter((queued) => queued.cardId !== item.cardId);
			const progressDelta = removedSiblings.length + 1;
			this.undoStack.push({ item, event, progressDelta, removedSiblings });
			this.sessionCompleted += progressDelta;
			this.showNext();
		} finally {
			this.busy = false;
		}
	}

	private async refreshCurrentDefinition(): Promise<void> {
		const item = this.current;
		if (!item || this.phase === 'idle' || this.busy) return;
		const file = this.app.vault.getAbstractFileByPath(item.path);
		if (!(file instanceof TFile)) return;
		let definition: ReturnType<typeof parseCardNote>;
		try {
			definition = parseCardNote(
				await this.app.vault.cachedRead(file),
				this.app.metadataCache.getFileCache(file)?.frontmatter,
			);
		} catch (error) {
			console.warn(`Remember: could not refresh ${item.path} after editing`, error);
			return;
		}
		if (definition.id !== item.cardId) return;
		if (definition.suspended) {
			const queuedSiblings =
				this.queue.filter((queued) => queued.cardId === item.cardId).length +
				(this.practiceQueue?.removeCard(item.cardId) ?? 0);
			this.queue = this.queue.filter((queued) => queued.cardId !== item.cardId);
			this.sessionTotal = Math.max(
				this.sessionCompleted,
				this.sessionTotal - queuedSiblings - 1,
			);
			this.showNext();
			return;
		}
		const sibling = definition.siblings.find(({ sub }) => sub === item.sub);
		if (!sibling) return;
		if (sibling.front === item.front && sibling.back === item.back && definition.line === item.line) return;
		this.current = { ...item, front: sibling.front, back: sibling.back, line: definition.line };
		if (this.phase === 'question') this.showQuestion();
		else this.showAnswer();
	}

	async undo(): Promise<void> {
		if (this.mode !== 'review' || this.busy) return;
		const entry = this.undoStack[this.undoStack.length - 1];
		if (!entry) return;
		this.busy = true;
		try {
			try {
				await appendUndoEvent(this.app, this.settings.rootFolder, entry.event.i);
			} catch (error) {
				console.warn('Remember: undo failed', error);
				new Notice(STRINGS.notices.couldNotSaveUndo(error));
				return;
			}
			this.undoStack.pop();
			this.sessionCompleted -= entry.progressDelta;
			const shown = this.current;
			this.current = entry.item;
			if (shown && !sameSibling(shown, entry.item)) this.enqueue(shown);
			this.queue = this.queue.filter((queued) => !sameSibling(queued, entry.item));
			for (const sibling of entry.removedSiblings) this.enqueue(sibling);
			this.showQuestion();
		} finally {
			this.busy = false;
		}
	}

	private enqueue(item: QueueItem): void {
		const index = this.queue.findIndex((queued) => queued.showAt.getTime() > item.showAt.getTime());
		if (index === -1) this.queue.push(item);
		else this.queue.splice(index, 0, item);
	}

	private retentionFor(item: QueueItem): number {
		return this.deckSettings.resolve(item.deck).values.desiredRetention;
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
		this.practiceQueue = null;
		this.undoStack = [];
		this.mode = 'review';
		this.sessionDeck = null;
		this.progressEl = null;
		this.progressCurrentEl = null;
	}
}

function sameSibling(a: QueueItem, b: QueueItem): boolean {
	return a.cardId === b.cardId && a.sub === b.sub;
}

function startOfNextLocalDay(now: Date): Date {
	return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
}
