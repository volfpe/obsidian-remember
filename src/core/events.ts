import type { Grade } from 'ts-fsrs';

/**
 * Compact JSONL key glossary:
 * v = event protocol version; k = event kind; i = review event id; t = UTC timestamp;
 * c = card id; s = sibling index; r = review rating; dr = desired retention provenance;
 * x = expiry time; u = id of the event undone by a tombstone.
 */
export interface ReviewEvent {
	v: 1;
	k: 'r';
	/** Unique event id. */
	i: string;
	/** ISO timestamp, UTC. */
	t: string;
	/** Card id. */
	c: string;
	/** Sibling sub-index: 0 forward, 1 reverse, and cN cloze -> N + 1. */
	s: number;
	/** 1 Again, 2 Hard, 3 Good, 4 Easy. */
	r: Grade;
	/** Desired retention used for this review; replay may use it according to settings. */
	dr: number;
}

export interface BuryEvent {
	v: 1;
	k: 'b';
	/** Unique event id. */
	i: string;
	/** ISO timestamp, UTC. */
	t: string;
	/** Card id. */
	c: string;
	/** ISO timestamp after which the card is no longer buried. */
	x: string;
}

export interface UndoEvent {
	v: 1;
	k: 'u';
	/** ISO timestamp, UTC. */
	t: string;
	/** Id of the reversible event this tombstone cancels. */
	u: string;
}

export type CardEvent = ReviewEvent | BuryEvent;
export type LogEvent = CardEvent | UndoEvent;
