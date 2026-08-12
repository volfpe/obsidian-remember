# ADR 0003: Rebuild FSRS state from review events

## Context

Remember needs the current FSRS state for each card. This state must remain correct after review logs from several devices are synced.

## Decision

Store rating events and undo events. Do not store FSRS state. Remove undone ratings, then combine the remaining ratings from all devices, sort them by time and replay them to rebuild the current state.

## Consequences

The review logs are enough to rebuild all schedules.

Opening the deck list or a review session requires replaying history. Replay may become slow when there are many events.
