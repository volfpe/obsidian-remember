# ADR 0011: Use numbered note-scoped cloze cards

## Context

A cloze card can have multiple siblings. Each sibling needs a stable number.

## Decision

Use `{{cN::answer}}` syntax anywhere in the body of a cloze note. The positive number is required.

The whole note body is one card group and provides the context. Each distinct number creates a sibling; repeated numbers are hidden together.

Use sibling indexes 0 and 1 for basic cards. Store cloze `cN` as sibling index `N + 1`.

## Consequences

Cloze siblings use the same review events and scheduling as other cards.

Adding a cloze with a new number does not affect existing cloze history. Renumbering a cloze changes which history it uses.
