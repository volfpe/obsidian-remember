import { describe, expect, it, vi } from 'vitest';
import type { NoteCard } from '../core/queue';
import { DEFAULT_SETTINGS } from '../settings';
import type { RememberSnapshot } from './remember-snapshot';
import { renderDeckChooser, renderDeckStudyPage } from './study-page';

const now = new Date('2026-08-15T12:00:00.000Z');

function snapshot(): RememberSnapshot {
	const cards: NoteCard[] = [
		{
			id: null,
			suspended: false,
			kind: 'basic',
			multiline: false,
			line: 1,
			path: 'language/spanish.md',
			deck: 'Language/Spanish',
			siblings: [{ sub: 0, front: 'hola', back: 'hello' }],
		},
	];
	return {
		loadedAt: now,
		cards,
		events: [],
		buries: [],
		states: new Map(),
		issues: { duplicates: [], invalidDeckPaths: [] },
	};
}

describe('deck-first study pages', () => {
	it('allows choosing a deck even when its new cards are waiting', () => {
		const parent = createDiv();
		const selectDeck = vi.fn();
		renderDeckChooser(
			parent,
			snapshot(),
			{ ...DEFAULT_SETTINGS, limitNewCardsPerDay: true, newCardsPerDay: 0 },
			selectDeck,
			now,
		);

		const rows = Array.from(parent.querySelectorAll<HTMLButtonElement>('.remember-deck-row'));
		expect(rows.map((row) => row.querySelector('.remember-deck-name')?.textContent)).toEqual([
			'Language',
			'Spanish',
		]);
		expect(rows[0].disabled).toBe(false);
		expect(parent.querySelector('.remember-count-waiting')?.getAttribute('aria-label')).toContain(
			'held for a future day by the daily limit',
		);
		expect(parent.querySelector('.remember-deck-header-count-suspended')).toBeNull();
		rows[0].click();
		expect(selectDeck).toHaveBeenCalledWith('Language');
	});

	it('shows suspended counts only when the selected scope contains suspended cards', () => {
		const parent = createDiv();
		const data = snapshot();
		data.cards[0].suspended = true;
		data.cards[0].siblings.push({ sub: 1, front: 'hello', back: 'hola' });

		renderDeckChooser(parent, data, { ...DEFAULT_SETTINGS }, vi.fn(), now);

		expect(parent.querySelector('.remember-deck-header-count-suspended')?.textContent).toBe(
			'Suspended',
		);
		expect(
			Array.from(parent.querySelectorAll('.remember-count-suspended')).map((item) => item.textContent),
		).toEqual(['2', '2']);
		expect(parent.querySelector('.remember-count-suspended')?.getAttribute('aria-label')).toContain(
			'excluded from review',
		);

		renderDeckStudyPage(parent, data, { ...DEFAULT_SETTINGS }, 'Language', vi.fn(), now);

		expect(parent.querySelector('.remember-deck-status-suspended')?.textContent).toBe('2Suspended');
		expect(parent.querySelector('.remember-start-review')).toBeNull();
	});

	it('starts review from the selected deck page and hides the action when nothing is ready', () => {
		const parent = createDiv();
		const start = vi.fn();
		renderDeckStudyPage(
			parent,
			snapshot(),
			{ ...DEFAULT_SETTINGS },
			'Language',
			start,
			now,
		);
		const button = parent.querySelector<HTMLButtonElement>('.remember-start-review')!;
		expect(button.disabled).toBe(false);
		expect(parent.querySelector('.remember-deck-ready-detail')).toBeNull();
		expect(
			parent.querySelector('.remember-deck-status-due')?.getAttribute('aria-label'),
		).toContain('Cards scheduled for review now.');
		expect(parent.querySelector('.remember-deck-status-waiting')).toBeNull();
		expect(parent.querySelector('.remember-deck-status-buried')).toBeNull();
		expect(parent.querySelector('.remember-deck-status-suspended')).toBeNull();
		expect(parent.textContent).toContain('Upcoming 14 days');
		button.click();
		expect(start).toHaveBeenCalledOnce();

		renderDeckStudyPage(
			parent,
			snapshot(),
			{ ...DEFAULT_SETTINGS, limitNewCardsPerDay: true, newCardsPerDay: 0 },
			'Language',
			start,
			now,
		);
		expect(parent.querySelector('.remember-start-review')).toBeNull();
		expect(parent.textContent).toContain('No cards to review');
		expect(parent.querySelector('.remember-deck-status-waiting')?.textContent).toBe('1Waiting');
	});
});
