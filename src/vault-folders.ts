import type { App } from 'obsidian';

/** Creates the folder and its missing parents. Safe to call when it already exists. */
export async function ensureFolder(app: App, path: string): Promise<void> {
	if (path === '' || app.vault.getFolderByPath(path) !== null) return;
	let current = '';
	for (const segment of path.split('/')) {
		current = current === '' ? segment : `${current}/${segment}`;
		if (app.vault.getFolderByPath(current) !== null) continue;
		try {
			await app.vault.createFolder(current);
		} catch (error) {
			// A concurrent create is fine; anything else is a real failure.
			if (app.vault.getFolderByPath(current) === null) throw error;
		}
	}
}

/** The folder part of a vault path, '' for the vault root. */
export function parentPath(path: string): string {
	const separator = path.lastIndexOf('/');
	return separator < 0 ? '' : path.slice(0, separator);
}

/** The first free "<base>.md", "<base> 2.md", … path inside the folder. */
export async function availablePath(app: App, folder: string, base: string): Promise<string> {
	for (let attempt = 1; ; attempt++) {
		const name = attempt === 1 ? base : `${base} ${attempt}`;
		const path = `${folder}/${name}.md`;
		if (!(await app.vault.adapter.exists(path))) return path;
	}
}
