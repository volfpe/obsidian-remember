# ADR 0008: Replay concurrent reviews

## Context

Two offline devices may review the same card before their logs sync. Both reviews then appear in the vault.

## Decision

Keep both reviews and replay them in timestamp order, like all other reviews.

Do not try to detect or merge concurrent reviews.

## Consequences

The second review may increase stability more than a single review would. A review made soon after another review has less effect than a review made after a long delay.