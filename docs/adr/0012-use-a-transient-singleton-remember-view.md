# ADR 0012: Use a transient singleton Remember view

## Context

Remember should stay open while the user works elsewhere in Obsidian.

An automatically restored Remember tab may read the vault before sync finishes. Two Remember tabs may hold different state.

## Decision

Open Remember in an Obsidian tab.

Keep one Remember tab. The Open command reveals it or creates it.

Do not restore the tab after restart. Close it when Obsidian quits or the plugin unloads. Remove it after startup if quit cleanup did not run.

A restored or copied tab must not read the vault before it is removed.

Do not persist view state. Rebuild it from the vault when the tab opens.

## Consequences

The user can switch tabs without losing current view state.

Closing the tab or restarting Obsidian discards current view state. Saved data remains.

The user opens Remember after startup, when sync is more likely to be finished.
