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

		(view as unknown as { selectDeck(deck: string): void }).selectDeck('Language/Spanish');

		const tabs = Array.from(
			view.contentEl.querySelectorAll<HTMLButtonElement>('.remember-view-nav-item'),
		);
		expect(tabs.map((tab) => tab.textContent)).toEqual(['Study', 'Cards']);
		expect(tabs[0].getAttribute('aria-current')).toBe('page');
		expect(view.contentEl.querySelector('.remember-selected-deck')?.textContent).toBe(
			'Language/Spanish',
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
