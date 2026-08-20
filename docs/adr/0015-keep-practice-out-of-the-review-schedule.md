# ADR 0015: Keep Practice out of the review schedule

## Context

Users may want to practise known cards before they are due.

Practice answers must not change the real review schedule.

## Decision

Keep Practice state in memory for one session. Do not write events or update FSRS state.

Include known, unsuspended cards due after the session starts. Order them by their real due date.

Use a separate Practice queue and rating path. Reuse the review card presentation.

Again repeats the card after 1 minute. Hard repeats it after 10 minutes. Good and Easy complete the card for the session. Show a waiting retry early when no other card is available.

## Consequences

Leaving Practice discards its state.

Practice does not affect review history or card schedules.
