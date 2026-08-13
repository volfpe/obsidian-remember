import { PluginSettingTab, type App, type SettingDefinitionItem } from 'obsidian';
import type RememberPlugin from './main';

export interface RememberSettings {
	deckProperty: string;
	desiredRetention: number;
}

export const DEFAULT_SETTINGS: RememberSettings = {
	deckProperty: 'deck',
	desiredRetention: 0.9,
};

export class RememberSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private plugin: RememberPlugin,
	) {
		super(app, plugin);
	}

	getSettingDefinitions(): SettingDefinitionItem<keyof RememberSettings>[] {
		return [
			{
				name: 'Deck property name',
				desc: 'Frontmatter property that assigns a note to a deck, e.g. "deck: lang/spanish".',
				control: {
					type: 'text',
					key: 'deckProperty',
					defaultValue: DEFAULT_SETTINGS.deckProperty,
				},
			},
			{
				name: 'Desired retention',
				desc: 'Fsrs target recall probability. Higher means shorter intervals.',
				control: {
					type: 'slider',
					key: 'desiredRetention',
					defaultValue: DEFAULT_SETTINGS.desiredRetention,
					min: 0.7,
					max: 0.99,
					step: 0.01,
				},
			},
		];
	}

	override getControlValue(key: keyof RememberSettings): unknown {
		return this.plugin.settings[key];
	}

	override async setControlValue(key: keyof RememberSettings, value: unknown): Promise<void> {
		if (key === 'deckProperty' && typeof value === 'string') {
			this.plugin.settings.deckProperty = value.trim() || DEFAULT_SETTINGS.deckProperty;
		} else if (key === 'desiredRetention' && typeof value === 'number') {
			this.plugin.settings.desiredRetention = value;
		} else {
			return;
		}
		await this.plugin.saveSettings();
	}

}
