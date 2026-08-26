import {
	Component,
	MarkdownRenderer,
	setIcon,
	setTooltip,
	type App,
} from 'obsidian';
import { formatInterval } from '../../core/scheduler';
import { STRINGS } from '../../i18n';
import type { RememberSnapshot } from '../remember-snapshot';
import { openCardDefinition } from '../open-card-definition';
import { CardHistoryView } from './card-history-view';
import {
	buildCardDeckGroups,
	cardStateKind,
	type CardDeckGroup,
	type CardListItem,
} from './cards-model';

export class CardsPage {
	private static readonly rowHeight = 52;
	private static readonly rowOverscan = 12;
	private parent: HTMLElement | null = null;
	private groups: CardDeckGroup[] = [];
	private selectedKey: string | null = null;
	private showDetail = false;
	private listScrollTop = 0;
	private listGeneration = 0;
	private now = new Date();
	private renderer = new Component();
	private history = new CardHistoryView();

	constructor(private app: App) {
		this.renderer.load();
	}

	render(
		parent: HTMLElement,
		snapshot: RememberSnapshot,
		selectedDeck: string,
	): void {
		this.parent = parent;
		this.now = new Date();
		this.history.reset(snapshot.reviewHistory);
		this.groups = buildCardDeckGroups(snapshot, selectedDeck, this.now);
		const items = this.groups.flatMap((group) => group.items);
		if (!items.some((item) => item.key === this.selectedKey)) {
			this.selectedKey = items[0]?.key ?? null;
			this.showDetail = false;
			this.listScrollTop = 0;
		}
		this.renderCurrent();
	}

	unload(): void {
		this.listGeneration++;
		this.renderer.unload();
		this.parent = null;
		this.groups = [];
		this.history.unload();
	}

	private renderCurrent(): void {
		const parent = this.parent;
		if (!parent) return;
		const generation = ++this.listGeneration;
		this.resetRenderer();
		parent.empty();
		const page = parent.createDiv({ cls: 'remember-cards-page' });
		page.toggleClass('is-detail', this.showDetail);
		const items = this.groups.flatMap((group) => group.items);
		if (items.length === 0) {
			page.createEl('p', { cls: 'remember-empty', text: STRINGS.cards.empty });
			return;
		}

		const list = page.createDiv({ cls: 'remember-card-list' });
		const rows = list.createDiv({ cls: 'remember-card-rows' });
		this.renderRows(rows, items, list, generation);
		const selected = items.find((item) => item.key === this.selectedKey) ?? items[0];
		this.renderDetail(page, selected);
	}

	private renderRows(
		rows: HTMLElement,
		items: CardListItem[],
		list: HTMLElement,
		generation: number,
	): void {
		const renderVisible = (scrollTop = list.scrollTop) => {
			this.listScrollTop = scrollTop;
			const first = Math.max(
				0,
				Math.floor(scrollTop / CardsPage.rowHeight) - CardsPage.rowOverscan,
			);
			const visible = Math.ceil((list.clientHeight || 600) / CardsPage.rowHeight);
			const end = Math.min(items.length, first + visible + CardsPage.rowOverscan * 2);
			rows.empty();
			if (first > 0) createRowSpacer(rows, first * CardsPage.rowHeight);
			for (const item of items.slice(first, end)) this.renderRow(rows, item);
			if (end < items.length) createRowSpacer(rows, (items.length - end) * CardsPage.rowHeight);
		};
		const savedScrollTop = this.listScrollTop;
		renderVisible(savedScrollTop);
		list.scrollTop = savedScrollTop;
		if (list.scrollTop !== savedScrollTop && isDisplayed(list)) {
			renderVisible(list.scrollTop);
		}
		let scheduled = false;
		list.addEventListener('scroll', () => {
			if (scheduled) return;
			scheduled = true;
			(list.ownerDocument.defaultView ?? window).requestAnimationFrame(() => {
				scheduled = false;
				if (generation !== this.listGeneration) return;
				renderVisible();
			});
		});
	}

	private renderRow(rows: HTMLElement, item: CardListItem): void {
		const row = rows.createEl('button', { cls: 'remember-card-row' });
		const selected = item.key === this.selectedKey;
		row.toggleClass('is-selected', selected);
		row.setAttribute('aria-current', selected ? 'true' : 'false');
		const copy = row.createSpan({ cls: 'remember-card-row-copy' });
		copy.createSpan({ cls: 'remember-card-row-front', text: preview(item.front) });
		copy.createSpan({
			cls: 'remember-card-row-source',
			text: `${baseName(item.path)} · ${siblingLabel(item)}`,
		});
		const availabilityElement = row.createSpan({
			cls: `remember-card-availability remember-card-availability-${item.availability}`,
			text: STRINGS.cards.availability[item.availability],
		});
		setTooltip(
			availabilityElement,
			STRINGS.cards.availabilityDescriptions[item.availability],
		);
		row.createSpan({ cls: 'remember-card-due', text: dueLabel(item, this.now) });
		row.addEventListener('click', () => {
			this.listScrollTop = rows.parentElement?.scrollTop ?? 0;
			if (this.selectedKey !== item.key) this.history.clear();
			this.selectedKey = item.key;
			this.showDetail = true;
			this.renderCurrent();
		});
	}

