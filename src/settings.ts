import { PluginSettingTab, type App, type SettingDefinitionItem } from 'obsidian';
import { STRINGS } from './i18n';
import type RememberPlugin from './main';

export interface RememberSettings {
	deckProperty: string;
	desiredRetention: number;
	burySiblings: boolean;
	limitNewCardsPerDay: boolean;
	newCardsPerDay: number;
}

export const DEFAULT_SETTINGS: RememberSettings = {
	deckProperty: 'deck',
	desiredRetention: 0.9,
	burySiblings: true,
	limitNewCardsPerDay: false,
	newCardsPerDay: 20,
};

export function parseSettings(value: unknown): RememberSettings {
	if (typeof value !== 'object' || value === null) return { ...DEFAULT_SETTINGS };
	const stored = value as Record<string, unknown>;
	return {
		deckProperty: typeof stored.deckProperty === 'string' ? stored.deckProperty : DEFAULT_SETTINGS.deckProperty,
		burySiblings:
			typeof stored.burySiblings === 'boolean' ? stored.burySiblings : DEFAULT_SETTINGS.burySiblings,
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
				name: STRINGS.settings.deckPropertyName,
				desc: STRINGS.settings.deckPropertyDescription,
				control: {
					type: 'text',
					key: 'deckProperty',
					defaultValue: DEFAULT_SETTINGS.deckProperty,
				},
			},
			{
				name: STRINGS.settings.burySiblingsName,
				desc: STRINGS.settings.burySiblingsDescription,
				control: {
					type: 'toggle',
					key: 'burySiblings',
					defaultValue: DEFAULT_SETTINGS.burySiblings,
				},
			},
			{
				name: STRINGS.settings.limitNewCardsName,
				desc: STRINGS.settings.limitNewCardsDescription,
				control: {
					type: 'toggle',
					key: 'limitNewCardsPerDay',
					defaultValue: DEFAULT_SETTINGS.limitNewCardsPerDay,
				},
			},
			{
				name: STRINGS.settings.newCardsName,
				desc: STRINGS.settings.newCardsDescription,
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
							: STRINGS.settings.newCardsValidation,
				},
			},
			{
				name: STRINGS.settings.desiredRetentionName,
				desc: STRINGS.settings.desiredRetentionDescription,
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
		} else if (key === 'burySiblings' && typeof value === 'boolean') {
			this.plugin.settings.burySiblings = value;
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
