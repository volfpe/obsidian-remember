import type { Grade } from 'ts-fsrs';

/**
 * Compact JSONL key glossary:
 * v = event protocol version; k = event kind; i = review event id; t = UTC timestamp;
 * c = card id; s = sibling index; r = review rating; dr = desired retention provenance;
 * u = id of the review undone by a tombstone.
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
	/** Sibling sub-index: 0 forward, 1 reverse. */
	s: number;
	/** 1 Again, 2 Hard, 3 Good, 4 Easy. */
	r: Grade;
	/** Desired retention used for this review; recorded for provenance, ignored by current replay. */
	dr: number;
}

export interface UndoEvent {
	v: 1;
	k: 'u';
	/** ISO timestamp, UTC. */
	t: string;
	/** Id of the review event this tombstone cancels. */
	u: string;
}

export type LogEvent = ReviewEvent | UndoEvent;