	private renderDetail(parent: HTMLElement, item: CardListItem): void {
		const detail = parent.createEl('article', { cls: 'remember-card-detail' });
		const header = detail.createDiv({ cls: 'remember-card-detail-header' });
		const back = header.createEl('button', { cls: 'clickable-icon remember-card-detail-back' });
		setIcon(back, 'arrow-left');
		back.setAttribute('aria-label', STRINGS.cards.backToList);
		back.addEventListener('click', () => {
			this.showDetail = false;
			this.renderCurrent();
		});
		header.createEl('h2', { text: STRINGS.cards.detailTitle });

		const scroll = detail.createDiv({ cls: 'remember-card-detail-scroll' });
		const metadata = scroll.createDiv({ cls: 'remember-card-metadata' });
		this.createSourceMetadata(metadata, item);
		createMetadata(metadata, STRINGS.cards.fields.sibling, siblingLabel(item));
		const availabilityValue = createMetadata(
			metadata,
			STRINGS.cards.fields.availability,
			STRINGS.cards.availability[item.availability],
		);
		availabilityValue.addClass(
			'remember-card-availability',
			`remember-card-availability-${item.availability}`,
		);
		setTooltip(
			availabilityValue,
			STRINGS.cards.availabilityDescriptions[item.availability],
		);
		const state = cardStateKind(item.state);
		const stateValue = createMetadata(
			metadata,
			STRINGS.cards.fields.state,
			STRINGS.cards.states[state],
		);
		setTooltip(stateValue, STRINGS.cards.stateDescriptions[state]);
		createMetadata(metadata, STRINGS.cards.fields.due, dueLabel(item, this.now));

		this.renderSide(scroll, STRINGS.cards.front, item.front, item.path);
		this.renderSide(scroll, STRINGS.cards.back, item.back, item.path);
		this.history.render(scroll, item);
	}

	private createSourceMetadata(parent: HTMLElement, card: CardListItem): void {
		const item = parent.createDiv({ cls: 'remember-card-metadata-item' });
		item.createSpan({ cls: 'remember-card-metadata-label', text: STRINGS.cards.fields.source });
		const link = item.createEl('a', {
			cls: 'remember-card-metadata-value remember-card-source-link internal-link',
			href: card.path,
			text: baseName(card.path),
		});
		link.dataset.href = card.path;
		link.setAttribute('aria-label', STRINGS.cards.openSource(card.path));
		setTooltip(link, card.path);
		link.addEventListener('click', (event) => {
			event.preventDefault();
			event.stopPropagation();
			void openCardDefinition(this.app, card);
		});
	}

	private renderSide(parent: HTMLElement, title: string, markdown: string, path: string): void {
		const section = parent.createEl('section', { cls: 'remember-card-detail-section' });
		section.createEl('h3', { text: title });
		const content = section.createDiv({ cls: 'remember-card-detail-markdown markdown-rendered' });
		void MarkdownRenderer.render(this.app, markdown, content, path, this.renderer);
	}

	private resetRenderer(): void {
		this.renderer.unload();
		this.renderer = new Component();
		this.renderer.load();
	}
}

function createRowSpacer(parent: HTMLElement, height: number): void {
	const spacer = parent.createDiv({ cls: 'remember-card-row-spacer' });
	spacer.style.height = `${height}px`;
}

function isDisplayed(element: HTMLElement): boolean {
	const view = element.ownerDocument.defaultView;
	return view === null || view.getComputedStyle(element).display !== 'none';
}

function createMetadata(parent: HTMLElement, label: string, value: string): HTMLElement {
	const item = parent.createDiv({ cls: 'remember-card-metadata-item' });
	item.createSpan({ cls: 'remember-card-metadata-label', text: label });
	return item.createSpan({ cls: 'remember-card-metadata-value', text: value });
}

function siblingLabel(item: CardListItem): string {
	if (item.sibling.kind === 'cloze') return STRINGS.cards.siblings.cloze(item.sibling.number);
	return STRINGS.cards.siblings[item.sibling.kind];
}

function dueLabel(item: CardListItem, now: Date): string {
	if (item.state === null) return STRINGS.cards.notScheduled;
	if (item.state.due.getTime() <= now.getTime()) return STRINGS.cards.dueNow;
	return STRINGS.cards.dueIn(formatInterval(now, item.state.due));
}

function preview(markdown: string): string {
	return (
		markdown
			.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
			.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
			.replace(/[*_~`>#|]/g, '')
			.replace(/\s+/g, ' ')
			.trim() || STRINGS.cards.emptyFront
	);
}

function baseName(path: string): string {
	return path.slice(path.lastIndexOf('/') + 1);
}
