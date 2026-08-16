# ADR 0008: Replay concurrent reviews

## Context

Two offline devices may review the same card before their logs sync. Both reviews then appear in the vault.

FSRS supports reviews that happen close together. Each real review can affect the card's memory state, even when it happens on the same day.

## Decision

Keep both reviews. Replay them in timestamp order, like all other reviews.

Do not discard one review or merge the two into one.

## Consequences

The schedule includes every review that really happened and remains derived from the complete review history.

Wrong device clocks can put reviews in the wrong order.
