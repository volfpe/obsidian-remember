// One-time migration from legacy inline cards to card notes. Everything the legacy
// format needs lives in src/migration/ so the whole folder can be deleted after the
// deprecation period (also remove its wiring in main.ts).

import { Modal, Notice, TFile, type App } from 'obsidian';
import { ID_PROPERTY } from '../core/card-note';
import { newCardId } from '../core/id';
import { cardFileBaseName, cardNoteContent, slugSource, type NewCardSpec } from '../core/new-card';
import type { LegacyMigrationPort } from '../ui/review-view';
import { availablePath, ensureFolder, parentPath } from '../vault-folders';
import { clozeSource, parseCards, stripLegacyTokens, type ParsedCard } from './legacy-parser';

const LEGACY_TOKEN = '%%rem:';
const README_URL = 'https://github.com/volfpe/obsidian-remember#readme';

const MIGRATION_STRINGS = {
	title: 'Card format update',
	body: [
		'Remember is under active development, and its card format has changed: each card is now a separate note in the Remember folder. The old inline format is no longer supported.',
		'Migration moves every existing card into the Remember folder and keeps its review history. Your notes stay unchanged, except that hidden card markers are removed.',
	],
	readMore: 'Read more in the README',
	migrate: 'Migrate cards',
	notNow: 'Not now',
	working: 'Remember: migrating cards…',
	done: (cards: number) => `Remember: migrated ${cards} ${cards === 1 ? 'card' : 'cards'} into the Remember folder.`,
	failed: (error: unknown) => `Remember: migration failed — ${String(error)}. Run "Remember: Open" to try again.`,
};

export class LegacyMigration implements LegacyMigrationPort {
	constructor(
		private app: App,
		private rootFolder: () => string,
		private loadRawSettings: () => Promise<unknown>,
	) {}

	/** True when any note outside the root folder still carries a legacy %%rem%% comment. */
	async hasLegacyCards(): Promise<boolean> {
		const root = this.rootFolder();
		for (const file of this.app.vault.getMarkdownFiles()) {
			if (isUnder(file.path, root)) continue;
			try {
				if ((await this.app.vault.cachedRead(file)).includes(LEGACY_TOKEN)) return true;
			} catch {
				continue;
			}
		}
		return false;
	}

	offer(onMigrated: () => void): void {
		new LegacyMigrationModal(this.app, async () => {
			new Notice(MIGRATION_STRINGS.working);
			try {
				const migrated = await this.migrate();
				new Notice(MIGRATION_STRINGS.done(migrated));
				onMigrated();
			} catch (error) {
				console.error('Remember: migration failed', error);
				new Notice(MIGRATION_STRINGS.failed(error));
			}
		}).open();
	}

	/**
	 * Converts every parseable legacy card from notes carrying the legacy deck property
	 * or a %%rem%% comment. Stamped cards keep their id (and their review history);
	 * unstamped cards get fresh ids. Idempotent: cards whose id already exists in the
	 * root folder are skipped, so an interrupted run can be repeated safely.
	 */
	async migrate(): Promise<number> {
		const root = this.rootFolder();
		const deckProperty = await this.legacyDeckProperty();
		const existingIds = this.cardIdsUnderRoot(root);
		let migrated = 0;
		for (const file of this.app.vault.getMarkdownFiles().slice()) {
			if (isUnder(file.path, root)) continue;
			const text = await this.app.vault.read(file);
			const hasToken = text.includes(LEGACY_TOKEN);
			const deck = this.legacyDeck(file, deckProperty);
			if (!hasToken && deck === null) continue;
			const cards = parseCards(text);
			for (const card of cards) {
				const id = card.id ?? newCardId();
				if (existingIds.has(id)) continue;
				await this.createCardNote(root, deck ?? '', legacyCardSpec(card, id, text));
				existingIds.add(id);
				migrated++;
			}
			if (hasToken) await this.app.vault.process(file, stripLegacyTokens);
		}
		await this.moveRootLogsInto(root);
		return migrated;
	}

	private async createCardNote(root: string, deck: string, spec: NewCardSpec): Promise<void> {
		const folder = deck === '' ? root : `${root}/${deckFolderPath(deck)}`;
		await ensureFolder(this.app, folder);
		const path = await availablePath(this.app, folder, cardFileBaseName(slugSource(spec), spec.id));
		await this.app.vault.create(path, cardNoteContent(spec));
	}

