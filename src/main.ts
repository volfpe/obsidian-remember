import { Plugin } from 'obsidian';
import { STRINGS } from './i18n';
import { cleanOwnConflictCopies } from './log';
import { DEFAULT_SETTINGS, RememberSettingTab, type RememberSettings } from './settings';
import { hideTokens } from './ui/hide-tokens';
import { ReviewModal } from './ui/review-modal';

export default class RememberPlugin extends Plugin {
	settings!: RememberSettings;

	async onload(): Promise<void> {
		await this.loadSettings();
		this.addRibbonIcon('brain', STRINGS.plugin.reviewRibbon, () => this.openReview());
		this.addCommand({ id: 'review', name: STRINGS.plugin.reviewCommand, callback: () => this.openReview() });
		this.addSettingTab(new RememberSettingTab(this.app, this));
		this.registerEditorExtension(hideTokens);
		this.app.workspace.onLayoutReady(() => {
			cleanOwnConflictCopies(this.app).catch((error) =>
				console.error('Remember: sync-conflict cleanup failed', error),
			);
		});
	}

	openReview(): void {
		new ReviewModal(this.app, this.settings).open();
	}

	async loadSettings(): Promise<void> {
		this.settings = parseSettings(await this.loadData());
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}
}

function parseSettings(value: unknown): RememberSettings {
	if (typeof value !== 'object' || value === null) return { ...DEFAULT_SETTINGS };
	const stored = value as Record<string, unknown>;
	return {
		deckProperty: typeof stored.deckProperty === 'string' ? stored.deckProperty : DEFAULT_SETTINGS.deckProperty,
		limitNewCardsPerDay:
			typeof stored.limitNewCardsPerDay === 'boolean'
				? stored.limitNewCardsPerDay
				: DEFAULT_SETTINGS.limitNewCardsPerDay,
		newCardsPerDay:
			typeof stored.newCardsPerDay === 'number' &&
			Number.isInteger(stored.newCardsPerDay) &&
			stored.newCardsPerDay >= 0 &&
			stored.newCardsPerDay <= 9999
				? stored.newCardsPerDay
				: DEFAULT_SETTINGS.newCardsPerDay,
		desiredRetention:
			typeof stored.desiredRetention === 'number' &&
			Number.isFinite(stored.desiredRetention) &&
			stored.desiredRetention >= 0.7 &&
			stored.desiredRetention <= 0.99
				? stored.desiredRetention
				: DEFAULT_SETTINGS.desiredRetention,
	};
}
