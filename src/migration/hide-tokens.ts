// LEGACY: CodeMirror decoration hiding %%rem:<id>%% tokens in Live Preview, revealed on the
// cursor line. Reading view hides %%...%% natively. Tokens exist only in unmigrated notes;
// delete with the rest of src/migration/.

import { RangeSetBuilder } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, ViewUpdate, type DecorationSet } from '@codemirror/view';
import { editorLivePreviewField } from 'obsidian';
import { TOKEN_PATTERN } from './legacy-parser';

const hidden = Decoration.replace({});

export const hideTokens = ViewPlugin.fromClass(
	class {
		decorations: DecorationSet;

		constructor(view: EditorView) {
			this.decorations = buildDecorations(view);
		}

		update(update: ViewUpdate) {
			const modeChanged =
				update.startState.field(editorLivePreviewField, false) !== update.state.field(editorLivePreviewField, false);
			if (update.docChanged || update.selectionSet || update.viewportChanged || modeChanged) {
				this.decorations = buildDecorations(update.view);
			}
		}
	},
	{ decorations: (plugin) => plugin.decorations },
);

function buildDecorations(view: EditorView): DecorationSet {
	if (!view.state.field(editorLivePreviewField, false)) return Decoration.none;
	const doc = view.state.doc;
	const cursorLines = new Set<number>();
	for (const range of view.state.selection.ranges) {
		cursorLines.add(doc.lineAt(range.head).number);
		cursorLines.add(doc.lineAt(range.anchor).number);
	}
	const builder = new RangeSetBuilder<Decoration>();
	const token = new RegExp(TOKEN_PATTERN, 'g');
	for (const { from, to } of view.visibleRanges) {
		const text = doc.sliceString(from, to);
		for (let match = token.exec(text); match !== null; match = token.exec(text)) {
			const start = from + match.index;
			if (!cursorLines.has(doc.lineAt(start).number)) builder.add(start, start + match[0].length, hidden);
		}
	}
	return builder.finish();
}
