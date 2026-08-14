import { describe, expect, it } from 'vitest';
import { newCardId, randomId } from './id';

describe('randomId', () => {
	it('mints 13-character base36 ids', () => {
		for (let i = 0; i < 100; i++) expect(randomId()).toMatch(/^[0-9a-z]{13}$/);
	});
});

describe('newCardId', () => {
	it('mints 16-character base36 ids', () => {
		expect(newCardId()).toMatch(/^[0-9a-z]{16}$/);
	});

	it('sorts by timestamp before the random suffix', () => {
		const earlier = newCardId(1_700_000_000_000, 0xffff_ffff);
		const later = newCardId(1_700_000_000_001, 0);
		expect(earlier < later).toBe(true);
	});

	it('uses the random suffix to separate ids from the same millisecond', () => {
		const first = newCardId(1_700_000_000_000, 1);
		const second = newCardId(1_700_000_000_000, 2);
		expect(first).not.toBe(second);
		expect(first.slice(0, 9)).toBe(second.slice(0, 9));
	});
});
