# ADR 0004: Adopt card notes when Remember opens

## Context

New cards need stable IDs and a declared type. Users can create card notes by hand or drop existing notes into the Remember folder.

## Decision

When the Remember view opens, scan the notes in the Remember folder.

Write missing `remember-id` and `remember-type` frontmatter into every note whose body is recognizable as a card: `# Front`/`# Back` sections, or a cloze marker.

Leave notes that are not recognizable as cards untouched.

The Refresh button adopts cards added after the view opened.

## Consequences

Opening Remember can change frontmatter before a review starts.

A review session uses the same cards and counts shown in the view.

The ID timestamp records when Remember first found the card. It is not the card creation time.
