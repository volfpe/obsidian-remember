import { describe, expect, it, vi } from 'vitest';
import { Rating } from 'ts-fsrs';
import type { NoteCard } from '../core/queue';
import { foldEvents, makeFsrs } from '../core/scheduler';
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
			reverse: false,
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
		issues: { duplicates: [] },
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
			'All',
			'Language',
			'Spanish',
		]);
		expect(rows[0].disabled).toBe(false);
		expect(parent.querySelector('.remember-count-waiting')?.getAttribute('aria-label')).toContain(
			'held for a future day by the daily limit',
		);
		expect(parent.querySelector('.remember-deck-header-count-suspended')).toBeNull();
		rows[1].click();
		expect(selectDeck).toHaveBeenCalledWith('Language');
		rows[0].click();
		expect(selectDeck).toHaveBeenCalledWith('');
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
		).toEqual(['2', '2', '2']);
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

	it('offers Practice only when the deck has a learned card due after session start', () => {
		const parent = createDiv();
		const data = snapshot();
		data.cards[0].id = 'known';
		data.states = foldEvents(makeFsrs(0.9), [
			{
				v: 1,
				k: 'r',
				i: 'known-review',
				t: '2026-08-15T11:59:00.000Z',
				c: 'known',
				s: 0,
				r: Rating.Good,
				dr: 0.9,
			},
		]);
		const startPractice = vi.fn();

		renderDeckStudyPage(
			parent,
			data,
			{ ...DEFAULT_SETTINGS },
			'Language',
			vi.fn(),
			now,
			startPractice,
		);

		const button = parent.querySelector<HTMLButtonElement>('.remember-start-practice')!;
		expect(button.textContent).toBe('Practice');
		expect(button.classList.contains('mod-cta')).toBe(false);
		expect(button.getAttribute('aria-description')).toBe(
			'Known cards only. Your schedule stays unchanged.',
		);
		expect(button.closest('.remember-deck-study-primary')).not.toBeNull();
		expect(button.parentElement?.classList.contains('remember-deck-study-actions')).toBe(true);
		expect(parent.querySelector('.remember-start-review')).toBeNull();
		button.click();
		expect(startPractice).toHaveBeenCalledOnce();

		data.cards.push({
			...data.cards[0],
			id: null,
			path: 'language/new.md',
			siblings: [{ sub: 0, front: 'adiós', back: 'goodbye' }],
		});
		renderDeckStudyPage(
			parent,
			data,
			{ ...DEFAULT_SETTINGS },
			'Language',
			vi.fn(),
			now,
			startPractice,
		);
		expect(parent.querySelector('.remember-start-review')).not.toBeNull();
		const options = parent.querySelector<HTMLButtonElement>('.remember-start-options')!;
		expect(options.getAttribute('aria-label')).toBe(
			'More study options',
		);
		const practiceOption = parent.querySelector<HTMLButtonElement>('.remember-start-practice')!;
		expect(practiceOption.getAttribute('aria-hidden')).toBe('true');
		expect(practiceOption.tabIndex).toBe(-1);
		expect(practiceOption.textContent).toBe('Practice');
		expect(practiceOption.getAttribute('aria-description')).toBe(
			'Known cards only. Your schedule stays unchanged.',
		);
		options.click();
		expect(practiceOption.getAttribute('aria-hidden')).toBe('false');
		expect(practiceOption.tabIndex).toBe(0);
		expect(options.getAttribute('aria-expanded')).toBe('true');
		expect(options.parentElement?.classList.contains('is-open')).toBe(true);
		options.click();
		expect(practiceOption.getAttribute('aria-hidden')).toBe('true');
		expect(practiceOption.tabIndex).toBe(-1);
		expect(options.parentElement?.classList.contains('is-open')).toBe(false);
	});
});
