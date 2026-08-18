# ADR 0007: Record desired retention

## Context

Desired retention affects a card's due date. Users may or may not want a new value to change cards they already reviewed.

## Decision

Store a version in every event as `v`.

Store the desired retention in every review event as `dr`.

Add a setting that controls whether changing desired retention reschedules existing cards. Keep it enabled by default.

## Consequences

When enabled, a new retention value changes existing schedules. When disabled, it applies only to future reviews.
