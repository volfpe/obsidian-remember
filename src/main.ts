import { Plugin, type App } from 'obsidian';
import { STRINGS } from './i18n';
// One-time card-format migrations; delete these imports with src/migration/.
import { hideTokens } from './migration/hide-tokens';
import { CardMigrations } from './migration/card-migrations';
import { ClozeSyntaxMigration } from './migration/cloze-syntax-migration';
import { LegacyMigration } from './migration/legacy-migration';
import { parseSettings, RememberSettingTab, type RememberSettings } from './settings';
import { AddCardModal } from './ui/add-card-modal';
import { REMEMBER_VIEW_DEFINITION } from './ui/remember-view-definition';
import { ReviewView } from './ui/review-view';
import { TransientSingletonViewHost } from './ui/transient-singleton-view-host';

export default class RememberPlugin extends Plugin {
	settings!: RememberSettings;
	private rememberViewHost!: TransientSingletonViewHost;

	async onload(): Promise<void> {
		await this.loadSettings();
		const legacyMigration = new LegacyMigration(
			this.app,
			() => this.settings.rootFolder,
			() => this.loadData(),
		);
		const cardMigrations = new CardMigrations([
			legacyMigration,
			new ClozeSyntaxMigration(this.app, () => this.settings.rootFolder),
		]);
		this.rememberViewHost = new TransientSingletonViewHost(
			this.app.workspace,
			REMEMBER_VIEW_DEFINITION,
		);
		this.rememberViewHost.install(
			this,
			(leaf) => new ReviewView(leaf, this.settings, () => this.openSettings(), cardMigrations),
		);
		this.addRibbonIcon(REMEMBER_VIEW_DEFINITION.icon, STRINGS.plugin.openRibbon, () => void this.openReview());
		this.addRibbonIcon('copy-plus', STRINGS.plugin.newCardRibbon, () => this.openAddCard());
		this.addCommand({
			id: 'open',
			name: STRINGS.plugin.openCommand,
			callback: () => void this.openReview(),
		});
		this.addCommand({
			id: 'new-card',
			name: STRINGS.plugin.newCardCommand,
			callback: () => this.openAddCard(),
		});
		this.addSettingTab(new RememberSettingTab(this.app, this));
		this.registerEditorExtension(hideTokens);
	}

	async openReview(): Promise<void> {
		try {
			await this.rememberViewHost.open();
		} catch (error) {
			console.error('Remember: could not open the review view', error);
		}
	}

	openAddCard(): void {
		new AddCardModal(this.app, this.settings, null, () => this.refreshOpenReview()).open();
	}

	private async refreshOpenReview(): Promise<void> {
		const views = this.app.workspace
			.getLeavesOfType(REMEMBER_VIEW_DEFINITION.type)
			.map((leaf) => leaf.view)
			.filter((view): view is ReviewView => view instanceof ReviewView);
		await Promise.all(views.map((view) => view.refresh()));
	}

	async loadSettings(): Promise<void> {
		this.settings = parseSettings(await this.loadData());
	}

	async saveSettings(): Promise<void> {
		// Unknown stored keys survive (the legacy deckProperty is read by src/migration/;
		// save plain settings again once that folder is deleted).
		const stored: unknown = await this.loadData();
		const base = typeof stored === 'object' && stored !== null ? stored : {};
		await this.saveData({ ...base, ...this.settings });
	}

	private openSettings(): void {
		const settings = (this.app as AppWithSettings).setting;
		settings.open();
		settings.openTabById(this.manifest.id);
	}
}

interface AppWithSettings extends App {
	setting: {
		open(): void;
		openTabById(id: string): void;
	};
}
