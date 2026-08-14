# ADR 0011: Use numbered cloze cards

## Context

A cloze card can have multiple siblings. Each sibling needs a stable number.

## Decision

Use `{{cN::answer}}` syntax. The positive number is required.

One line is one card group. Each distinct number creates a sibling; repeated numbers are hidden together.

Use sibling indexes 0 and 1 for basic cards. Store cloze `cN` as sibling index `N + 1`.

## Consequences

Cloze siblings use the same review events and scheduling as other cards.

Adding a cloze with a new number does not affect existing cloze history. Renumbering a cloze changes which history it uses.
