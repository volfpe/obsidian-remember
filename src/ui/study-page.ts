import { setTooltip } from 'obsidian';
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

export function renderDeckChooser(
	parent: HTMLElement,
	snapshot: RememberSnapshot,
	settings: RememberSettings,
	onSelectDeck: (deck: string) => void,
	now = new Date(),
): void {
	parent.empty();
	const page = parent.createDiv({ cls: 'remember-study-page remember-deck-chooser' });
	if (snapshot.cards.length === 0) {
		page.createEl('p', {
			cls: 'remember-empty',
			text: STRINGS.review.noCards(settings.deckProperty),
		});
		return;
	}

	const tree = buildDeckTree(snapshot.cards);
	const statsByDeck = new Map<string, DeckCounts>();
	const collectStats = (node: DeckNode) => {
		statsByDeck.set(node.path, deckCounts(snapshot, settings, node.path, now));
		for (const child of node.children) collectStats(child);
	};
	for (const node of tree) collectStats(node);
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
	for (const node of tree) renderNode(node, 0);
}

export function renderDeckStudyPage(
	parent: HTMLElement,
	snapshot: RememberSnapshot,
	settings: RememberSettings,
	deck: string,
	onStartReview: () => void,
	now = new Date(),
): void {
	parent.empty();
	const counts = deckCounts(snapshot, settings, deck, now);
	const ready = counts.due + counts.new;
	const page = parent.createDiv({ cls: 'remember-deck-study-page' });
	const primary = page.createDiv({ cls: 'remember-deck-study-primary' });
	const readiness = primary.createDiv({ cls: 'remember-deck-readiness' });
	readiness.createSpan({
		cls: 'remember-deck-ready-value',
		text: ready === 0 ? STRINGS.study.nothingReady : STRINGS.study.ready(ready),
	});
	if (ready > 0) {
		const start = primary.createEl('button', {
			cls: 'mod-cta remember-start-review',
			text: STRINGS.study.startReview,
		});
		start.addEventListener('click', onStartReview);
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

	const cards = snapshot.cards.filter((card) => isDescendantDeck(card.deck, deck));
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
