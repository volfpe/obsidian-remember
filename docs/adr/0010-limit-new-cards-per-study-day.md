# ADR 0010: Limit new cards per study day

## Context

Users may want to limit how many new cards they study each day.

## Decision

New cards are unlimited by default. An optional limit applies to the selected deck and its descendants.

The first review of each card direction uses one daily slot. Undo restores the slot.

Calculate usage from review events using the device's local calendar day.

Select unseen cards by `cardId#sub` order.

## Consequences

Synced devices with the same state select the same cards.

Offline devices may temporarily exceed the limit.
