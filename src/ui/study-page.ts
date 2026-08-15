import { setTooltip } from 'obsidian';
import {
	countDeckStats,
	introducedTodaySiblingKeys,
	isDescendantDeck,
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

	const listEl = page.createDiv({ cls: 'remember-decks' });
	listEl.toggleClass('remember-has-waiting', showWaiting);
	listEl.toggleClass('remember-has-buried', showBuried);
	const header = listEl.createDiv({ cls: 'remember-deck-header' });
	header.createSpan({ cls: 'remember-deck-header-name', text: STRINGS.review.deckHeader });
	createCountHeader(header, STRINGS.review.counts.due, 'due');
	createCountHeader(header, STRINGS.review.counts.new, 'new');
	if (showWaiting) createCountHeader(header, STRINGS.review.counts.waiting, 'waiting');
	if (showBuried) createCountHeader(header, STRINGS.review.counts.buried, 'buried');
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
	createStatus(status, STRINGS.review.counts.due, counts.due, 'due');
	createStatus(status, STRINGS.review.counts.new, counts.new, 'new');
	createStatus(status, STRINGS.review.counts.waiting, counts.waiting, 'waiting');
	createStatus(status, STRINGS.review.counts.buried, counts.buried, 'buried');
	createStatus(status, STRINGS.review.counts.total, counts.total, 'total');

	const cards = snapshot.cards.filter((card) => isDescendantDeck(card.deck, deck));
	const forecast = forecastDeck(cards, snapshot.states, snapshot.events, now, {
		days: 14,
		newCardsPerDay: effectiveNewCardsPerDay(settings),
		burySiblings: settings.burySiblings,
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
	return countDeckStats(
		snapshot.cards.filter((card) => isDescendantDeck(card.deck, deck)),
		snapshot.states,
		now,
		{
			introducedToday,
			reviewedToday,
			newCardsPerDay: effectiveNewCardsPerDay(settings),
			burySiblings: settings.burySiblings,
		},
	);
}

function createStatus(
	parent: HTMLElement,
	copy: { label: string; tooltip: string },
	value: number,
	kind: 'due' | 'new' | 'waiting' | 'buried' | 'total',
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
	kind: 'due' | 'new' | 'waiting' | 'buried' | 'total',
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
	kind: 'due' | 'new' | 'waiting' | 'buried' | 'total',
): void {
	const count = parent.createSpan({ cls: `remember-count-${kind}`, text: String(value) });
	setTooltip(count, copy.tooltip);
	count.setAttribute('aria-label', copy.tooltip);
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
