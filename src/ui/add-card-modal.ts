import {
	MarkdownView,
	Modal,
	Notice,
	Setting,
	TextAreaComponent,
	TFolder,
	type App,
	type ButtonComponent,
	type TFile,
} from 'obsidian';
import { parseCardNote, type CardKind } from '../core/card-note';
import { newCardId } from '../core/id';
import { cardFileBaseName, cardNoteContent, newCardCursor, slugSource, type NewCardSpec } from '../core/new-card';
import { STRINGS } from '../i18n';
import type { RememberSettings } from '../settings';
import { availablePath, ensureFolder } from '../vault-folders';

const LAST_CHOICES_KEY = 'remember-new-card';

interface LastChoices {
	deck: string | null;
	kind: CardKind;
	reverse: boolean;
}

function loadLastChoices(app: App): LastChoices {
	const stored: unknown = app.loadLocalStorage(LAST_CHOICES_KEY);
	const record = typeof stored === 'object' && stored !== null ? (stored as Record<string, unknown>) : {};
	return {
		deck: typeof record.deck === 'string' ? record.deck : null,
		kind: record.kind === 'cloze' ? 'cloze' : 'basic',
		reverse: record.reverse === true,
	};
}

/**
 * One small dialog, optimized for few steps: a contextual deck wins when provided;
 * otherwise deck, type, and reverse come from the last created card. The content fields
 * match the type (Front/Back for basic, one Text field for cloze). All content is
 * optional — an unfilled card is created as an empty template to finish in the note.
 * "Create" opens the new note; "Create & continue" keeps the dialog open for the next card.
 * New decks are made by creating folders in the file explorer, not here.
 */
export class AddCardModal extends Modal {
	private deck: string;
	private kind: CardKind = 'basic';
	private reverse = false;
	private front = '';
	private back = '';
	private body = '';
	private frontSetting: Setting | null = null;
	private backSetting: Setting | null = null;
	private textSetting: Setting | null = null;
	private reverseSetting: Setting | null = null;
	private fields: TextAreaComponent[] = [];
	private continueButton: ButtonComponent | null = null;
	private actionButtons: ButtonComponent[] = [];
	private statusEl: HTMLElement | null = null;
	private busy = false;

	constructor(
		app: App,
		private settings: RememberSettings,
		private initialDeck: string | null = null,
		private onCreated: () => void | Promise<void> = () => undefined,
	) {
		super(app);
		this.deck = this.settings.rootFolder;
	}

	override onOpen(): void {
		this.titleEl.setText(STRINGS.addCard.title);
		this.modalEl.addClass('remember-add-card-modal');
		const root = this.settings.rootFolder;
		const decks = deckFolderPaths(this.app, root);
		const last = loadLastChoices(this.app);
		this.deck =
			this.initialDeck !== null && decks.includes(this.initialDeck)
				? this.initialDeck
				: last.deck !== null && decks.includes(last.deck)
					? last.deck
					: root;
		this.kind = last.kind;
		this.reverse = last.reverse;

		new Setting(this.contentEl).setName(STRINGS.addCard.deck).setClass('remember-add-card-option').addDropdown((dropdown) => {
			for (const path of decks) dropdown.addOption(path, deckLabel(path, root));
			dropdown.setValue(this.deck);
			dropdown.onChange((value) => (this.deck = value));
		});
		new Setting(this.contentEl).setName(STRINGS.addCard.type).setClass('remember-add-card-option').addDropdown((dropdown) => {
			dropdown.addOption('basic', STRINGS.addCard.typeBasic);
			dropdown.addOption('cloze', STRINGS.addCard.typeCloze);
			dropdown.setValue(this.kind);
			dropdown.onChange((value) => {
				this.kind = value === 'cloze' ? 'cloze' : 'basic';
				this.applyKind();
			});
		});
		this.reverseSetting = new Setting(this.contentEl)
			.setName(STRINGS.addCard.reverse)
			.setDesc(STRINGS.addCard.reverseDescription)
			.setClass('remember-add-card-option')
			.addToggle((toggle) => {
				toggle.setValue(this.reverse);
				toggle.onChange((value) => (this.reverse = value));
			});
		this.frontSetting = this.textField(STRINGS.addCard.front, (value) => (this.front = value));
		this.backSetting = this.textField(STRINGS.addCard.back, (value) => (this.back = value));
		this.textSetting = this.textField(STRINGS.addCard.text, (value) => (this.body = value));
		const actions = new Setting(this.contentEl).setClass('remember-add-card-actions');
		this.statusEl = actions.infoEl.createDiv({ cls: 'remember-add-card-status' });
		this.statusEl.setAttr('aria-live', 'polite');
		actions
			.addButton((button) => {
				this.continueButton = button;
				this.actionButtons.push(button);
				button.setButtonText(STRINGS.addCard.createContinue);
				button.setTooltip(STRINGS.addCard.createContinueTooltip);
				button.onClick(() => void this.submit(true));
			})
			.addButton((button) => {
				this.actionButtons.push(button);
				button.setCta();
				button.setButtonText(STRINGS.addCard.create);
				button.onClick(() => void this.submit(false));
			});
		this.applyKind();
		window.setTimeout(() => this.focusFirstField(), 0);
	}

