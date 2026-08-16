# ADR 0004: Stamp card identities when Remember opens

## Context

New cards need stable IDs.

## Decision

Add missing IDs when the Remember view opens. Scan all notes with a deck property.

Process each affected note with `vault.process`.

Inside the process callback, parse the latest note content and add IDs to the cards found there.

The Refresh button finds and stamps cards added after the view opened.

## Consequences

Opening Remember can change notes before a review starts.

A review session uses the same cards and counts shown in the view.

The timestamp records when Remember first found the card. It is not the card creation time.
