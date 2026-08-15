import { Plugin } from 'obsidian';
import { STRINGS } from './i18n';
import { cleanOwnConflictCopies } from './log';
import { parseSettings, RememberSettingTab, type RememberSettings } from './settings';
import { hideTokens } from './ui/hide-tokens';
import { REMEMBER_VIEW_DEFINITION } from './ui/remember-view-definition';
import { ReviewView } from './ui/review-view';
import { TransientSingletonViewHost } from './ui/transient-singleton-view-host';

export default class RememberPlugin extends Plugin {
	settings!: RememberSettings;
	private rememberViewHost!: TransientSingletonViewHost;

	async onload(): Promise<void> {
		await this.loadSettings();
		this.rememberViewHost = new TransientSingletonViewHost(
			this.app.workspace,
			REMEMBER_VIEW_DEFINITION,
		);
		this.rememberViewHost.install(this, (leaf) => new ReviewView(leaf, this.settings));
		this.addRibbonIcon(REMEMBER_VIEW_DEFINITION.icon, STRINGS.plugin.openRibbon, () => void this.openReview());
		this.addCommand({
			id: 'open',
			name: STRINGS.plugin.openCommand,
			callback: () => void this.openReview(),
		});
		this.addSettingTab(new RememberSettingTab(this.app, this));
		this.registerEditorExtension(hideTokens);
		this.app.workspace.onLayoutReady(() => {
			cleanOwnConflictCopies(this.app).catch((error) =>
				console.error('Remember: sync-conflict cleanup failed', error),
			);
		});
	}

	async openReview(): Promise<void> {
		try {
			await this.rememberViewHost.open();
		} catch (error) {
			console.error('Remember: could not open the review view', error);
		}
	}

	async loadSettings(): Promise<void> {
		this.settings = parseSettings(await this.loadData());
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}
}