	override onClose(): void {
		this.contentEl.empty();
		this.frontSetting = null;
		this.backSetting = null;
		this.textSetting = null;
		this.reverseSetting = null;
		this.fields = [];
		this.continueButton = null;
		this.actionButtons = [];
		this.statusEl = null;
	}

	private textField(name: string, store: (value: string) => void): Setting {
		const setting = new Setting(this.contentEl).setName(name).setClass('remember-add-card-field');
		setting.addTextArea((text) => {
			text.setPlaceholder(STRINGS.addCard.fieldPlaceholder);
			text.inputEl.rows = 4;
			text.onChange((value) => {
				store(value);
				this.updateContinueState();
			});
			this.fields.push(text);
		});
		return setting;
	}

	private applyKind(): void {
		const cloze = this.kind === 'cloze';
		this.reverseSetting?.settingEl.toggleClass('is-hidden', cloze);
		this.frontSetting?.settingEl.toggleClass('is-hidden', cloze);
		this.backSetting?.settingEl.toggleClass('is-hidden', cloze);
		this.textSetting?.settingEl.toggleClass('is-hidden', !cloze);
		this.updateContinueState();
	}

	/**
	 * "Create & continue" never opens the note, so it must not create a card the user
	 * would still have to finish: it stays disabled until the fields form a complete card.
	 */
	private updateContinueState(): void {
		const spec = this.buildSpec('preview');
		const complete = canCreateAndContinue(spec);
		this.continueButton?.setDisabled(this.busy || !complete);
	}

	private focusFirstField(): void {
		const first = this.kind === 'cloze' ? this.fields[2] : this.fields[0];
		first?.inputEl.focus();
	}

	private async submit(continueAdding: boolean): Promise<void> {
		if (this.busy) return;
		this.busy = true;
		for (const button of this.actionButtons) button.setDisabled(true);
		try {
			const created = await this.createCard();
			this.app.saveLocalStorage(LAST_CHOICES_KEY, {
				deck: this.deck,
				kind: this.kind,
				reverse: this.reverse,
			} satisfies LastChoices);
			await this.onCreated();
			new Notice(STRINGS.notices.cardCreated);
			if (continueAdding) {
				this.clearFields();
				this.updateContinueState();
				this.statusEl?.setText(STRINGS.addCard.created(created.file.basename));
				this.focusFirstField();
			} else {
				this.close();
				await this.openForEditing(created);
			}
		} catch (error) {
			console.warn('Remember: could not create the card', error);
			new Notice(STRINGS.notices.couldNotCreateCard(error));
		} finally {
			this.busy = false;
			for (const button of this.actionButtons) button.setDisabled(false);
			this.updateContinueState();
		}
	}

	private clearFields(): void {
		this.front = '';
		this.back = '';
		this.body = '';
		for (const field of this.fields) field.setValue('');
	}

	private buildSpec(id: string): NewCardSpec {
		return this.kind === 'basic'
			? {
					id,
					kind: 'basic',
					reverse: this.reverse,
					front: this.front.trim() || undefined,
					back: this.back.trim() || undefined,
				}
			: { id, kind: 'cloze', body: this.body.trim() || undefined };
	}

	private async createCard(): Promise<{ file: TFile; spec: NewCardSpec }> {
		const id = newCardId();
		const spec = this.buildSpec(id);
		await ensureFolder(this.app, this.deck);
		const path = await availablePath(this.app, this.deck, cardFileBaseName(slugSource(spec), id));
		const file = await this.app.vault.create(path, cardNoteContent(spec));
		return { file, spec };
	}

	private async openForEditing({ file, spec }: { file: TFile; spec: NewCardSpec }): Promise<void> {
		const leaf = this.app.workspace.getLeaf(false);
		await leaf.openFile(file, { active: true });
		if (!(leaf.view instanceof MarkdownView)) return;
		const cursor = newCardCursor(cardNoteContent(spec), spec);
		if (!cursor) return;
		const from = { line: cursor.line, ch: cursor.ch };
		if (cursor.toCh === undefined) leaf.view.editor.setCursor(from);
		else leaf.view.editor.setSelection(from, { line: cursor.line, ch: cursor.toCh });
		leaf.view.editor.focus();
	}
}

/** Batch creation requires user-authored, parseable content; generated placeholders do not count. */
export function canCreateAndContinue(spec: NewCardSpec): boolean {
	const hasContent =
		spec.kind === 'basic'
			? (spec.front?.trim() ?? '') !== '' && (spec.back?.trim() ?? '') !== ''
			: (spec.body?.trim() ?? '') !== '';
	if (!hasContent) return false;
	return (
		parseCardNote(cardNoteContent(spec), {
			'remember-type': spec.kind,
			'remember-reverse': spec.reverse === true,
		}).siblings.length > 0
	);
}

/** The root folder and every folder below it, root first, then by path. */
export function deckFolderPaths(app: App, rootFolder: string): string[] {
	const paths: string[] = [rootFolder];
	const root = app.vault.getFolderByPath(rootFolder);
	const walk = (folder: TFolder): void => {
		for (const child of folder.children) {
			if (child instanceof TFolder) {
				paths.push(child.path);
				walk(child);
			}
		}
	};
	if (root) walk(root);
	return [paths[0], ...paths.slice(1).sort()];
}

function deckLabel(path: string, rootFolder: string): string {
	if (path === rootFolder) return rootFolder.slice(rootFolder.lastIndexOf('/') + 1);
	return path.slice(rootFolder.length + 1);
}
