import { ItemView, type IconName, type Plugin, type View, type Workspace, type WorkspaceLeaf } from 'obsidian';

export interface TransientSingletonViewDefinition {
	type: string;
	displayText: string;
	icon: IconName;
}

/** Owns one runtime-only workspace leaf and rejects restored or copied leaves. */
export class TransientSingletonViewHost {
	private opening: Promise<void> | null = null;
	private canonical: WorkspaceLeaf | null = null;
	private closing = false;
	private creating = false;
	private generation = 0;

	constructor(
		private workspace: Workspace,
		private definition: TransientSingletonViewDefinition,
	) {}

	install(plugin: Plugin, factory: (leaf: WorkspaceLeaf) => View): void {
		plugin.registerView(this.definition.type, (leaf) => this.createView(leaf, () => factory(leaf)));
		plugin.registerEvent(
			this.workspace.on('layout-change', () => {
				void this.enforceSingleton().catch((error) =>
					console.error(`${plugin.manifest.name}: could not enforce the singleton view`, error),
				);
			}),
		);
		plugin.registerEvent(
			this.workspace.on('quit', (tasks) => {
				if (this.closeAll()) tasks.add(() => this.saveWorkspaceLayout());
			}),
		);
		this.workspace.onLayoutReady(() => {
			if (this.closeAll()) {
				void this.saveWorkspaceLayout().catch((error) =>
					console.error(`${plugin.manifest.name}: could not save transient-view cleanup`, error),
				);
			}
		});
		plugin.register(() => this.closeAll());
	}

	createView(leaf: WorkspaceLeaf, factory: () => View): View {
		return this.isAuthorized(leaf) ? factory() : new InertView(leaf, this.definition);
	}

	open(): Promise<void> {
		if (this.opening) return this.opening;
		const generation = this.generation;
		const opening = this.openNow(generation).finally(() => {
			if (this.opening === opening) this.opening = null;
		});
		this.opening = opening;
		return this.opening;
	}

	closeAll(): boolean {
		const hadLeaf = this.canonical !== null || this.leaves().length > 0;
		this.generation++;
		this.opening = null;
		this.canonical = null;
		this.closing = true;
		try {
			this.workspace.detachLeavesOfType(this.definition.type);
		} finally {
			this.closing = false;
		}
		return hadLeaf;
	}

	async enforceSingleton(): Promise<void> {
		if (this.closing || this.creating) return;
		const leaves = this.leaves();
		const canonical = this.canonical;
		if (!canonical || !leaves.includes(canonical)) {
			this.canonical = null;
			for (const leaf of leaves) leaf.detach();
			return;
		}

		const duplicates = leaves.filter((leaf) => leaf !== canonical);
		if (duplicates.length === 0) return;
		for (const duplicate of duplicates) duplicate.detach();
		await this.workspace.revealLeaf(canonical);
	}

	private isAuthorized(leaf: WorkspaceLeaf): boolean {
		return !this.closing && leaf === this.canonical;
	}

	private leaves(): WorkspaceLeaf[] {
		return this.workspace.getLeavesOfType(this.definition.type);
	}

	private async openNow(generation: number): Promise<void> {
		const leaves = this.leaves();
		const existing = this.canonical && leaves.includes(this.canonical) ? this.canonical : null;
		const duplicates = leaves.filter((leaf) => leaf !== existing);
		for (const duplicate of duplicates) duplicate.detach();
		if (existing) {
			await this.workspace.revealLeaf(existing);
			return;
		}
		this.canonical = null;

		let leaf: WorkspaceLeaf | null = null;
		this.creating = true;
		try {
			leaf = this.workspace.getLeaf('tab');
			this.canonical = leaf;
			await leaf.setViewState({ type: this.definition.type, active: true });
			if (generation !== this.generation || this.canonical !== leaf) {
				leaf.detach();
				return;
			}
			await this.workspace.revealLeaf(leaf);
		} catch (error) {
			if (leaf === null) throw error;
			const cancelled = generation !== this.generation || this.canonical !== leaf;
			if (this.canonical === leaf) this.canonical = null;
			leaf.detach();
			if (cancelled) return;
			throw error;
		} finally {
			this.creating = false;
		}
	}

	private async saveWorkspaceLayout(): Promise<void> {
		this.workspace.requestSaveLayout();
		await this.workspace.requestSaveLayout.run();
	}
}

/** Satisfies workspace restoration without activating plugin behavior. */
class InertView extends ItemView {
	constructor(
		leaf: WorkspaceLeaf,
		private definition: TransientSingletonViewDefinition,
	) {
		super(leaf);
		this.navigation = false;
	}

	getViewType(): string {
		return this.definition.type;
	}

	getDisplayText(): string {
		return this.definition.displayText;
	}

	getIcon(): IconName {
		return this.definition.icon;
	}
}
