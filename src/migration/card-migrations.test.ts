import { describe, expect, it, vi } from 'vitest';
import { CardMigrations, type MigrationStep } from './card-migrations';

describe('card migration sequence', () => {
	it('offers the next migration only after the previous one succeeds', async () => {
		const order: string[] = [];
		let firstPending = true;
		let secondPending = true;
		const step = (name: string, pending: () => boolean, complete: () => void): MigrationStep => ({
			hasPending: async () => pending(),
			offer: (onMigrated) => {
				order.push(name);
				complete();
				onMigrated();
			},
		});
		const migrations = new CardMigrations([
			step('inline cards', () => firstPending, () => (firstPending = false)),
			step('cloze syntax', () => secondPending, () => (secondPending = false)),
		]);
		const onMigrated = vi.fn();

		await migrations.offerPending(onMigrated);
		await vi.waitFor(() => expect(order).toEqual(['inline cards', 'cloze syntax']));

		expect(onMigrated).toHaveBeenCalledTimes(2);
	});
});
