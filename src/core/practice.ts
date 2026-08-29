// Pure, session-local Practice eligibility and retry scheduling. No persistence or Obsidian imports.

import { Rating, State, type Card as FsrsCard, type Grade } from 'ts-fsrs';
import type { NoteCard, QueueItem } from './queue';
import { siblingKey } from './scheduler';

export interface PracticeQueueOptions {
	manuallyBuriedCardIds?: ReadonlySet<string>;
}

/** Future, already-learned siblings ordered by their unchanged real due dates. */
export function buildPracticeQueue(
	cards: NoteCard[],
	states: Map<string, FsrsCard>,
	sessionStartedAt: Date,
	options: PracticeQueueOptions = {},
): QueueItem[] {
	return [...eligiblePracticeItems(cards, states, sessionStartedAt, options)].sort(
		(a, b) => a.showAt.getTime() - b.showAt.getTime() || compareSiblingKeys(a, b),
	);
}

/** Checks eligibility without allocating the full queue used by a started session. */
export function hasPracticeCards(
	cards: NoteCard[],
	states: Map<string, FsrsCard>,
	sessionStartedAt: Date,
	options: PracticeQueueOptions = {},
): boolean {
	return !eligiblePracticeItems(cards, states, sessionStartedAt, options).next().done;
}

function* eligiblePracticeItems(
	cards: NoteCard[],
	states: Map<string, FsrsCard>,
	sessionStartedAt: Date,
	options: PracticeQueueOptions,
): Generator<QueueItem> {
	const { manuallyBuriedCardIds = new Set<string>() } = options;
	for (const card of cards) {
		if (card.id === null || card.suspended || manuallyBuriedCardIds.has(card.id)) continue;
		for (const sibling of card.siblings) {
			const state = states.get(siblingKey(card.id, sibling.sub));
			if (
				!state ||
				state.state === State.New ||
				state.due.getTime() <= sessionStartedAt.getTime()
			) {
				continue;
			}
			yield {
				path: card.path,
				line: card.line,
				deck: card.deck,
				cardId: card.id,
				sub: sibling.sub,
				kind: card.kind,
				front: sibling.front,
				back: sibling.back,
				state,
				showAt: state.due,
			};
		}
	}
}

/** Owns all temporary Practice state for one session. */
export class PracticeSessionQueue {
	readonly total: number;
	private untouched: QueueItem[];
	private retries: QueueItem[] = [];

	constructor(untouched: QueueItem[]) {
		this.untouched = untouched;
		this.total = untouched.length;
	}

	next(now: Date): QueueItem | null {
		const retry = this.retries[0];
		if (retry && retry.showAt.getTime() <= now.getTime()) return this.retries.shift()!;
		const untouched = this.untouched.shift();
		if (untouched) return untouched;
		// Learn ahead rather than waiting when only future retries remain.
		return this.retries.shift() ?? null;
	}

	/** Returns true when this answer completes the card for the session. */
	answer(item: QueueItem, grade: Grade, when: Date): boolean {
		const delay = practiceDelayMinutes(grade);
		if (delay === null) return true;
		this.enqueueRetry({
			...item,
			showAt: new Date(when.getTime() + delay * 60 * 1000),
		});
		return false;
	}

	removeCard(cardId: string): number {
		const previous = this.untouched.length + this.retries.length;
		this.untouched = this.untouched.filter((item) => item.cardId !== cardId);
		this.retries = this.retries.filter((item) => item.cardId !== cardId);
		return previous - this.untouched.length - this.retries.length;
	}

	private enqueueRetry(item: QueueItem): void {
		const index = this.retries.findIndex(
			(queued) =>
				queued.showAt.getTime() > item.showAt.getTime() ||
				(queued.showAt.getTime() === item.showAt.getTime() && compareSiblingKeys(queued, item) > 0),
		);
		if (index === -1) this.retries.push(item);
		else this.retries.splice(index, 0, item);
	}
}

export function practiceDelayMinutes(grade: Grade): number | null {
	if (grade === Rating.Again) return 1;
	if (grade === Rating.Hard) return 10;
	return null;
}

function compareSiblingKeys(a: QueueItem, b: QueueItem): number {
	const aKey = siblingKey(a.cardId, a.sub);
	const bKey = siblingKey(b.cardId, b.sub);
	return aKey < bKey ? -1 : aKey > bKey ? 1 : 0;
}
