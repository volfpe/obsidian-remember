# ADR 0001: Store card id in Markdown

## Context

Each card needs to have some identifier.

## Decision

Store a card ID in an Obsidian comment in the note. Put the comment at the end of a single-line card or on the line above a multi-line card.

Card IDs contain 16 base36 characters. The first 9 contain the Unix millisecond stamp time. The last 7 contain 32 random bits.

Both directions of a reversed card use the same ID and different sibling numbers.

Remember reports the duplicate and uses only one copy until one ID is removed.

## Consequences

Moving or editing a card keeps its history.

Cards are sortable by stamp time.

Deleting the comment disconnects the old history.
