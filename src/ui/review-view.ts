import { ItemView, Notice, setIcon, setTooltip, type IconName, type WorkspaceLeaf } from 'obsidian';
import { isDescendantDeck } from '../core/queue';
import { makeFsrs } from '../core/scheduler';
import { STRINGS } from '../i18n';
import type { RememberSettings } from '../settings';
import { CardsPage } from './cards/cards-page';
import { REMEMBER_VIEW_DEFINITION } from './remember-view-definition';
import {
	RememberSnapshotRepository,
	type RememberSnapshot,
} from './remember-snapshot';
import { ReviewSession } from './review-session';
import { displayDeck, renderDeckChooser, renderDeckStudyPage } from './study-page';

type RememberSection = 'study' | 'cards' | 'statistics';
const IMPORT_ENABLED = false;
const STATISTICS_TAB_ENABLED = false;

export class ReviewView extends ItemView {
	private snapshotRepository: RememberSnapshotRepository;
	private snapshot: RememberSnapshot | null = null;
	private section: RememberSection = 'study';
	private selectedDeck: string | null = null;
	private contentTitleEl: HTMLElement | null = null;
	private bodyEl: HTMLElement | null = null;
	private backToDecksButtonEl: HTMLButtonElement | null = null;
	private navEl: HTMLElement | null = null;
	private refreshButtonEl: HTMLButtonElement | null = null;
	private refreshGeneration = 0;
	private startingSession = false;
	private cardsPage: CardsPage | null = null;
	private reviewSession: ReviewSession | null = null;

	constructor(
		leaf: WorkspaceLeaf,
		private settings: RememberSettings,
		private openSettings: () => void = () => undefined,
		private legacyMigration: LegacyMigrationPort | null = null,
	) {
		super(leaf);
		this.navigation = false;
		const fsrs = makeFsrs(settings.desiredRetention);
		this.snapshotRepository = new RememberSnapshotRepository(this.app, settings, fsrs);
		this.reviewSession = new ReviewSession(
			this.app,
			settings,
			fsrs,
			() => {
				this.startingSession = false;
				return this.showStudy();
			},
		);
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
		this.backToDecksButtonEl = header.createEl('button', {
			cls: 'clickable-icon remember-back-to-decks',
		});
		setIcon(this.backToDecksButtonEl, 'arrow-left');
		setTooltip(this.backToDecksButtonEl, STRINGS.study.backToDecks);
		this.backToDecksButtonEl.setAttribute('aria-label', STRINGS.study.backToDecks);
		this.backToDecksButtonEl.addEventListener('click', () => this.clearDeck());
		this.contentTitleEl = header.createDiv({ cls: 'remember-view-title' });
		this.refreshButtonEl = header.createEl('button', {
			cls: 'clickable-icon remember-refresh',
		});
		setIcon(this.refreshButtonEl, 'refresh-cw');
		setTooltip(this.refreshButtonEl, STRINGS.study.refresh);
		this.refreshButtonEl.setAttribute('aria-label', STRINGS.study.refresh);
		this.refreshButtonEl.addEventListener('click', () => void this.refreshData(true));
		const settingsButton = header.createEl('button', {
			cls: 'clickable-icon remember-settings',
		});
		setIcon(settingsButton, 'settings');
		setTooltip(settingsButton, STRINGS.study.openSettings);
		settingsButton.setAttribute('aria-label', STRINGS.study.openSettings);
		settingsButton.addEventListener('click', this.openSettings);
		if (IMPORT_ENABLED) this.renderImportButton(header);
		this.navEl = canvas.createDiv({ cls: 'remember-view-nav' });
		this.bodyEl = canvas.createDiv({ cls: 'remember-view-content' });
		this.cardsPage = new CardsPage(this.app);
		this.reviewSession?.load();
		this.renderDeckContext();
		this.renderNavigation();
		this.renderCurrentSection();
		await this.refreshData();
		void this.offerLegacyMigration();
	}

