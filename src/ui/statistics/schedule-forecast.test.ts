import { describe, expect, it } from 'vitest';
import { renderScheduleForecast } from './schedule-forecast';

describe('schedule forecast chart', () => {
	it('renders one workload series with relative day labels and total-only tooltips', () => {
		const parent = createDiv();
		renderScheduleForecast(parent, [
			{ date: new Date(2026, 7, 16), scheduled: 3, new: 2 },
			{ date: new Date(2026, 7, 17), scheduled: 1, new: 0 },
		]);

		expect(parent.querySelectorAll('.remember-forecast-bar')).toHaveLength(2);
		expect(
			Array.from(parent.querySelectorAll('.remember-forecast-x-axis span')).map(
				(item) => item.textContent,
			),
		).toEqual(['0', '1']);
		expect(parent.querySelector('.remember-forecast-tooltip')?.textContent).toBe('Day 05 cards');
		expect(parent.querySelector('.remember-forecast-column')?.hasAttribute('aria-label')).toBe(false);
		expect(parent.querySelector('.remember-forecast-sr')?.textContent).toContain('Day 0: 5 cards');
	});

	it('uses a compact empty state when no future workload is projected', () => {
		const parent = createDiv();
		renderScheduleForecast(parent, [
			{ date: new Date(2026, 7, 16), scheduled: 0, new: 0 },
		]);

		expect(parent.querySelector('.remember-forecast-chart')).toBeNull();
		expect(parent.textContent).toContain('No workload forecast');
	});
});
