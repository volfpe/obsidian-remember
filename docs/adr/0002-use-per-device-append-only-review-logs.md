# ADR 0002: Use per-device append-only review logs

## Context

Remember should work with most vault sync service. Two offline devices can review cards at the same time. If both devices update one shared state file, one update may conflict with the other.

Review history must live in the vault because sync services may ignore parts of the Obsidian settings folder.

## Decision

Give each device a local ID and a set of `<device-id>-<random-id>.rememberlog` files in the Remember root folder. Store one event per JSON line. Each device appends to one active log and starts a new one before the active log grows too large.

Give each reversible event a unique ID. Undo an action by appending an event that references that ID.

Read events only from review logs in the Remember root folder.

## Consequences

Devices do not overwrite each other's review history.

Undo remains safe after synchronization because it is also append-only.

The number of logs grows over time. Reviews for deleted cards stay in the logs but cause no problem.

Obsidian Sync users must enable **Sync all other types** on every device because `.rememberlog` is a custom file type.
