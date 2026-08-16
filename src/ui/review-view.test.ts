import { App, Notice, WorkspaceLeaf } from 'obsidian-test-mocks/obsidian';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../settings';
import { ReviewView } from './review-view';

function cardNote(front: string, back: string): string {
	return ['# Front', '', front, '', '# Back', '', back, ''].join('\n');
}

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
	it('adopts unstamped card notes in the Remember folder when it opens', async () => {
		const mockApp = App.createConfigured__({
			files: {
				'Remember/Language/hola.md': cardNote('hola', 'hello'),
				'Remember/geography.md': 'The capital of {{c1::France}} is {{c2::Paris}}.',
				'Remember/inbox.md': 'just some prose',
				'outside.md': cardNote('outside', 'the folder'),
			},
		});
		const app = mockApp.asOriginalType__();
		const leaf = WorkspaceLeaf.create2__(mockApp).asOriginalType3__();
		const view = new ReviewView(leaf, { ...DEFAULT_SETTINGS });

		await view.onOpen();

		const basic = await app.vault.adapter.read('Remember/Language/hola.md');
		expect(basic).toMatch(/remember-id: [0-9a-z]{16}/);
		expect(basic).toContain('remember-type: basic');
		const cloze = await app.vault.adapter.read('Remember/geography.md');
		expect(cloze).toMatch(/remember-id: [0-9a-z]{16}/);
		expect(cloze).toContain('remember-type: cloze');
		expect(await app.vault.adapter.read('Remember/inbox.md')).toBe('just some prose');
		expect(await app.vault.adapter.read('outside.md')).toBe(cardNote('outside', 'the folder'));
	});

	it('starts with the same cards shown before a refresh', async () => {
		const mockApp = App.createConfigured__({
			files: { 'Remember/hola.md': cardNote('hola', 'hello') },
		});
		const app = mockApp.asOriginalType__();
		const leaf = WorkspaceLeaf.create2__(mockApp).asOriginalType3__();
		const view = new ReviewView(leaf, { ...DEFAULT_SETTINGS });
		await view.onOpen();
		await app.vault.create('Remember/adios.md', cardNote('adios', 'goodbye'));

		(view as unknown as { selectDeck(deck: string): void }).selectDeck('');
		expect(view.contentEl.querySelector('.remember-deck-readiness')?.textContent).toBe(
			'1 card ready',
		);
		view.contentEl.querySelector<HTMLButtonElement>('.remember-start-review')?.click();

		expect(view.contentEl.querySelector('.remember-progress-total')?.textContent).toBe('1');
	});

	it('includes cards added after opening once Refresh is used', async () => {
		const mockApp = App.createConfigured__({
			files: { 'Remember/hola.md': cardNote('hola', 'hello') },
		});
		const app = mockApp.asOriginalType__();
		const leaf = WorkspaceLeaf.create2__(mockApp).asOriginalType3__();
		const view = new ReviewView(leaf, { ...DEFAULT_SETTINGS });
		await view.onOpen();
		await app.vault.create('Remember/adios.md', cardNote('adios', 'goodbye'));

		view.contentEl.querySelector<HTMLButtonElement>('.remember-refresh')?.click();
		await vi.waitFor(() => {
			expect(view.contentEl.querySelector<HTMLButtonElement>('.remember-refresh')?.disabled).toBe(
				false,
			);
		});
		expect(await app.vault.adapter.read('Remember/adios.md')).toMatch(/remember-id: [0-9a-z]{16}/);

		(view as unknown as { selectDeck(deck: string): void }).selectDeck('');
		expect(view.contentEl.querySelector('.remember-deck-readiness')?.textContent).toBe(
			'2 cards ready',
		);
		view.contentEl.querySelector<HTMLButtonElement>('.remember-start-review')?.click();

		expect(view.contentEl.querySelector('.remember-progress-total')?.textContent).toBe('2');
	});

	it('offers the legacy migration when legacy cards exist', async () => {
		const mockApp = App.createConfigured__();
		const leaf = WorkspaceLeaf.create2__(mockApp).asOriginalType3__();
		const migration = {
			hasLegacyCards: vi.fn(async () => true),
			offer: vi.fn(),
		};
		const view = new ReviewView(leaf, { ...DEFAULT_SETTINGS }, () => undefined, migration);

		await view.onOpen();
		await vi.waitFor(() => {
			expect(migration.offer).toHaveBeenCalledOnce();
		});
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

		(view as unknown as { selectDeck(deck: string): void }).selectDeck('Remember/Spanish');

		const tabs = Array.from(
			view.contentEl.querySelectorAll<HTMLButtonElement>('.remember-view-nav-item'),
		);
		expect(tabs.map((tab) => tab.textContent)).toEqual(['Study', 'Cards']);
		expect(tabs[0].getAttribute('aria-current')).toBe('page');
		expect(view.contentEl.querySelector('.remember-view-title')?.textContent).toBe(
			'Remember/Spanish',
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
		(view as unknown as { selectDeck(deck: string): void }).selectDeck('');
		const load = vi.spyOn(mockApp.vault, 'getMarkdownFiles');

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
		const load = vi.spyOn(mockApp.vault, 'getMarkdownFiles');
		const notice = vi.spyOn(Notice.prototype, 'constructor__');

		view.contentEl.querySelector<HTMLButtonElement>('.remember-refresh')?.click();

		await vi.waitFor(() => {
			expect(load).toHaveBeenCalled();
			expect(view.contentEl.querySelector<HTMLButtonElement>('.remember-refresh')?.disabled).toBe(
				false,
			);
			expect(notice).toHaveBeenCalledWith('Remember: refresh complete.', undefined);
		});
	});
});
