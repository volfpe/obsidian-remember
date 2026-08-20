import { setIcon, setTooltip } from 'obsidian';
import { hasPracticeCards } from '../core/practice';
import {
	countDeckStats,
	introducedTodaySiblingKeys,
	isDescendantDeck,
	manuallyBuriedCardIds,
	reviewedTodaySiblingKeys,
	type DeckCounts,
	type NoteCard,
} from '../core/queue';
import { STRINGS } from '../i18n';
import { effectiveNewCardsPerDay, type RememberSettings } from '../settings';
import { forecastDeck } from '../statistics/forecast';
import type { RememberSnapshot } from './remember-snapshot';
import { renderScheduleForecast } from './statistics/schedule-forecast';

interface DeckNode {
	path: string;
	name: string;
	children: DeckNode[];
}

/** The root deck '' is presented as "All"; every other deck shows its folder path. */
export function displayDeck(deck: string): string {
	return deck === '' ? STRINGS.study.allDecks : deck;
}

export function renderDeckChooser(
	parent: HTMLElement,
	snapshot: RememberSnapshot,
	settings: RememberSettings,
	onSelectDeck: (deck: string) => void,
	now = new Date(),
	onNewCard: () => void = () => undefined,
): void {
	parent.empty();
	const page = parent.createDiv({ cls: 'remember-study-page remember-deck-chooser' });
	if (snapshot.cards.length === 0) {
		const empty = page.createDiv({ cls: 'remember-new-card-empty' });
		const button = empty.createEl('button', {
			cls: 'mod-cta remember-new-card-empty-button',
			text: STRINGS.addCard.title,
		});
		button.addEventListener('click', onNewCard);
		return;
	}

	const tree = buildDeckTree(snapshot.cards);
	const statsByDeck = new Map<string, DeckCounts>();
	const collectStats = (node: DeckNode) => {
		statsByDeck.set(node.path, deckCounts(snapshot, settings, node.path, now));
		for (const child of node.children) collectStats(child);
	};
	collectStats(tree);
	const showWaiting = [...statsByDeck.values()].some((counts) => counts.waiting > 0);
	const showBuried = [...statsByDeck.values()].some((counts) => counts.buried > 0);
	const showSuspended = [...statsByDeck.values()].some((counts) => counts.suspended > 0);

	const listEl = page.createDiv({ cls: 'remember-decks' });
	listEl.toggleClass('remember-has-waiting', showWaiting);
	listEl.toggleClass('remember-has-buried', showBuried);
	listEl.toggleClass('remember-has-suspended', showSuspended);
	listEl.style.setProperty(
		'--remember-deck-count-columns',
		deckCountColumns(showWaiting, showBuried, showSuspended),
	);
	const header = listEl.createDiv({ cls: 'remember-deck-header' });
	header.createSpan({ cls: 'remember-deck-header-name', text: STRINGS.review.deckHeader });
	createCountHeader(header, STRINGS.review.counts.due, 'due');
	createCountHeader(header, STRINGS.review.counts.new, 'new');
	if (showWaiting) createCountHeader(header, STRINGS.review.counts.waiting, 'waiting');
	if (showBuried) createCountHeader(header, STRINGS.review.counts.buried, 'buried');
	if (showSuspended) createCountHeader(header, STRINGS.review.counts.suspended, 'suspended');
	createCountHeader(header, STRINGS.review.counts.total, 'total');

	const renderNode = (node: DeckNode, depth: number) => {
		const counts = statsByDeck.get(node.path)!;
		const row = listEl.createEl('button', { cls: 'remember-deck-row' });
		row.style.setProperty('--remember-depth', String(depth));
		row.createSpan({ cls: 'remember-deck-name', text: node.name });
		const countsEl = row.createSpan({ cls: 'remember-deck-counts' });
		createCountValue(countsEl, STRINGS.review.counts.due, counts.due, 'due');
		createCountValue(countsEl, STRINGS.review.counts.new, counts.new, 'new');
		if (showWaiting) {
			createCountValue(countsEl, STRINGS.review.counts.waiting, counts.waiting, 'waiting');
		}
		if (showBuried) {
			createCountValue(countsEl, STRINGS.review.counts.buried, counts.buried, 'buried');
		}
		if (showSuspended) {
			createCountValue(countsEl, STRINGS.review.counts.suspended, counts.suspended, 'suspended');
		}
		createCountValue(countsEl, STRINGS.review.counts.total, counts.total, 'total');
		row.addEventListener('click', () => onSelectDeck(node.path));
		for (const child of node.children) renderNode(child, depth + 1);
	};
	renderNode(tree, 0);
}

