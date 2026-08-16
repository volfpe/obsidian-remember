# ADR 0001: Store card id in Markdown

## Context

Each card needs an identifier that survives edits, renames, and moves.

## Decision

Store the card ID in the `remember-id` frontmatter property of the card note.

Card IDs contain 16 base36 characters. The first 9 contain the Unix millisecond stamp time. The last 7 contain 32 random bits.

Both directions of a reversed card use the same ID and different sibling numbers.

Remember reports a duplicated ID and uses only one copy until one ID is changed.

## Consequences

Renaming, editing, or moving a card note keeps its history.

Cards are sortable by stamp time.

Changing the `remember-id` property disconnects the old history.
