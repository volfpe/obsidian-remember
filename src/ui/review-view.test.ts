import { TFile } from 'obsidian';
import { App, Notice, WorkspaceLeaf } from 'obsidian-test-mocks/obsidian';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../settings';
import { ReviewView } from './review-view';

afterEach(() => vi.restoreAllMocks());

describe('view persistence', () => {
	it('does not persist session state', () => {
		const mockApp = App.createConfigured__();
		const leaf = WorkspaceLeaf.create2__(mockApp).asOriginalType3__();
		const view = new ReviewView(leaf, { ...DEFAULT_SETTINGS });

		expect(view.getState()).toEqual({});
	});
});

describe('Remember shell', () => {
	it('stamps cards in every deck when Remember opens', async () => {
		const mockApp = App.createConfigured__({
			files: {
				'language.md': '---\ndeck: Language\n---\nhello::hola',
				'geography.md': '---\ndeck: Geography\n---\nFrance::Paris',
				'plain.md': 'outside::deck',
			},
		});
		const app = mockApp.asOriginalType__();
		const leaf = WorkspaceLeaf.create2__(mockApp).asOriginalType3__();
		const view = new ReviewView(leaf, { ...DEFAULT_SETTINGS });

		await view.onOpen();

		expect(await app.vault.adapter.read('language.md')).toMatch(
			/hello::hola %%rem:[0-9a-z]{16}%%/,
		);
		expect(await app.vault.adapter.read('geography.md')).toMatch(
			/France::Paris %%rem:[0-9a-z]{16}%%/,
		);
		expect(await app.vault.adapter.read('plain.md')).toBe('outside::deck');
	});

	it('starts with the same cards shown before a refresh', async () => {
		const mockApp = App.createConfigured__({
			files: { 'language.md': '---\ndeck: Language\n---\nhello::hola' },
		});
		const app = mockApp.asOriginalType__();
		const leaf = WorkspaceLeaf.create2__(mockApp).asOriginalType3__();
		const view = new ReviewView(leaf, { ...DEFAULT_SETTINGS });
		await view.onOpen();
		const file = app.vault.getAbstractFileByPath('language.md');
		expect(file).toBeInstanceOf(TFile);
		if (!(file instanceof TFile)) throw new Error('language.md is missing');
		await app.vault.modify(file, `${await app.vault.read(file)}\nbye::adios`);

		(view as unknown as { selectDeck(deck: string): void }).selectDeck('Language');
		expect(view.contentEl.querySelector('.remember-deck-readiness')?.textContent).toBe(
			'1 card ready',
		);
		view.contentEl.querySelector<HTMLButtonElement>('.remember-start-review')?.click();

		expect(view.contentEl.querySelector('.remember-progress-total')?.textContent).toBe('1');
	});

	it('includes cards added after opening once Refresh is used', async () => {
		const mockApp = App.createConfigured__({
			files: { 'language.md': '---\ndeck: Language\n---\nhello::hola' },
		});
		const app = mockApp.asOriginalType__();
		const leaf = WorkspaceLeaf.create2__(mockApp).asOriginalType3__();
		const view = new ReviewView(leaf, { ...DEFAULT_SETTINGS });
		await view.onOpen();
		const file = app.vault.getAbstractFileByPath('language.md');
		expect(file).toBeInstanceOf(TFile);
		if (!(file instanceof TFile)) throw new Error('language.md is missing');
		await app.vault.modify(file, `${await app.vault.read(file)}\nbye::adios`);

		view.contentEl.querySelector<HTMLButtonElement>('.remember-refresh')?.click();
		await vi.waitFor(() => {
			expect(view.contentEl.querySelector<HTMLButtonElement>('.remember-refresh')?.disabled).toBe(
				false,
			);
		});
		expect(await app.vault.read(file)).toMatch(/bye::adios %%rem:[0-9a-z]{16}%%/);

		(view as unknown as { selectDeck(deck: string): void }).selectDeck('Language');
		expect(view.contentEl.querySelector('.remember-deck-readiness')?.textContent).toBe(
			'2 cards ready',
		);
		view.contentEl.querySelector<HTMLButtonElement>('.remember-start-review')?.click();

		expect(view.contentEl.querySelector('.remember-progress-total')?.textContent).toBe('2');
	});

	it('opens Remember settings from the header and keeps Import hidden', async () => {
		const mockApp = App.createConfigured__();
		const leaf = WorkspaceLeaf.create2__(mockApp).asOriginalType3__();
		const openSettings = vi.fn();
		const view = new ReviewView(leaf, { ...DEFAULT_SETTINGS }, openSettings);

		await view.onOpen();
		expect(view.contentEl.querySelector('.remember-import')).toBeNull();
		view.contentEl.querySelector<HTMLButtonElement>('.remember-settings')?.click();
		expect(openSettings).toHaveBeenCalledOnce();
	});

	it('opens on the deck chooser and reveals sections only after choosing a deck', async () => {
		const mockApp = App.createConfigured__();
		const leaf = WorkspaceLeaf.create2__(mockApp).asOriginalType3__();
		const view = new ReviewView(leaf, { ...DEFAULT_SETTINGS });

		await view.onOpen();
		expect(view.contentEl.querySelectorAll('.remember-view-nav-item')).toHaveLength(0);
		expect(view.contentEl.querySelector('.remember-view-title')?.textContent).toBe('');
		expect(view.contentEl.querySelector('.remember-back-to-decks')?.classList).toContain(
			'is-hidden',
		);

		(view as unknown as { selectDeck(deck: string): void }).selectDeck('Language/Spanish');

		const tabs = Array.from(
			view.contentEl.querySelectorAll<HTMLButtonElement>('.remember-view-nav-item'),
		);
		expect(tabs.map((tab) => tab.textContent)).toEqual(['Study', 'Cards']);
		expect(tabs[0].getAttribute('aria-current')).toBe('page');
		expect(view.contentEl.querySelector('.remember-view-title')?.textContent).toBe(
			'Language/Spanish',
		);
		expect(view.contentEl.querySelector('.remember-back-to-decks')?.classList).not.toContain(
			'is-hidden',
		);
	});

	it('opens Cards without reloading the snapshot', async () => {
		const mockApp = App.createConfigured__();
		const leaf = WorkspaceLeaf.create2__(mockApp).asOriginalType3__();
		const view = new ReviewView(leaf, { ...DEFAULT_SETTINGS });
		await view.onOpen();
		(view as unknown as { selectDeck(deck: string): void }).selectDeck('Language');
		const load = vi.spyOn(mockApp.vault.adapter, 'list');

		const cards = Array.from(
			view.contentEl.querySelectorAll<HTMLButtonElement>('.remember-view-nav-item'),
		)[1];
		cards.click();

		expect(view.contentEl.querySelector('.remember-cards-page')?.textContent).toContain(
			'No cards found.',
		);
		expect(load).not.toHaveBeenCalled();
	});

	it('reloads the shared snapshot from the header refresh action', async () => {
		const mockApp = App.createConfigured__();
		const leaf = WorkspaceLeaf.create2__(mockApp).asOriginalType3__();
		const view = new ReviewView(leaf, { ...DEFAULT_SETTINGS });
		await view.onOpen();
		const list = vi.spyOn(mockApp.vault.adapter, 'list');
		const notice = vi.spyOn(Notice.prototype, 'constructor__');

		view.contentEl.querySelector<HTMLButtonElement>('.remember-refresh')?.click();

		await vi.waitFor(() => {
			expect(list).toHaveBeenCalled();
			expect(view.contentEl.querySelector<HTMLButtonElement>('.remember-refresh')?.disabled).toBe(
				false,
			);
			expect(notice).toHaveBeenCalledWith('Remember: refresh complete.', undefined);
		});
	});
});
