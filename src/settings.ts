import { PluginSettingTab, type App, type SettingDefinitionItem } from 'obsidian';
import { STRINGS } from './i18n';
import type RememberPlugin from './main';

export interface RememberSettings {
	rootFolder: string;
	desiredRetention: number;
	rescheduleOnRetentionChange: boolean;
	burySiblings: boolean;
	limitNewCardsPerDay: boolean;
	newCardsPerDay: number;
	learnAhead: boolean;
	learnAheadMinutes: number;
}

export const DEFAULT_SETTINGS: RememberSettings = {
	rootFolder: 'Remember',
	desiredRetention: 0.9,
	rescheduleOnRetentionChange: true,
	burySiblings: true,
	limitNewCardsPerDay: false,
	newCardsPerDay: 20,
	learnAhead: true,
	learnAheadMinutes: 10,
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
		rescheduleOnRetentionChange:
			typeof stored.rescheduleOnRetentionChange === 'boolean'
				? stored.rescheduleOnRetentionChange
				: DEFAULT_SETTINGS.rescheduleOnRetentionChange,
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
		learnAhead:
			typeof stored.learnAhead === 'boolean' ? stored.learnAhead : DEFAULT_SETTINGS.learnAhead,
		learnAheadMinutes:
			typeof stored.learnAheadMinutes === 'number' &&
			Number.isInteger(stored.learnAheadMinutes) &&
			stored.learnAheadMinutes >= 1 &&
			stored.learnAheadMinutes <= 1440
				? stored.learnAheadMinutes
				: DEFAULT_SETTINGS.learnAheadMinutes,
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

export function effectiveLearnAheadMinutes(settings: RememberSettings): number | null {
	return settings.learnAhead ? settings.learnAheadMinutes : null;
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
				type: 'group',
				heading: STRINGS.settings.groups.general,
				items: [
					{
						name: STRINGS.settings.rootFolderName,
						desc: STRINGS.settings.rootFolderDescription,
						control: {
							type: 'text',
							key: 'rootFolder',
							defaultValue: DEFAULT_SETTINGS.rootFolder,
						},
					},
				],
			},
			{
				type: 'group',
				heading: STRINGS.settings.groups.scheduling,
				items: [
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
					{
						name: STRINGS.settings.rescheduleOnRetentionChangeName,
						desc: STRINGS.settings.rescheduleOnRetentionChangeDescription,
						control: {
							type: 'toggle',
							key: 'rescheduleOnRetentionChange',
							defaultValue: DEFAULT_SETTINGS.rescheduleOnRetentionChange,
						},
					},
				],
			},
			{
				type: 'group',
				heading: STRINGS.settings.groups.dailyLimits,
				items: [
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
				],
			},
			{
				type: 'group',
				heading: STRINGS.settings.groups.reviewSession,
				items: [
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
						name: STRINGS.settings.learnAheadName,
						desc: STRINGS.settings.learnAheadDescription,
						control: {
							type: 'toggle',
							key: 'learnAhead',
							defaultValue: DEFAULT_SETTINGS.learnAhead,
						},
					},
					{
						name: STRINGS.settings.learnAheadMinutesName,
						desc: STRINGS.settings.learnAheadMinutesDescription,
						control: {
							type: 'number',
							key: 'learnAheadMinutes',
							defaultValue: DEFAULT_SETTINGS.learnAheadMinutes,
							min: 1,
							max: 1440,
							step: 1,
							disabled: () => !this.plugin.settings.learnAhead,
							validate: (value) =>
								Number.isInteger(value) && value >= 1 && value <= 1440
									? undefined
									: STRINGS.settings.learnAheadMinutesValidation,
						},
					},
				],
			},
		];
	}

	override getControlValue(key: keyof RememberSettings): unknown {
		return this.plugin.settings[key];
	}

	override async setControlValue(key: keyof RememberSettings, value: unknown): Promise<void> {
		if (key === 'rootFolder' && typeof value === 'string') {
			this.plugin.settings.rootFolder = normalizeRootFolder(value) || DEFAULT_SETTINGS.rootFolder;
		} else if (key === 'rescheduleOnRetentionChange' && typeof value === 'boolean') {
			this.plugin.settings.rescheduleOnRetentionChange = value;
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
		} else if (key === 'learnAhead' && typeof value === 'boolean') {
			this.plugin.settings.learnAhead = value;
		} else if (
			key === 'learnAheadMinutes' &&
			typeof value === 'number' &&
			Number.isInteger(value) &&
			value >= 1 &&
			value <= 1440
		) {
			this.plugin.settings.learnAheadMinutes = value;
		} else {
			return;
		}
		await this.plugin.saveSettings();
		if (key === 'limitNewCardsPerDay' || key === 'learnAhead') this.update();
	}

}