	/** Legacy inline-card migration; the hook disappears with src/migration/. */
	private async offerLegacyMigration(): Promise<void> {
		const migration = this.legacyMigration;
		if (!migration) return;
		try {
			if (!(await migration.hasLegacyCards())) return;
			migration.offer(() => void this.refreshData(true));
		} catch (error) {
			console.warn('Remember: legacy card check failed', error);
		}
	}

	private renderImportButton(header: HTMLElement): void {
		const importButton = header.createEl('button', { cls: 'remember-import' });
		setIcon(importButton.createSpan({ cls: 'remember-import-icon' }), 'download');
		importButton.createSpan({ cls: 'remember-import-label', text: STRINGS.study.import });
		setTooltip(importButton, STRINGS.study.importComingSoon);
		importButton.addEventListener('click', () => new Notice(STRINGS.study.importComingSoon));
	}

	onClose(): Promise<void> {
		this.refreshGeneration++;
		this.cardsPage?.unload();
		this.reviewSession?.unload();
		this.contentTitleEl = null;
		this.bodyEl = null;
		this.backToDecksButtonEl = null;
		this.navEl = null;
		this.refreshButtonEl = null;
		this.snapshot = null;
		this.selectedDeck = null;
		this.contentEl.empty();
		this.contentEl.removeClass('remember-session-active');
		this.contentEl.removeClass('remember-view');
		return Promise.resolve();
	}

	private get body(): HTMLElement {
		return this.bodyEl ?? this.contentEl;
	}

	private renderNavigation(): void {
		if (!this.navEl) return;
		this.navEl.empty();
		this.navEl.toggleClass('is-hidden', this.selectedDeck === null);
		if (this.selectedDeck === null) return;
		const sections: [RememberSection, string][] = [
			['study', STRINGS.study.tabs.study],
			['cards', STRINGS.study.tabs.cards],
		];
		if (STATISTICS_TAB_ENABLED) {
			sections.push(['statistics', STRINGS.study.tabs.statistics]);
		}
		for (const [section, label] of sections) {
			const button = this.navEl.createEl('button', {
				cls: 'remember-view-nav-item',
				text: label,
			});
			const active = section === this.section;
			button.toggleClass('is-active', active);
			button.setAttribute('aria-current', active ? 'page' : 'false');
			button.addEventListener('click', () => this.showSection(section));
		}
	}

	private renderDeckContext(): void {
		const hasSelectedDeck = this.selectedDeck !== null;
		this.backToDecksButtonEl?.toggleClass('is-hidden', !hasSelectedDeck);
		this.contentTitleEl?.toggleClass('is-hidden', !hasSelectedDeck);
		this.contentTitleEl?.setText(this.selectedDeck === null ? '' : displayDeck(this.selectedDeck));
	}

	private selectDeck(deck: string): void {
		if (this.startingSession || this.reviewSession?.active) return;
		this.selectedDeck = deck;
		this.section = 'study';
		this.renderDeckContext();
		this.renderNavigation();
		this.renderCurrentSection();
	}

	private clearDeck(): void {
		if (this.startingSession || this.reviewSession?.active) return;
		this.selectedDeck = null;
		this.section = 'study';
		this.renderDeckContext();
		this.renderNavigation();
		this.renderCurrentSection();
	}

	private showSection(section: RememberSection): void {
		if (this.selectedDeck === null || this.startingSession || this.reviewSession?.active) return;
		this.section = section;
		this.renderNavigation();
		this.renderCurrentSection();
	}

