import type { ForecastDay } from '../../statistics/forecast';
import { STRINGS } from '../../i18n';

export function renderScheduleForecast(parent: HTMLElement, forecast: ForecastDay[]): void {
	const section = parent.createEl('section', { cls: 'remember-forecast' });
	section.createEl('h2', { text: STRINGS.study.forecast.title });
	const workloads = forecast.map((day) => day.scheduled + day.new);
	if (!workloads.some((workload) => workload > 0)) {
		section.createEl('p', {
			cls: 'remember-forecast-empty',
			text: STRINGS.study.forecast.empty,
		});
		return;
	}

	const scale = chartScale(Math.max(...workloads));
	const viewport = section.createDiv({ cls: 'remember-forecast-viewport' });
	const graph = viewport.createDiv({ cls: 'remember-forecast-graph' });
	const yAxis = graph.createDiv({ cls: 'remember-forecast-y-axis' });
	const main = graph.createDiv({ cls: 'remember-forecast-main' });
	const plot = main.createDiv({ cls: 'remember-forecast-plot' });
	const grid = plot.createDiv({ cls: 'remember-forecast-grid' });
	for (const tick of scale.ticks) {
		const position = (tick / scale.maximum) * 100;
		const label = yAxis.createSpan({ text: String(tick) });
		label.style.bottom = `${position}%`;
		const line = grid.createSpan();
		line.style.bottom = `${position}%`;
	}

	const columns = plot.createDiv({ cls: 'remember-forecast-columns' });
	const xAxis = main.createDiv({ cls: 'remember-forecast-x-axis' });
	for (const [index, workload] of workloads.entries()) {
		const column = columns.createDiv({ cls: 'remember-forecast-column' });
		column.tabIndex = 0;
		const description = STRINGS.study.forecast.dayDescription(index, workload);
		column.setAttribute('role', 'img');
		column.createSpan({ cls: 'remember-forecast-sr', text: description });
		const tooltip = column.createDiv({ cls: 'remember-forecast-tooltip' });
		tooltip.setAttribute('aria-hidden', 'true');
		tooltip.createSpan({ text: STRINGS.study.forecast.day(index) });
		tooltip.createEl('strong', { text: STRINGS.study.forecast.cards(workload) });
		if (workload > 0) {
			const bar = column.createDiv({ cls: 'remember-forecast-bar' });
			bar.style.height = `${(workload / scale.maximum) * 100}%`;
		}
		xAxis.createSpan({ text: String(index) });
	}
}

function chartScale(maximum: number): { maximum: number; ticks: number[] } {
	const roughStep = maximum / 3;
	const magnitude = 10 ** Math.floor(Math.log10(Math.max(1, roughStep)));
	const normalized = roughStep / magnitude;
	const niceMultiplier = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
	const step = Math.max(1, niceMultiplier * magnitude);
	const axisMaximum = Math.ceil(maximum / step) * step;
	const ticks: number[] = [];
	for (let tick = 0; tick <= axisMaximum; tick += step) ticks.push(tick);
	return { maximum: axisMaximum, ticks };
}
