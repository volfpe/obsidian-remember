import { MarkdownView, Notice, TFile, type App } from 'obsidian';
import type { QueueItem } from '../core/queue';
import { STRINGS } from '../i18n';

type CardDefinition = Pick<QueueItem, 'path' | 'line'>;

export async function openCardDefinition(app: App, card: CardDefinition): Promise<void> {
	const file = app.vault.getAbstractFileByPath(card.path);
	if (!(file instanceof TFile)) {
		new Notice(STRINGS.notices.cardDefinitionMissing(card.path));
		return;
	}
	try {
		const leaf = app.workspace.getLeaf('tab');
		await leaf.openFile(file, { active: true });
		if (leaf.view instanceof MarkdownView) {
			const position = { line: card.line, ch: 0 };
			leaf.view.editor.setCursor(position);
			leaf.view.editor.scrollIntoView({ from: position, to: position }, true);
		}
	} catch (error) {
		new Notice(STRINGS.notices.couldNotOpenDefinition(error));
	}
}
