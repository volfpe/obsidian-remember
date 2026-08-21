import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from './settings';
import {
	DeckSettingsIndex,
	isDeckSettingsPath,
	parseDeckSettings,
} from './deck-settings';

describe('deck settings', () => {
	it('parses supported values and ignores invalid values', () => {
		expect(
			parseDeckSettings({
				'remember-desired-retention': ' 0.95 ',
				'remember-bury-siblings': false,
				'remember-limit-new-cards-per-day': 'yes',
				'remember-new-cards-per-day': -1,
				'remember-learn-ahead': true,
				'remember-learn-ahead-minutes': '5',
			}),
		).toEqual({
			desiredRetention: 0.95,
			burySiblings: false,
			learnAhead: true,
			learnAheadMinutes: 5,
		});

		expect(
			parseDeckSettings({
				'remember-desired-retention': 'not a number',
				'remember-new-cards-per-day': '2.5',
				'remember-learn-ahead-minutes': '',
				'remember-learn-ahead': 'false',
			}),
		).toEqual({});
	});

	it('inherits each property from the closest source', () => {
		const index = new DeckSettingsIndex(
			{ ...DEFAULT_SETTINGS, newCardsPerDay: 20 },
			new Map([
				['', { learnAhead: false }],
				['Language', { newCardsPerDay: 12, burySiblings: false }],
				['Language/Spanish', { newCardsPerDay: 5 }],
			]),
			new Map([
				['', 'Remember/_remember.md'],
				['Language', 'Remember/Language/_remember.md'],
				['Language/Spanish', 'Remember/Language/Spanish/_remember.md'],
			]),
		);

		const effective = index.resolve('Language/Spanish/Verbs');
		expect(effective.values).toMatchObject({
			newCardsPerDay: 5,
			burySiblings: false,
			learnAhead: false,
			desiredRetention: DEFAULT_SETTINGS.desiredRetention,
		});
		expect(effective.sources.newCardsPerDay).toMatchObject({
			kind: 'deck',
			deck: 'Language/Spanish',
		});
		expect(effective.sources.burySiblings).toMatchObject({ kind: 'deck', deck: 'Language' });
		expect(effective.sources.learnAhead).toMatchObject({ kind: 'deck', deck: '' });
		expect(effective.sources.desiredRetention).toEqual({ kind: 'global' });
	});

	it('recognizes only the reserved settings filename', () => {
		expect(isDeckSettingsPath('Remember/Spanish/_remember.md')).toBe(true);
		expect(isDeckSettingsPath('Remember/Spanish/my_remember.md')).toBe(false);
	});
});