export function renderDeckStudyPage(
	parent: HTMLElement,
	snapshot: RememberSnapshot,
	settings: RememberSettings,
	deck: string,
	onStartReview: () => void,
	now = new Date(),
	onStartPractice: () => void = () => undefined,
): void {
	parent.empty();
	const counts = deckCounts(snapshot, settings, deck, now);
	const ready = counts.due + counts.new;
	const cards = snapshot.cards.filter((card) => isDescendantDeck(card.deck, deck));
	const canPractice = hasPracticeCards(cards, snapshot.states, now, {
		manuallyBuriedCardIds: manuallyBuriedCardIds(snapshot.buries, now),
	});
	const page = parent.createDiv({ cls: 'remember-deck-study-page' });
	const primary = page.createDiv({ cls: 'remember-deck-study-primary' });
	const readiness = primary.createDiv({ cls: 'remember-deck-readiness' });
	readiness.createSpan({
		cls: 'remember-deck-ready-value',
		text: ready === 0 ? STRINGS.study.nothingReady : STRINGS.study.ready(ready),
	});
	if (ready > 0) {
		const actions = primary.createDiv({ cls: 'remember-deck-study-actions' });
		const start = actions.createEl('button', {
			cls: 'mod-cta remember-start-review',
			text: STRINGS.study.startReview,
		});
		start.addEventListener('click', onStartReview);
		if (canPractice) {
			actions.addClass('has-options');
			const practice = actions.createEl('button', {
				cls: 'remember-start-practice remember-start-practice-option',
				text: STRINGS.study.startPractice,
			});
			practice.tabIndex = -1;
			practice.setAttribute('aria-hidden', 'true');
			setTooltip(practice, STRINGS.study.practiceDescription);
			practice.setAttribute('aria-description', STRINGS.study.practiceDescription);
			practice.addEventListener('click', onStartPractice);
			const options = actions.createEl('button', {
				cls: 'mod-cta remember-start-options',
			});
			const optionsIcon = options.createSpan({ cls: 'remember-start-options-icon' });
			setIcon(optionsIcon, 'chevron-down');
			options.setAttribute('aria-label', STRINGS.study.moreStudyOptions);
			options.setAttribute('aria-expanded', 'false');
			let closeOnOutsideClick: (() => void) | null = null;
			const closePractice = () => {
				actions.removeClass('is-open');
				practice.tabIndex = -1;
				practice.setAttribute('aria-hidden', 'true');
				options.setAttribute('aria-expanded', 'false');
				if (closeOnOutsideClick) {
					options.ownerDocument.removeEventListener('click', closeOnOutsideClick);
					closeOnOutsideClick = null;
				}
			};
			options.addEventListener('click', (event) => {
				event.stopPropagation();
				if (actions.hasClass('is-open')) {
					closePractice();
					return;
				}
				actions.addClass('is-open');
				practice.tabIndex = 0;
				practice.setAttribute('aria-hidden', 'false');
				options.setAttribute('aria-expanded', 'true');
				closeOnOutsideClick = closePractice;
				options.ownerDocument.addEventListener('click', closeOnOutsideClick, { once: true });
			});
		}
	} else if (canPractice) {
		const actions = primary.createDiv({ cls: 'remember-deck-study-actions' });
		const practice = actions.createEl('button', {
			cls: 'remember-start-practice',
			text: STRINGS.study.startPractice,
		});
		setTooltip(practice, STRINGS.study.practiceDescription);
		practice.setAttribute('aria-description', STRINGS.study.practiceDescription);
		practice.addEventListener('click', onStartPractice);
	}

	const status = page.createDiv({ cls: 'remember-deck-status' });
	const optionalStatusCount = [counts.waiting, counts.buried, counts.suspended].filter(
		(value) => value > 0,
	).length;
	status.style.setProperty('--remember-deck-status-columns', String(3 + optionalStatusCount));
	createStatus(status, STRINGS.review.counts.due, counts.due, 'due');
	createStatus(status, STRINGS.review.counts.new, counts.new, 'new');
	if (counts.waiting > 0) {
		createStatus(status, STRINGS.review.counts.waiting, counts.waiting, 'waiting');
	}
	if (counts.buried > 0) {
		createStatus(status, STRINGS.review.counts.buried, counts.buried, 'buried');
	}
	if (counts.suspended > 0) {
		createStatus(status, STRINGS.review.counts.suspended, counts.suspended, 'suspended');
	}
	createStatus(status, STRINGS.review.counts.total, counts.total, 'total');

	const forecast = forecastDeck(cards, snapshot.states, snapshot.events, now, {
		days: 14,
		newCardsPerDay: effectiveNewCardsPerDay(settings),
		burySiblings: settings.burySiblings,
		buries: snapshot.buries,
	});
	renderScheduleForecast(page, forecast);
}

