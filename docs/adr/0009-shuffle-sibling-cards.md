# ADR 0009: Bury sibling cards

## Context

Sibling cards may reveal each other's answers when shown on the same day.

## Decision

Bury sibling cards by default.

Show at most one sibling from each card group per local calendar day.

Choose a scheduled sibling before a new sibling. Then choose the earliest due sibling.

## Consequences

Sibling cards normally appear on different days.

Devices get the same buried state after their review logs sync. Offline devices may temporarily differ.
