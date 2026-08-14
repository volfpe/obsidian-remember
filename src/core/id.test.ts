import { describe, expect, it } from 'vitest';
import { newCardId, randomId } from './id';

describe('ids', () => {
	it('uses fixed-width base36 strings', () => {
		expect(randomId()).toMatch(/^[0-9a-z]{13}$/);
		expect(newCardId()).toMatch(/^[0-9a-z]{16}$/);
	});

	it('sorts chronologically and disambiguates cards from the same millisecond', () => {
		const earlier = newCardId(1_700_000_000_000, 0xffff_ffff);
		const later = newCardId(1_700_000_000_001, 0);
		const sameTime = newCardId(1_700_000_000_000, 1);

		expect(earlier < later).toBe(true);
		expect(sameTime).not.toBe(earlier);
		expect(sameTime.slice(0, 9)).toBe(earlier.slice(0, 9));
	});
});
