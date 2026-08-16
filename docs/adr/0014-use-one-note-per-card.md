# ADR 0014: Use one note per card in a Remember folder

## Context

Cards need metadata, a deck hierarchy, and content. Obsidian has native tools for all three: frontmatter, folders, and note bodies.

Users should be able to read, edit, link, and organize cards in Obsidian.

## Decision

Every card is one Markdown note inside a configurable root folder (default `Remember`).

Folders under the root folder are decks. Nested folders are subdecks. Notes directly in the root folder belong to the root deck.

Card metadata lives in frontmatter: `remember-id`, `remember-type` (`basic` or `cloze`), `remember-reverse`, and `remember-suspend`. The prefix keeps the properties out of the way of user metadata, because Obsidian properties share one vault-wide namespace.

A basic card has its question under `# Front` and its answer under `# Back`. A cloze card body is plain Markdown with `{{cN::answer}}` markers.

Review logs live in the root folder.

## Consequences

Cards are plain Markdown.

Moving a card note is a deck change; its id keeps the history.

Each card is one file. Large collections mean many small files.
