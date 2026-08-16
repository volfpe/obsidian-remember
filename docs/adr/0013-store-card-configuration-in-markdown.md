# ADR 0013: Store card configuration in Markdown

## Context

Remember cards are part of Markdown notes.

Users should be able to understand and change a card without another data store or configuration screen.

## Decision

Store persistent card configuration (`remember-type`, `remember-reverse`, `remember-suspend`) in the card note's frontmatter.

Store temporary study actions in review logs.

## Consequences

The Markdown note remains the source of truth for each card.