	private legacyDeck(file: TFile, deckProperty: string): string | null {
		const raw: unknown = this.app.metadataCache.getFileCache(file)?.frontmatter?.[deckProperty];
		if (typeof raw !== 'string' && typeof raw !== 'number' && typeof raw !== 'boolean') return null;
		const deck = String(raw).trim();
		return deck === '' ? null : deck;
	}

	private async legacyDeckProperty(): Promise<string> {
		try {
			const raw: unknown = await this.loadRawSettings();
			const stored = (raw as Record<string, unknown> | null)?.deckProperty;
			return typeof stored === 'string' && stored.trim() !== '' ? stored.trim() : 'deck';
		} catch {
			return 'deck';
		}
	}

	private cardIdsUnderRoot(root: string): Set<string> {
		const ids = new Set<string>();
		for (const file of this.app.vault.getMarkdownFiles()) {
			if (!isUnder(file.path, root)) continue;
			const id: unknown = this.app.metadataCache.getFileCache(file)?.frontmatter?.[ID_PROPERTY];
			if (typeof id === 'string' || typeof id === 'number') ids.add(String(id).trim());
		}
		return ids;
	}

	/** Review logs written to the vault root by older versions belong in the root folder. */
	private async moveRootLogsInto(root: string): Promise<void> {
		const adapter = this.app.vault.adapter;
		const logs = this.app.vault
			.getFiles()
			.filter(
				(file) =>
					parentPath(file.path) === '' &&
					file.name.startsWith('reviews-') &&
					file.name.endsWith('.rememberlog'),
			);
		if (logs.length === 0) return;
		await ensureFolder(this.app, root);
		for (const file of logs) {
			const target = `${root}/${file.name}`;
			if (!(await adapter.exists(target))) {
				await this.app.vault.rename(file, target);
				continue;
			}
			// The device already writes to the new location: merge the old lines in.
			const targetLines = new Set((await adapter.read(target)).split('\n').filter((line) => line.trim() !== ''));
			const missing = (await adapter.read(file.path))
				.split('\n')
				.filter((line) => line.trim() !== '' && !targetLines.has(line));
			if (missing.length > 0) await adapter.append(target, missing.join('\n') + '\n');
			await adapter.remove(file.path);
		}
	}
}

/** A legacy parsed card as a card-note spec. Sibling numbering is unchanged, so history follows the id. */
export function legacyCardSpec(card: ParsedCard, id: string, noteText: string): NewCardSpec {
	if (card.kind === 'cloze') {
		return { id, kind: 'cloze', suspended: card.suspended, body: clozeSource(noteText, card.line) };
	}
	return {
		id,
		kind: 'basic',
		reverse: card.siblings.length > 1,
		suspended: card.suspended,
		front: card.siblings[0].front,
		back: card.siblings[0].back,
	};
}

/** A legacy deck name as folder segments; characters invalid in file names are dropped. */
export function deckFolderPath(deck: string): string {
	return deck
		.split('/')
		.map((segment) => cardFileBaseName(segment, ''))
		.filter((segment) => segment !== '')
		.join('/');
}

function isUnder(path: string, folder: string): boolean {
	return folder !== '' && path.startsWith(folder + '/');
}

class LegacyMigrationModal extends Modal {
	constructor(
		app: App,
		private onMigrate: () => Promise<void>,
	) {
		super(app);
	}

	override onOpen(): void {
		this.titleEl.setText(MIGRATION_STRINGS.title);
		for (const paragraph of MIGRATION_STRINGS.body) {
			this.contentEl.createEl('p', { text: paragraph });
		}
		this.contentEl.createEl('p').createEl('a', {
			text: MIGRATION_STRINGS.readMore,
			href: README_URL,
		});
		const buttons = this.contentEl.createDiv({ cls: 'modal-button-container' });
		const migrate = buttons.createEl('button', { cls: 'mod-cta', text: MIGRATION_STRINGS.migrate });
		migrate.addEventListener('click', () => {
			this.close();
			void this.onMigrate();
		});
		const later = buttons.createEl('button', { text: MIGRATION_STRINGS.notNow });
		later.addEventListener('click', () => this.close());
	}

	override onClose(): void {
		this.contentEl.empty();
	}
}
