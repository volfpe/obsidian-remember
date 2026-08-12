# ADR 0002: Use per-device append-only review logs

## Context

Remember should work with most vault sync service. Two offline devices can review cards at the same time. If both devices update one shared state file, one update may conflict with the other.

Review history must live in the vault because sync services may ignore parts of the Obsidian settings folder.

## Decision

Give each device a local ID and its own review log in the vault. Store one event per JSON line and append new events to the end of the device's log.

Give each review event a unique ID. Undo a review by appending an event that references that ID.

Read events from every review log.

## Consequences

Devices do not overwrite each other's review history.

Undo remains safe after synchronization because it is also append-only.

Logs grow over time. Reviews for deleted cards stay in the logs but cause no problem.
