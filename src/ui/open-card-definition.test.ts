import { MarkdownView } from 'obsidian';
import { App } from 'obsidian-test-mocks/obsidian';
import { describe, expect, it, vi } from 'vitest';
import { openCardDefinition } from './open-card-definition';

describe('openCardDefinition', () => {
	it('opens the source in a new tab and selects the definition line', async () => {
		const mockApp = App.createConfigured__({ files: { 'language/dog.md': 'one\ntwo\nq::a' } });
		const app = mockApp.asOriginalType__();
		const leaf = app.workspace.getLeaf('tab');
		const view = new MarkdownView(leaf);
		await leaf.open(view);
		vi.spyOn(app.workspace, 'getLeaf').mockReturnValue(leaf);
		const openFile = vi.spyOn(leaf, 'openFile');
		const scrollIntoView = vi.spyOn(view.editor, 'scrollIntoView');

		await openCardDefinition(app, { path: 'language/dog.md', line: 2 });

		expect(openFile).toHaveBeenCalledWith(expect.objectContaining({ path: 'language/dog.md' }), {
			active: true,
		});
		expect(view.editor.getCursor()).toEqual({ line: 2, ch: 0 });
		expect(scrollIntoView).toHaveBeenCalledWith(
			{ from: { line: 2, ch: 0 }, to: { line: 2, ch: 0 } },
			true,
		);
	});
});
