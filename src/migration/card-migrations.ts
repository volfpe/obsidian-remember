/** Runs one-time format migrations in order, opening at most one prompt at a time. */

export interface MigrationStep {
	hasPending(): Promise<boolean>;
	offer(onMigrated: () => void): void;
}

export class CardMigrations {
	constructor(private steps: readonly MigrationStep[]) {}

	async offerPending(onMigrated: () => void): Promise<void> {
		for (const step of this.steps) {
			if (!(await step.hasPending())) continue;
			step.offer(() => {
				onMigrated();
				void this.offerPending(onMigrated);
			});
			return;
		}
	}
}
