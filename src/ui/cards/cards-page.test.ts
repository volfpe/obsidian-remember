import { App } from 'obsidian-test-mocks/obsidian';
import { describe, expect, it, onTestFinished } from 'vitest';
import type { NoteCard } from '../../core/queue';
import { DEFAULT_SETTINGS } from '../../settings';
import type { RememberSnapshot } from '../remember-snapshot';
import { CardsPage } from './cards-page';

function snapshot(): RememberSnapshot {
	const cards: NoteCard[] = [
		{
			id: 'first-card',
			kind: 'basic',
			multiline: false,
			line: 4,
			path: 'language/dog.md',
			deck: 'Language',
			siblings: [
				{ sub: 0, front: 'perro', back: 'dog' },
				{ sub: 1, front: 'dog', back: 'perro' },
			],
		},
	];
	return {
		loadedAt: new Date('2026-08-15T12:00:00.000Z'),
		cards,
		events: [],
		states: new Map(),
		issues: { duplicates: [], invalidDeckPaths: [] },
	};
}

function emulateBrowserScrollClamping(): () => void {
	const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop');
	if (!descriptor) throw new Error('Expected Element.scrollTop to be configurable');
	const positions = new WeakMap<Element, number>();
	Object.defineProperty(Element.prototype, 'scrollTop', {
		configurable: true,
		get(this: Element): number {
			return positions.get(this) ?? 0;
		},
		set(this: Element, value: number) {
			positions.set(this, this.childElementCount === 0 ? 0 : value);
		},
	});
	return () => Object.defineProperty(Element.prototype, 'scrollTop', descriptor);
}

describe('Cards page', () => {
	it('renders sibling rows and updates the selected detail', () => {
		const restoreScrollTop = emulateBrowserScrollClamping();
		onTestFinished(restoreScrollTop);
		const app = App.createConfigured__().asOriginalType__();
		const page = new CardsPage(app);
		const container = createDiv();

		page.render(container, snapshot(), 'Language', { ...DEFAULT_SETTINGS });

		const rows = Array.from(container.querySelectorAll<HTMLButtonElement>('.remember-card-row'));
		const list = container.querySelector<HTMLElement>('.remember-card-list');
		expect(rows).toHaveLength(2);
		expect(list).not.toBeNull();
		expect(container.querySelector('.remember-card-group-title')).toBeNull();
		expect(rows[0].getAttribute('aria-current')).toBe('true');
		expect(rows[0].textContent).toContain('New');
		expect(rows[1].textContent).toContain('Buried');
		expect(container.querySelector('.remember-card-metadata')?.textContent).toContain('Forward');
		expect(container.querySelector('.remember-card-metadata')?.textContent).not.toContain(
			'DeckLanguage',
		);
		expect(container.querySelector('.remember-card-metadata')?.textContent).toContain(
			'AvailabilityNew',
		);
		expect(container.querySelector('.remember-card-metadata')?.textContent).toContain('StateNew');
		expect(container.querySelector<HTMLAnchorElement>('.remember-card-source-link')?.textContent).toBe(
			'dog.md',
		);
		expect(container.querySelector<HTMLAnchorElement>('.remember-card-source-link')?.href).not.toContain(
			'line',
		);

		list!.scrollTop = 120;
		rows[1].click();

		expect(container.querySelector('.remember-card-metadata')?.textContent).toContain('Reverse');
		expect(container.querySelector('.remember-cards-page')?.classList).toContain('is-detail');
		expect(container.querySelector<HTMLElement>('.remember-card-list')?.scrollTop).toBe(120);

		container.querySelector<HTMLButtonElement>('.remember-card-detail-back')?.click();

		expect(container.querySelector<HTMLElement>('.remember-card-list')?.scrollTop).toBe(120);
		page.unload();
	});
});
