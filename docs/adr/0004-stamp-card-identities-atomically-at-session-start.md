# ADR 0004: Stamp card identities atomically at session start

## Context

New cards need stable IDs.

## Decision

Add missing IDs when a review session starts. Process each affected note with `vault.process`.

Inside the process callback, parse the latest note content and add IDs to the cards found there.

## Consequences

Closing a session after stamping may leave unused IDs.

The timestamp in a card ID records when the review session stamped the card.