function deckCounts(
	snapshot: RememberSnapshot,
	settings: RememberSettings,
	deck: string,
	now: Date,
): DeckCounts {
	const introducedToday = introducedTodaySiblingKeys(snapshot.events, now);
	const reviewedToday = reviewedTodaySiblingKeys(snapshot.events, now);
	const buriedCardIds = manuallyBuriedCardIds(snapshot.buries, now);
	return countDeckStats(
		snapshot.cards.filter((card) => isDescendantDeck(card.deck, deck)),
		snapshot.states,
		now,
		{
			introducedToday,
			reviewedToday,
			manuallyBuriedCardIds: buriedCardIds,
			newCardsPerDay: effectiveNewCardsPerDay(settings),
			burySiblings: settings.burySiblings,
		},
	);
}

function createStatus(
	parent: HTMLElement,
	copy: { label: string; tooltip: string },
	value: number,
	kind: 'due' | 'new' | 'waiting' | 'buried' | 'suspended' | 'total',
): void {
	const item = parent.createDiv({ cls: `remember-deck-status-item remember-deck-status-${kind}` });
	setTooltip(item, copy.tooltip);
	item.setAttribute('aria-label', copy.tooltip);
	item.createSpan({ cls: 'remember-deck-status-value', text: String(value) });
	item.createSpan({ cls: 'remember-deck-status-label', text: copy.label });
}

function createCountHeader(
	parent: HTMLElement,
	copy: { label: string; tooltip: string },
	kind: 'due' | 'new' | 'waiting' | 'buried' | 'suspended' | 'total',
): void {
	const header = parent.createSpan({
		cls: `remember-deck-header-count remember-deck-header-count-${kind}`,
		text: copy.label,
	});
	setTooltip(header, copy.tooltip);
	header.setAttribute('aria-label', copy.tooltip);
}

function createCountValue(
	parent: HTMLElement,
	copy: { label: string; tooltip: string },
	value: number,
	kind: 'due' | 'new' | 'waiting' | 'buried' | 'suspended' | 'total',
): void {
	const count = parent.createSpan({ cls: `remember-count-${kind}`, text: String(value) });
	setTooltip(count, copy.tooltip);
	count.setAttribute('aria-label', copy.tooltip);
}

function deckCountColumns(showWaiting: boolean, showBuried: boolean, showSuspended: boolean): string {
	return [
		'44px',
		'44px',
		...(showWaiting ? ['58px'] : []),
		...(showBuried ? ['54px'] : []),
		...(showSuspended ? ['68px'] : []),
		'52px',
	].join(' ');
}

/** All decks hang under the root deck '', which exists even when it holds no cards directly. */
function buildDeckTree(cards: NoteCard[]): DeckNode {
	const root: DeckNode = { path: '', name: STRINGS.study.allDecks, children: [] };
	const byPath = new Map<string, DeckNode>();
	for (const deck of [...new Set(cards.map((card) => card.deck))].sort()) {
		if (deck === '') continue;
		let path = '';
		let siblings = root.children;
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
	return root;
}
