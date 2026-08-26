import { State, type Card as FsrsCard } from 'ts-fsrs';
import {
	classifyDeckSiblings,
	isDescendantDeck,
	manuallyBuriedCardIds,
	noteSiblingKey,
	type CardAvailability,
} from '../../core/queue';
import { siblingKey } from '../../core/scheduler';
import { effectiveNewCardsPerDay } from '../../settings';
import type { RememberSnapshot } from '../remember-snapshot';

export interface CardListItem {
	key: string;
	cardId: string | null;
	deck: string;
	path: string;
	line: number;
	sub: number;
	front: string;
	back: string;
	sibling: { kind: 'forward' | 'reverse' } | { kind: 'cloze'; number: number };
	availability: CardAvailability;
	state: FsrsCard | null;
}

export interface CardDeckGroup {
	deck: string;
	items: CardListItem[];
}

export function buildCardDeckGroups(
	snapshot: RememberSnapshot,
	selectedDeck: string,
	now = new Date(),
): CardDeckGroup[] {
	const settings = snapshot.deckSettings.resolve(selectedDeck).values;
	const cards = snapshot.cards.filter((card) => isDescendantDeck(card.deck, selectedDeck));
	const availability = classifyDeckSiblings(cards, snapshot.states, now, {
		introducedToday: snapshot.introducedToday,
		reviewedToday: snapshot.reviewedToday,
		manuallyBuriedCardIds: manuallyBuriedCardIds(snapshot.buries, now),
		newCardsPerDay: effectiveNewCardsPerDay(settings),
		burySiblings: settings.burySiblings,
	});
	const items: CardListItem[] = [];
	for (const card of cards) {
		for (const sibling of card.siblings) {
			const persistedKey = card.id === null ? null : siblingKey(card.id, sibling.sub);
			const key = noteSiblingKey(card, sibling.sub);
			const state = persistedKey === null ? null : (snapshot.states.get(persistedKey) ?? null);
			const currentAvailability =
				availability.get(key) ??
				(state === null ? 'new' : state.due.getTime() <= now.getTime() ? 'due' : 'scheduled');
			items.push({
				key,
				cardId: card.id,
				deck: card.deck,
				path: card.path,
				line: card.line,
				sub: sibling.sub,
				front: sibling.front,
				back: sibling.back,
				sibling:
					card.kind === 'cloze'
						? { kind: 'cloze', number: sibling.sub - 1 }
						: sibling.sub === 0
							? { kind: 'forward' }
							: { kind: 'reverse' },
				availability: currentAvailability,
				state,
			});
		}
	}
	items.sort(
		(a, b) =>
			compareStrings(a.deck, b.deck) ||
			compareStrings(a.path, b.path) ||
			a.line - b.line ||
			a.sub - b.sub,
	);

	const groups: CardDeckGroup[] = [];
	for (const item of items) {
		const current = groups[groups.length - 1];
		if (current?.deck === item.deck) current.items.push(item);
		else groups.push({ deck: item.deck, items: [item] });
	}
	return groups;
}

export function cardStateKind(state: FsrsCard | null): 'new' | 'learning' | 'review' | 'relearning' {
	if (state === null || state.state === State.New) return 'new';
	if (state.state === State.Learning) return 'learning';
	if (state.state === State.Relearning) return 'relearning';
	return 'review';
}

function compareStrings(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}
