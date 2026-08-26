import { Rating, type Grade } from 'ts-fsrs';
import type { ReviewEvent } from '../../core/events';
import { STRINGS } from '../../i18n';
import type {
	ReviewHistoryCursor,
	ReviewHistoryPage,
	ReviewHistoryReader,
} from '../../cache/review-cache';
import type { CardListItem } from './cards-model';

/** Owns lazy history queries for the one card detail currently being rendered. */
export class CardHistoryView {
	private reader: ReviewHistoryReader | null = null;
	private cache = new Map<string, ReviewHistoryPage>();
	private generation = 0;

	reset(reader: ReviewHistoryReader): void {
		this.reader = reader;
		this.clear();
	}

	clear(): void {
		this.cache.clear();
		this.generation++;
	}

	unload(): void {
		this.reader = null;
		this.clear();
	}

	render(parent: HTMLElement, item: CardListItem): void {
		const section = parent.createEl('section', { cls: 'remember-card-detail-section' });
		section.createEl('h3', { text: STRINGS.cards.history });
		const generation = ++this.generation;
		if (item.cardId === null || this.reader === null) {
			this.renderEvents(section, []);
			return;
		}
		const cached = this.cache.get(item.key);
		if (cached) {
			this.renderEvents(section, cached.events, cached.next, item);
			return;
		}
		void this.reader.getHistory(item.cardId, item.sub).then(
			(page) => {
				if (generation !== this.generation) return;
				this.cache.set(item.key, page);
				this.renderEvents(section, page.events, page.next, item);
			},
			(error) => {
				console.warn('Remember: could not load card history', error);
				if (generation !== this.generation) return;
				section.empty();
				section.createEl('h3', { text: STRINGS.cards.history });
				section.createEl('p', {
					cls: 'remember-card-history-empty',
					text: STRINGS.cards.historyFailed,
				});
			},
		);
	}

	private renderEvents(
		section: HTMLElement,
		events: ReviewEvent[],
		next: ReviewHistoryCursor | null = null,
		item?: CardListItem,
	): void {
		section.empty();
		section.createEl('h3', { text: STRINGS.cards.history });
		if (events.length === 0) {
			section.createEl('p', { cls: 'remember-card-history-empty', text: STRINGS.cards.noHistory });
			return;
		}
		const list = section.createEl('ol', { cls: 'remember-card-history' });
		const formatter = new Intl.DateTimeFormat(undefined, {
			dateStyle: 'medium',
			timeStyle: 'short',
		});
		for (const event of events) {
			const row = list.createEl('li');
			row.createSpan({ text: formatter.format(new Date(event.t)) });
			row.createSpan({
				cls: `remember-history-rating remember-history-rating-${event.r}`,
				text: ratingLabel(event.r),
			});
		}
		if (next !== null && item !== undefined && item.cardId !== null) {
			const more = section.createEl('button', {
				cls: 'remember-card-history-more',
				text: STRINGS.cards.loadMoreHistory,
			});
			more.addEventListener('click', () => void this.loadMore(section, item, next));
		}
	}

	private async loadMore(
		section: HTMLElement,
		item: CardListItem,
		before: ReviewHistoryCursor,
	): Promise<void> {
		const reader = this.reader;
		if (reader === null || item.cardId === null) return;
		const generation = this.generation;
		try {
			const page = await reader.getHistory(item.cardId, item.sub, 50, before);
			if (generation !== this.generation) return;
			const current = this.cache.get(item.key) ?? { events: [], next: null };
			const combined = { events: [...current.events, ...page.events], next: page.next };
			this.cache.set(item.key, combined);
			this.renderEvents(section, combined.events, combined.next, item);
		} catch (error) {
			console.warn('Remember: could not load more card history', error);
		}
	}
}

function ratingLabel(rating: Grade): string {
	if (rating === Rating.Again) return STRINGS.review.ratings.again;
	if (rating === Rating.Hard) return STRINGS.review.ratings.hard;
	if (rating === Rating.Easy) return STRINGS.review.ratings.easy;
	return STRINGS.review.ratings.good;
}
