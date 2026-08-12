# ADR 0001: Store card id in Markdown

## Context

Each card needs to have some identifier.

## Decision

Store a random card ID in an Obsidian comment in the note. Put the comment at the end of a single-line card or on the line above a multi-line card.

The ID is a random 64-bit value written in base 36. Both directions of a reversed card use the same ID and different sibling numbers.

Remember reports the duplicate and uses only one copy until one ID is removed.

## Consequences

Moving or editing a card keeps its history.

Deleting the comment disconnects the old history.
