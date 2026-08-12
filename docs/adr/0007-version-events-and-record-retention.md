# ADR 0007: Version events and record desired retention

## Context

Remember rebuilds each card's FSRS state from its review events. It uses the current scheduler and desired retention. If either one changes, the same events may produce different due dates.

## Decision

Every log event must have a version in `v`. Version 1 defines the event fields, their meaning, and how Remember replays them.

Every review event must store the desired retention used for that review in `dr`.

Version 1 does not use `dr` during replay. It replays all reviews with the current desired retention. The stored value is only information that a future version may use.

## Consequences

Changing desired retention rebuilds the schedule and may change due dates immediately.

Future versions may use `dr`.
