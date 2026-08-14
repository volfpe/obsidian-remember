import { PluginSettingTab, type App, type SettingDefinitionItem } from 'obsidian';
import type RememberPlugin from './main';

export interface RememberSettings {
	deckProperty: string;
	desiredRetention: number;
	limitNewCardsPerDay: boolean;
	newCardsPerDay: number;
}

export const DEFAULT_SETTINGS: RememberSettings = {
	deckProperty: 'deck',
	desiredRetention: 0.9,
	limitNewCardsPerDay: false,
	newCardsPerDay: 20,
};

export function effectiveNewCardsPerDay(settings: RememberSettings): number {
	return settings.limitNewCardsPerDay ? settings.newCardsPerDay : Number.POSITIVE_INFINITY;
}

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
				name: 'Limit new cards per day',
				desc: 'When enabled, hold unseen card directions for future days after the daily limit is reached.',
				control: {
					type: 'toggle',
					key: 'limitNewCardsPerDay',
					defaultValue: DEFAULT_SETTINGS.limitNewCardsPerDay,
				},
			},
			{
				name: 'New cards per day',
				desc: 'Maximum number of never-reviewed card directions introduced from the selected deck each day.',
				control: {
					type: 'number',
					key: 'newCardsPerDay',
					defaultValue: DEFAULT_SETTINGS.newCardsPerDay,
					min: 0,
					max: 9999,
					step: 1,
					disabled: () => !this.plugin.settings.limitNewCardsPerDay,
					validate: (value) =>
						Number.isInteger(value) && value >= 0 && value <= 9999
							? undefined
							: 'Enter a whole number from 0 to 9999.',
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
		} else if (key === 'limitNewCardsPerDay' && typeof value === 'boolean') {
			this.plugin.settings.limitNewCardsPerDay = value;
		} else if (
			key === 'newCardsPerDay' &&
			typeof value === 'number' &&
			Number.isInteger(value) &&
			value >= 0 &&
			value <= 9999
		) {
			this.plugin.settings.newCardsPerDay = value;
		} else if (key === 'desiredRetention' && typeof value === 'number') {
			this.plugin.settings.desiredRetention = value;
		} else {
			return;
		}
		await this.plugin.saveSettings();
		if (key === 'limitNewCardsPerDay') this.update();
	}

}
