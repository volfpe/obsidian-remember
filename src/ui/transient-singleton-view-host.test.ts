import type { View } from 'obsidian';
import { App } from 'obsidian-test-mocks/obsidian';
import { describe, expect, it, vi } from 'vitest';
import { REMEMBER_VIEW_DEFINITION } from './remember-view-definition';
import { TransientSingletonViewHost } from './transient-singleton-view-host';

function harness() {
	const app = App.createConfigured__();
	const workspace = app.workspace;
	const host = new TransientSingletonViewHost(workspace.asOriginalType2__(), REMEMBER_VIEW_DEFINITION);
	return { host, workspace };
}

describe('transient singleton view host', () => {
	it('opens one new tab and reveals it', async () => {
		const { host, workspace } = harness();
		const reveal = vi.spyOn(workspace, 'revealLeaf');

		await host.open();

		const leaves = workspace.getLeavesOfType(REMEMBER_VIEW_DEFINITION.type);
		expect(leaves).toHaveLength(1);
		expect(leaves[0].getViewState()).toEqual({ type: REMEMBER_VIEW_DEFINITION.type, active: true });
		expect(reveal).toHaveBeenCalledWith(leaves[0]);
	});

	it('creates the real view only for the canonical leaf', async () => {
		const { host, workspace } = harness();
		await host.open();
		const canonical = workspace.getLeavesOfType(REMEMBER_VIEW_DEFINITION.type)[0];
		const realView = {} as View;
		const factory = vi.fn(() => realView);

		const created = host.createView(canonical.asOriginalType3__(), factory);

		expect(created).toBe(realView);
		expect(factory).toHaveBeenCalledOnce();
	});

	it('creates an inert view for an unknown leaf', async () => {
		const { host, workspace } = harness();
		const restored = workspace.getLeaf('tab');
		await restored.setViewState({ type: REMEMBER_VIEW_DEFINITION.type });
		const factory = vi.fn(() => ({}) as View);

		const created = host.createView(restored.asOriginalType3__(), factory);

		expect(factory).not.toHaveBeenCalled();
		expect(created.getViewType()).toBe(REMEMBER_VIEW_DEFINITION.type);
		expect(created.getDisplayText()).toBe(REMEMBER_VIEW_DEFINITION.displayText);
		expect(created.getIcon()).toBe(REMEMBER_VIEW_DEFINITION.icon);
	});

	it('reveals the existing singleton instead of opening another tab', async () => {
		const { host, workspace } = harness();
		await host.open();
		const existing = workspace.getLeavesOfType(REMEMBER_VIEW_DEFINITION.type)[0];

		await host.open();

		expect(workspace.getLeavesOfType(REMEMBER_VIEW_DEFINITION.type)).toEqual([existing]);
	});

	it('does not adopt a restored leaf when opening', async () => {
		const { host, workspace } = harness();
		const restored = workspace.getLeaf('tab');
		await restored.setViewState({ type: REMEMBER_VIEW_DEFINITION.type });

		await host.open();

		const leaves = workspace.getLeavesOfType(REMEMBER_VIEW_DEFINITION.type);
		expect(leaves).toHaveLength(1);
		expect(leaves[0]).not.toBe(restored);
	});

	it('coalesces concurrent open requests', async () => {
		const { host, workspace } = harness();

		const first = host.open();
		const second = host.open();

		expect(second).toBe(first);
		await Promise.all([first, second]);
		expect(workspace.getLeavesOfType(REMEMBER_VIEW_DEFINITION.type)).toHaveLength(1);
	});

	it('keeps ownership when layout changes while setting the view state', async () => {
		const { host, workspace } = harness();
		const leaf = workspace.getLeaf('tab');
		const originalSetViewState = leaf.setViewState.bind(leaf);
		vi.spyOn(workspace, 'getLeaf').mockReturnValue(leaf);
		vi.spyOn(leaf, 'setViewState').mockImplementation(async (...args) => {
			await host.enforceSingleton();
			await originalSetViewState(...args);
		});

		await host.open();
		const factory = vi.fn(() => ({}) as View);
		host.createView(leaf.asOriginalType3__(), factory);

		expect(factory).toHaveBeenCalledOnce();
	});

	it('removes a leaf duplicated by Obsidian and reveals the original', async () => {
		const { host, workspace } = harness();
		await host.open();
		const original = workspace.getLeavesOfType(REMEMBER_VIEW_DEFINITION.type)[0];
		const duplicate = workspace.getLeaf('split');
		await duplicate.setViewState({ type: REMEMBER_VIEW_DEFINITION.type });
		const reveal = vi.spyOn(workspace, 'revealLeaf');

		await host.enforceSingleton();

		expect(workspace.getLeavesOfType(REMEMBER_VIEW_DEFINITION.type)).toEqual([original]);
		expect(reveal).toHaveBeenCalledWith(original);
	});

	it('removes an unknown leaf instead of making it canonical', async () => {
		const { host, workspace } = harness();
		const restored = workspace.getLeaf('tab');
		await restored.setViewState({ type: REMEMBER_VIEW_DEFINITION.type });

		await host.enforceSingleton();

		expect(workspace.getLeavesOfType(REMEMBER_VIEW_DEFINITION.type)).toEqual([]);
	});

	it('removes restored leaves so the tab does not persist', async () => {
		const { host, workspace } = harness();
		await workspace.getLeaf('tab').setViewState({ type: REMEMBER_VIEW_DEFINITION.type });
		await workspace.getLeaf('tab').setViewState({ type: REMEMBER_VIEW_DEFINITION.type });

		host.closeAll();

		expect(workspace.getLeavesOfType(REMEMBER_VIEW_DEFINITION.type)).toEqual([]);
	});
});
