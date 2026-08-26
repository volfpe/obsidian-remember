# ADR 0017: Use small review logs and a local review cache

## Context

Reading and replaying all review history when Remember opens gets slow and uses too much memory. Sync services may also limit file size.

## Decision

Write reviews to per-device `<device-id>-<random-id>.rememberlog` files. Start a new file before the active one exceeds about 1 MiB.

Treat every `.rememberlog`, including sync conflict copies, as input. Duplicate event IDs represent the same immutable event, and duplicate undo targets collapse.

Use an unsynced local IndexedDB cache. Reconcile it with the logs before showing Remember. Update it incrementally when possible and rebuild it when necessary.

## Consequences

Most opens process only changed logs.

A new device or cache rebuild must read all logs once. The logs remain the source of truth.
