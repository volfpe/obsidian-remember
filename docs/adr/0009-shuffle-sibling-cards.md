# ADR 0009: Shuffle sibling cards

## Context

The two directions of a reversed card may appear close together. Seeing one direction can make the other direction easier.

## Decision

When a daily new-card limit applies, select the new-card cohort deterministically before ordering the review queue.

Shuffle selected cards with the same queue time for presentation.

Do not bury sibling cards or move them to another session.

## Consequences

Synchronized devices select the same daily cohort, but may present it in a different order.

Sibling cards are usually separated when the queue has enough cards.

Small queues may show sibling cards next to each other.
