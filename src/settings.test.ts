import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, parseSettings } from './settings';

describe('parseSettings', () => {
	it('defaults new scheduling settings to the existing behavior', () => {
		expect(parseSettings({})).toEqual(DEFAULT_SETTINGS);
		expect(parseSettings({ desiredRetention: 0.95 })).toMatchObject({
			desiredRetention: 0.95,
			rescheduleOnRetentionChange: true,
			learnAhead: true,
			learnAheadMinutes: 10,
		});
	});

	it('accepts future-only retention changes and a custom learn-ahead limit', () => {
		expect(
			parseSettings({
				rescheduleOnRetentionChange: false,
				learnAhead: false,
				learnAheadMinutes: 25,
			}),
		).toMatchObject({
			rescheduleOnRetentionChange: false,
			learnAhead: false,
			learnAheadMinutes: 25,
		});
	});

	it('rejects invalid retention and learn-ahead settings', () => {
		expect(
			parseSettings({
				rescheduleOnRetentionChange: 'sometimes',
				learnAheadMinutes: 0,
			}),
		).toMatchObject({
			rescheduleOnRetentionChange: DEFAULT_SETTINGS.rescheduleOnRetentionChange,
			learnAheadMinutes: DEFAULT_SETTINGS.learnAheadMinutes,
		});
		expect(parseSettings({ learnAheadMinutes: 1441 }).learnAheadMinutes).toBe(
			DEFAULT_SETTINGS.learnAheadMinutes,
		);
	});
});
