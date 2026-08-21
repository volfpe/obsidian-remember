import {
	isDesiredRetention,
	isLearnAheadMinutes,
	isNewCardsPerDay,
	type RememberSettings,
} from './settings';

export const DECK_SETTINGS_FILE = '_remember.md';

export const DECK_SETTING_PROPERTIES = {
	desiredRetention: 'remember-desired-retention',
	burySiblings: 'remember-bury-siblings',
	limitNewCardsPerDay: 'remember-limit-new-cards-per-day',
	newCardsPerDay: 'remember-new-cards-per-day',
	learnAhead: 'remember-learn-ahead',
	learnAheadMinutes: 'remember-learn-ahead-minutes',
} as const;

export type DeckSettingKey = keyof typeof DECK_SETTING_PROPERTIES;
export type DeckSettings = Pick<RememberSettings, DeckSettingKey>;
export type DeckSettingsOverride = Partial<DeckSettings>;

export type DeckSettingSource =
	| { kind: 'global' }
	| { kind: 'deck'; deck: string; path: string };

export interface EffectiveDeckSettings {
	values: DeckSettings;
	sources: Record<DeckSettingKey, DeckSettingSource>;
}

const DECK_SETTING_KEYS = Object.keys(DECK_SETTING_PROPERTIES) as DeckSettingKey[];

/** Reads only valid supported values. Missing and invalid values inherit. */
export function parseDeckSettings(
	frontmatter: Record<string, unknown> | null | undefined,
): DeckSettingsOverride {
	if (!frontmatter) return {};
	const parsed: DeckSettingsOverride = {};
	for (const key of DECK_SETTING_KEYS) {
		const value = coerceDeckSetting(key, frontmatter[DECK_SETTING_PROPERTIES[key]]);
		if (isValidDeckSetting(key, value)) setDeckSetting(parsed, key, value);
	}
	return parsed;
}

export function isDeckSettingsPath(path: string): boolean {
	return path === DECK_SETTINGS_FILE || path.endsWith(`/${DECK_SETTINGS_FILE}`);
}

/** Immutable lookup built once with the rest of the Remember snapshot. */
export class DeckSettingsIndex {
	private readonly cache = new Map<string, EffectiveDeckSettings>();
	private readonly overrides: ReadonlyMap<string, DeckSettingsOverride>;
	private readonly paths: ReadonlyMap<string, string>;

	constructor(
		global: RememberSettings,
		overrides: ReadonlyMap<string, DeckSettingsOverride> = new Map(),
		paths: ReadonlyMap<string, string> = new Map(),
	) {
		this.overrides = new Map(overrides);
		this.paths = new Map(paths);
		const values = pickDeckSettings(global);
		const sources = Object.fromEntries(
			DECK_SETTING_KEYS.map((key) => [key, { kind: 'global' }]),
		) as Record<DeckSettingKey, DeckSettingSource>;
		this.cache.set('', this.applyOverride('', { values, sources }));
	}

	resolve(deck: string): EffectiveDeckSettings {
		const cached = this.cache.get(deck);
		if (cached) return cached;
		const separator = deck.lastIndexOf('/');
		const parent = separator === -1 ? '' : deck.slice(0, separator);
		const effective = this.applyOverride(deck, this.resolve(parent));
		this.cache.set(deck, effective);
		return effective;
	}

	private applyOverride(deck: string, inherited: EffectiveDeckSettings): EffectiveDeckSettings {
		const override = this.overrides.get(deck);
		if (!override || Object.keys(override).length === 0) return inherited;
		const values = { ...inherited.values };
		const sources = { ...inherited.sources };
		const path = this.paths.get(deck) ?? (deck === '' ? DECK_SETTINGS_FILE : `${deck}/${DECK_SETTINGS_FILE}`);
		for (const key of DECK_SETTING_KEYS) {
			const value = override[key];
			if (value === undefined) continue;
			setDeckSetting(values, key, value);
			sources[key] = { kind: 'deck', deck, path };
		}
		return { values, sources };
	}
}

function pickDeckSettings(settings: RememberSettings): DeckSettings {
	return {
		desiredRetention: settings.desiredRetention,
		burySiblings: settings.burySiblings,
		limitNewCardsPerDay: settings.limitNewCardsPerDay,
		newCardsPerDay: settings.newCardsPerDay,
		learnAhead: settings.learnAhead,
		learnAheadMinutes: settings.learnAheadMinutes,
	};
}

function coerceDeckSetting(key: DeckSettingKey, value: unknown): unknown {
	if (
		(key === 'desiredRetention' || key === 'newCardsPerDay' || key === 'learnAheadMinutes') &&
		typeof value === 'string' &&
		value.trim() !== ''
	) {
		return Number(value);
	}
	if (
		(key === 'burySiblings' || key === 'limitNewCardsPerDay' || key === 'learnAhead') &&
		typeof value === 'string'
	) {
		const normalized = value.trim().toLowerCase();
		if (normalized === 'true') return true;
		if (normalized === 'false') return false;
	}
	return value;
}

function isValidDeckSetting<K extends DeckSettingKey>(key: K, value: unknown): value is DeckSettings[K] {
	switch (key) {
		case 'desiredRetention':
			return isDesiredRetention(value);
		case 'newCardsPerDay':
			return isNewCardsPerDay(value);
		case 'learnAheadMinutes':
			return isLearnAheadMinutes(value);
		case 'burySiblings':
		case 'limitNewCardsPerDay':
		case 'learnAhead':
			return typeof value === 'boolean';
	}
}

/** Keeps indexed assignment type-safe for the correlated key and value. */
function setDeckSetting<K extends DeckSettingKey>(
	target: Partial<DeckSettings>,
	key: K,
	value: DeckSettings[K],
): void {
	Object.assign(target, { [key]: value });
}
