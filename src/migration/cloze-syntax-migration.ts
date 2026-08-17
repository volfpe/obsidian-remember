// One-time migration from {{cN::answer}} clozes to native Obsidian
// ==cN:answer== highlights. Delete after the old syntax deprecation period.

import { Modal, Notice, type App, type TFile } from 'obsidian';
import { bodyStart, parseNoteLines, readCardKind } from '../core/card-note';

const LEGACY_CLOZE = /\{\{c([1-9][0-9]*)::(.*?)\}\}/g;
const README_URL = 'https://github.com/volfpe/obsidian-remember#readme';

const STRINGS = {
	title: 'Cloze format update',
	body: [
		'Remember is under active development, and its cloze format has changed. Clozes are now written as Obsidian highlights: ==c1:answer==. The old {{c1::answer}} format is no longer supported.',
		'Migration updates cloze card notes in the Remember folder.',
	],
	readMore: 'Read more in the README',
	migrate: 'Migrate clozes',
	notNow: 'Not now',
	working: 'Remember: migrating clozes…',
	done: (cards: number) => `Remember: updated cloze syntax in ${cards} ${cards === 1 ? 'card' : 'cards'}.`,
	failed: (error: unknown) => `Remember: cloze migration failed — ${String(error)}. Run "Remember: Open" to try again.`,
};

export class ClozeSyntaxMigration {
	constructor(
		private app: App,
		private rootFolder: () => string,
	) {}

	async hasPending(): Promise<boolean> {
		for (const file of this.clozeFiles()) {
			try {
				if (hasLegacyClozeSyntax(await this.app.vault.cachedRead(file))) return true;
			} catch {
				continue;
			}
		}
		return false;
	}

	offer(onMigrated: () => void): void {
		new ClozeSyntaxMigrationModal(this.app, async () => {
			new Notice(STRINGS.working);
			try {
				const migrated = await this.migrate();
				new Notice(STRINGS.done(migrated));
				onMigrated();
			} catch (error) {
				console.error('Remember: cloze migration failed', error);
				new Notice(STRINGS.failed(error));
			}
		}).open();
	}

	/** Idempotently updates every old cloze marker in declared cloze card notes. */
	async migrate(): Promise<number> {
		let migrated = 0;
		for (const file of this.clozeFiles()) {
			if (!hasLegacyClozeSyntax(await this.app.vault.cachedRead(file))) continue;
			let changed = false;
			await this.app.vault.process(file, (text) => {
				const next = migrateLegacyClozeSyntax(text);
				changed = next !== text;
				return next;
			});
			if (changed) migrated++;
		}
		return migrated;
	}

	private clozeFiles(): TFile[] {
		const root = this.rootFolder();
		return this.app.vault.getMarkdownFiles().filter((file) => {
			if (!isUnder(file.path, root)) return false;
			const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
			return readCardKind(frontmatter) === 'cloze';
		});
	}
}

export function hasLegacyClozeSyntax(text: string): boolean {
	const lines = parseNoteLines(text);
	for (let i = bodyStart(lines); i < lines.length; i++) {
		LEGACY_CLOZE.lastIndex = 0;
		for (let match = LEGACY_CLOZE.exec(lines[i].searchable); match !== null; match = LEGACY_CLOZE.exec(lines[i].searchable)) {
			if (validAnswer(lines[i].raw, match)) return true;
		}
	}
	return false;
}

/** Replaces valid old markers outside Markdown code and frontmatter. */
export function migrateLegacyClozeSyntax(text: string): string {
	const lines = parseNoteLines(text);
	const start = bodyStart(lines);
	let changed = false;
	const migrated = lines
		.map(({ raw, searchable }, line) => {
			if (line < start) return raw;
			let result = '';
			let cursor = 0;
			LEGACY_CLOZE.lastIndex = 0;
			for (let match = LEGACY_CLOZE.exec(searchable); match !== null; match = LEGACY_CLOZE.exec(searchable)) {
				if (!validAnswer(raw, match)) continue;
				const answerStart = match.index + `{{c${match[1]}::`.length;
				const answerEnd = match.index + match[0].length - 2;
				result += raw.slice(cursor, match.index);
				result += `==c${match[1]}:${raw.slice(answerStart, answerEnd)}==`;
				cursor = match.index + match[0].length;
			}
			if (cursor === 0) return raw;
			changed = true;
			return result + raw.slice(cursor);
		})
		.join(text.includes('\r\n') ? '\r\n' : '\n');
	return changed ? migrated : text;
}

function validAnswer(raw: string, match: RegExpExecArray): boolean {
	const answerStart = match.index + `{{c${match[1]}::`.length;
	const answer = raw.slice(answerStart, match.index + match[0].length - 2);
	return answer.trim() !== '' && !answer.includes('{{');
}

function isUnder(path: string, folder: string): boolean {
	return folder !== '' && path.startsWith(folder + '/');
}

class ClozeSyntaxMigrationModal extends Modal {
	constructor(
		app: App,
		private onMigrate: () => Promise<void>,
	) {
		super(app);
	}

	override onOpen(): void {
		this.titleEl.setText(STRINGS.title);
		for (const paragraph of STRINGS.body) this.contentEl.createEl('p', { text: paragraph });
		this.contentEl.createEl('p').createEl('a', { text: STRINGS.readMore, href: README_URL });
		const buttons = this.contentEl.createDiv({ cls: 'modal-button-container' });
		const migrate = buttons.createEl('button', { cls: 'mod-cta', text: STRINGS.migrate });
		migrate.addEventListener('click', () => {
			this.close();
			void this.onMigrate();
		});
		const later = buttons.createEl('button', { text: STRINGS.notNow });
		later.addEventListener('click', () => this.close());
	}

	override onClose(): void {
		this.contentEl.empty();
	}
}