	private renderCurrentSection(): void {
		const snapshot = this.snapshot;
		if (snapshot === null) {
			this.body.empty();
			this.body.createEl('p', { cls: 'remember-empty', text: STRINGS.study.loading });
			return;
		}
		const deck = this.selectedDeck;
		if (deck === null) {
			renderDeckChooser(
				this.body,
				snapshot,
				this.settings,
				(selected) => this.selectDeck(selected),
				snapshot.loadedAt,
			);
			return;
		}
		if (this.section === 'study') {
			renderDeckStudyPage(
				this.body,
				snapshot,
				this.settings,
				deck,
				() => void this.startSession(),
				snapshot.loadedAt,
			);
			return;
		}
		if (this.section === 'cards') {
			this.cardsPage?.render(this.body, snapshot, deck, this.settings);
			return;
		}
		this.body.empty();
		const page = this.body.createDiv({ cls: 'remember-placeholder-page' });
		page.createEl('h2', { text: STRINGS.study.tabs.statistics });
		page.createEl('p', { text: STRINGS.study.placeholders.statistics });
	}

	private async refreshData(notifyWhenComplete = false): Promise<void> {
		if (this.startingSession || this.reviewSession?.active) return;
		const generation = ++this.refreshGeneration;
		this.setRefreshing(true);
		try {
			const snapshot = await this.snapshotRepository.load();
			if (generation !== this.refreshGeneration || this.reviewSession?.active) return;
			this.snapshot = snapshot;
			this.reportSnapshotIssues(snapshot);
			const selectedDeck = this.selectedDeck;
			if (
				selectedDeck !== null &&
				!snapshot.cards.some((card) => isDescendantDeck(card.deck, selectedDeck))
			) {
				this.selectedDeck = null;
				this.section = 'study';
			}
			this.renderDeckContext();
			this.renderNavigation();
			this.renderCurrentSection();
			if (notifyWhenComplete) new Notice(STRINGS.notices.refreshComplete);
		} catch (error) {
			if (generation !== this.refreshGeneration) return;
			console.warn('Remember: refresh failed', error);
			new Notice(STRINGS.notices.couldNotRefresh(error));
			if (this.snapshot === null) {
				this.body.empty();
				this.body.createEl('p', { cls: 'remember-empty', text: STRINGS.study.refreshFailed });
			}
		} finally {
			if (generation === this.refreshGeneration) this.setRefreshing(false);
		}
	}

	private setRefreshing(refreshing: boolean): void {
		if (this.refreshButtonEl) {
			this.refreshButtonEl.disabled = refreshing;
			this.refreshButtonEl.toggleClass('is-loading', refreshing);
		}
	}

	private async startSession(): Promise<void> {
		if (this.startingSession || this.reviewSession?.active) return;
		const deck = this.selectedDeck;
		if (deck === null) return;
		const session = this.reviewSession;
		const snapshot = this.snapshot;
		if (!session || !snapshot) return;
		this.startingSession = true;
		this.refreshGeneration++;
		this.contentEl.addClass('remember-session-active');
		this.body.empty();
		this.body.createEl('p', { cls: 'remember-empty', text: STRINGS.review.preparing });
		try {
			await session.start(this.body, deck, snapshot);
		} catch (error) {
			console.warn('Remember: could not start review session', error);
			new Notice(STRINGS.notices.couldNotStartSession(error));
			await this.showStudy();
		} finally {
			this.startingSession = false;
		}
	}

	private async showStudy(): Promise<void> {
		this.section = 'study';
		this.contentEl.removeClass('remember-session-active');
		this.renderDeckContext();
		this.renderNavigation();
		this.renderCurrentSection();
		await this.refreshData();
	}

	private reportSnapshotIssues(snapshot: RememberSnapshot): void {
		for (const duplicate of snapshot.issues.duplicates) {
			new Notice(STRINGS.notices.duplicateCardId(duplicate.path));
		}
	}
}

/** Implemented by src/migration/ for the one-time legacy inline-card migration. */
export interface LegacyMigrationPort {
	hasLegacyCards(): Promise<boolean>;
	/** Shows the migration prompt; calls onMigrated after a successful migration. */
	offer(onMigrated: () => void): void;
}
