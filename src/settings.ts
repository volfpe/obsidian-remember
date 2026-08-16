import { PluginSettingTab, type App, type SettingDefinitionItem } from 'obsidian';
import { STRINGS } from './i18n';
import type RememberPlugin from './main';

export interface RememberSettings {
	rootFolder: string;
	desiredRetention: number;
	burySiblings: boolean;
	limitNewCardsPerDay: boolean;
	newCardsPerDay: number;
}

export const DEFAULT_SETTINGS: RememberSettings = {
	rootFolder: 'Remember',
	desiredRetention: 0.9,
	burySiblings: true,
	limitNewCardsPerDay: false,
	newCardsPerDay: 20,
};

/** A vault-relative folder path without empty or dot segments. */
export function normalizeRootFolder(value: string): string {
	const segments = value
		.split('/')
		.map((segment) => segment.trim())
		.filter((segment) => segment !== '' && segment !== '.' && segment !== '..');
	return segments.join('/');
}

export function parseSettings(value: unknown): RememberSettings {
	if (typeof value !== 'object' || value === null) return { ...DEFAULT_SETTINGS };
	const stored = value as Record<string, unknown>;
	return {
		rootFolder:
			typeof stored.rootFolder === 'string' && normalizeRootFolder(stored.rootFolder) !== ''
				? normalizeRootFolder(stored.rootFolder)
				: DEFAULT_SETTINGS.rootFolder,
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
				name: STRINGS.settings.rootFolderName,
				desc: STRINGS.settings.rootFolderDescription,
				control: {
					type: 'text',
					key: 'rootFolder',
					defaultValue: DEFAULT_SETTINGS.rootFolder,
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
		if (key === 'rootFolder' && typeof value === 'string') {
			this.plugin.settings.rootFolder = normalizeRootFolder(value) || DEFAULT_SETTINGS.rootFolder;
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
