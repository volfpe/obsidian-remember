# ADR 0016: Store deck settings in deck folders

## Context

Different decks may need different study settings.

## Decision

Read deck settings from the frontmatter of an optional `_remember.md` note in each deck folder.

Inherit missing or invalid settings from the closest parent deck, then from global settings. A child deck setting wins over its parent.

Load the settings when Remember opens or refreshes. Show effective values and their sources in a Settings tab.

## Consequences

Deck settings sync as Markdown files.
