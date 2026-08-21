import type {
	DeckSettingKey,
	DeckSettingSource,
	DeckSettingsIndex,
} from '../deck-settings';
import { STRINGS } from '../i18n';

interface SettingCopy {
	key: DeckSettingKey;
	name: string;
	description: string;
}

export function renderDeckSettingsPage(
	parent: HTMLElement,
	settings: DeckSettingsIndex,
	deck: string,
): void {
	parent.empty();
	const effective = settings.resolve(deck);
	const page = parent.createDiv({ cls: 'remember-deck-settings-page' });
	const list = page.createDiv({ cls: 'remember-deck-settings-list' });

	for (const item of settingCopy()) {
		const row = list.createDiv({ cls: 'remember-deck-setting' });
		const info = row.createDiv({ cls: 'remember-deck-setting-info' });
		info.createDiv({ cls: 'remember-deck-setting-name', text: item.name });
		info.createDiv({ cls: 'remember-deck-setting-description', text: item.description });
		const result = row.createDiv({ cls: 'remember-deck-setting-result' });
		result.createDiv({
			cls: 'remember-deck-setting-value',
			text: formatValue(item.key, effective.values[item.key]),
		});
		result.createDiv({
			cls: 'remember-deck-setting-source',
			text: formatSource(effective.sources[item.key]),
		});
	}
}

function settingCopy(): SettingCopy[] {
	return [
		{
			key: 'desiredRetention',
			name: STRINGS.settings.desiredRetentionName,
			description: STRINGS.settings.desiredRetentionDescription,
		},
		{
			key: 'burySiblings',
			name: STRINGS.settings.burySiblingsName,
			description: STRINGS.settings.burySiblingsDescription,
		},
		{
			key: 'limitNewCardsPerDay',
			name: STRINGS.settings.limitNewCardsName,
			description: STRINGS.settings.limitNewCardsDescription,
		},
		{
			key: 'newCardsPerDay',
			name: STRINGS.settings.newCardsName,
			description: STRINGS.settings.newCardsDescription,
		},
		{
			key: 'learnAhead',
			name: STRINGS.settings.learnAheadName,
			description: STRINGS.settings.learnAheadDescription,
		},
		{
			key: 'learnAheadMinutes',
			name: STRINGS.settings.learnAheadMinutesName,
			description: STRINGS.settings.learnAheadMinutesDescription,
		},
	];
}

function formatValue(key: DeckSettingKey, value: number | boolean): string {
	if (typeof value === 'boolean') return value ? STRINGS.deckSettings.enabled : STRINGS.deckSettings.disabled;
	if (key === 'desiredRetention') return `${Math.round(value * 100)}%`;
	return String(value);
}

function formatSource(source: DeckSettingSource): string {
	return source.kind === 'global'
		? STRINGS.deckSettings.globalSource
		: STRINGS.deckSettings.deckSource(source.path);
}
