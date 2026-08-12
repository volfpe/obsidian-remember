# ADR 0006: Parse card syntax without Markdown context

## Context

Recognizing whether card syntax appears inside fenced or inline code requires parsing additional Markdown rules.

## Decision

Do not treat fenced code blocks or inline code as special contexts.

## Consequences

The parser stays small and its rules remain independent of a broader Markdown grammar.

Card-like syntax inside code is treated as a card.