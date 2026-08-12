import { normalizePath, PluginSettingTab, Setting, type App } from 'obsidian';
import type RememberPlugin from './main';

export interface RememberSettings {
	deckProperty: string;
	logFolder: string;
	desiredRetention: number;
}

export const DEFAULT_SETTINGS: RememberSettings = {
	deckProperty: 'deck',
	logFolder: '_remember',
	desiredRetention: 0.9,
};

export class RememberSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private plugin: RememberPlugin,
	) {
		super(app, plugin);
	}

	display(): void {
		this.containerEl.empty();

		new Setting(this.containerEl)
			.setName('Deck property name')
			.setDesc('Frontmatter property that assigns a note to a deck, e.g. "deck: lang/spanish".')
			.addText((text) =>
				text.setValue(this.plugin.settings.deckProperty).onChange(async (value) => {
					this.plugin.settings.deckProperty = value.trim() || DEFAULT_SETTINGS.deckProperty;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(this.containerEl)
			.setName('Log folder')
			.setDesc('Vault folder holding the reviews-*.jsonl event logs.')
			.addText((text) =>
				text.setValue(this.plugin.settings.logFolder).onChange(async (value) => {
					this.plugin.settings.logFolder = value.trim() === '' ? DEFAULT_SETTINGS.logFolder : normalizePath(value.trim());
					await this.plugin.saveSettings();
				}),
			);

		new Setting(this.containerEl)
			.setName('Desired retention')
			.setDesc('Fsrs target recall probability. Higher means shorter intervals.')
			.addSlider((slider) =>
				slider
					.setLimits(0.7, 0.99, 0.01)
					.setValue(this.plugin.settings.desiredRetention)
					.onChange(async (value) => {
						this.plugin.settings.desiredRetention = value;
						await this.plugin.saveSettings();
					}),
			);
	}
}
