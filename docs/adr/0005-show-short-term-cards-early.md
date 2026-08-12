# ADR 0005: Show short-term cards early

## Context

A rating can schedule a card a few minutes into the future.

## Decision

Keep a rated card in the current queue when its next due time is within ten minutes.

Order it by its due time behind cards that are already available. If it reaches the front before it is due, show it early instead of waiting.

## Consequences

Sessions continue without timers or a waiting screen.

Cards scheduled more than ten minutes ahead leave the session and become available when due.
