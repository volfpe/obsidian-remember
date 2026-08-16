// English interface copy lives here so additional locales can replace it without touching behavior.

export const STRINGS = {
	plugin: {
		viewTitle: 'Remember',
		openCommand: 'Open',
		openRibbon: 'Remember: open',
	},
	settings: {
		deckPropertyName: 'Deck property name',
		deckPropertyDescription: 'Frontmatter property that assigns a note to a deck, e.g. "deck: lang/spanish".',
		burySiblingsName: 'Bury sibling cards',
		burySiblingsDescription:
			'Show only one sibling from each card per study day (from reverse-direction or cloze cards).',
		limitNewCardsName: 'Limit new cards per day',
		limitNewCardsDescription:
			'When enabled, hold unseen cards for future days after the daily limit is reached.',
		newCardsName: 'New cards per day',
		newCardsDescription:
			'Maximum number of never-reviewed cards introduced from the selected deck each day.',
		newCardsValidation: 'Enter a whole number from 0 to 9999.',
		desiredRetentionName: 'Desired retention',
		desiredRetentionDescription: 'Fsrs target recall probability. Higher means shorter intervals.',
	},
	review: {
		noCards: (deckProperty: string) =>
			`No cards found. Give a note a "${deckProperty}" property and write "Question::Answer" lines.`,
		deckHeader: 'Deck',
		counts: {
			due: {
				label: 'Due',
				tooltip: 'Cards scheduled for review now.',
			},
			new: {
				label: 'New',
				tooltip: 'Never-reviewed cards available to introduce today.',
			},
			waiting: {
				label: 'Waiting',
				tooltip: 'Never-reviewed cards held for a future day by the daily limit.',
			},
			buried: {
				label: 'Buried',
				tooltip: 'Cards held until another study day so only one sibling from each card is eligible (from reverse-direction or cloze cards).',
			},
			total: {
				label: 'Total',
				tooltip: 'All cards in this deck and its subdecks.',
			},
		},
		progressSeparator: '/',
		progressAria: (current: number, total: number) => `Card ${current} of ${total}`,
		backToDecks: 'Back to deck',
		preparing: 'Preparing review…',
		showAnswer: 'Show answer',
		returnsThisSession: 'Returns later in this session',
		ratings: {
			again: 'Again',
			hard: 'Hard',
			good: 'Good',
			easy: 'Easy',
		},
		undoAria: 'Undo last review',
		openDefinition: 'Open card definition',
	},
	study: {
		backToDecks: 'Choose another deck',
		nothingReady: 'No cards to review',
		ready: (count: number) => `${count} ${count === 1 ? 'card' : 'cards'} ready`,
		startReview: 'Start review',
		forecast: {
			title: 'Upcoming 14 days',
			empty: 'No workload forecast for the next 14 days.',
			day: (offset: number) => `Day ${offset}`,
			cards: (count: number) => `${count} ${count === 1 ? 'card' : 'cards'}`,
			dayDescription: (offset: number, count: number) =>
				`Day ${offset}: ${count} ${count === 1 ? 'card' : 'cards'}.`,
		},
		tabs: {
			study: 'Study',
			cards: 'Cards',
			statistics: 'Statistics',
		},
		refresh: 'Refresh Remember data',
		openSettings: 'Open Remember settings',
		refreshFailed: 'Remember could not load the vault data. Try refreshing.',
		loading: 'Loading Remember data…',
		import: 'Import',
		importComingSoon: 'Import is not available yet.',
		placeholders: {
			statistics: 'Detailed review statistics will live here.',
		},
	},
	cards: {
		empty: 'No cards found.',
		emptyFront: 'Untitled card',
		detailTitle: 'Card details',
		backToList: 'Back to cards',
		front: 'Front',
		answer: 'Answer',
		history: 'Review history',
		noHistory: 'This card has not been reviewed yet.',
		openSource: (path: string) => `Open ${path}`,
		dueNow: 'Due',
		dueIn: (interval: string) => `In ${interval}`,
		notScheduled: '—',
		fields: {
			source: 'Source',
			sibling: 'Card',
			availability: 'Availability',
			state: 'State',
			due: 'Due',
		},
		availability: {
			due: 'Due',
			new: 'New',
			waiting: 'Waiting',
			buried: 'Buried',
			scheduled: 'Scheduled',
		},
		availabilityDescriptions: {
			due: 'Ready to review now.',
			new: 'Available to introduce in the next review.',
			waiting: 'New, but postponed by the daily new-card limit.',
			buried: 'Hidden for today because a sibling card is being reviewed.',
			scheduled: 'Already reviewed and scheduled for a future date.',
		},
		states: {
			new: 'New',
			learning: 'Learning',
			review: 'Review',
			relearning: 'Relearning',
		},
		stateDescriptions: {
			new: 'Never reviewed.',
			learning: 'Recently introduced and in short-term learning.',
			review: 'On the regular spaced-repetition schedule.',
			relearning: 'Previously learned and now in short-term recovery after a lapse.',
		},
		siblings: {
			forward: 'Forward',
			reverse: 'Reverse',
			cloze: (number: number) => `Cloze ${number}`,
		},
	},
	notices: {
		duplicateCardId: (path: string) =>
			`Remember: duplicate card id in ${path} — delete one of the copied %%rem%% tokens.`,
		invalidDeckProperty: (path: string) =>
			`Remember: ${path} has an invalid deck property; expected a single value, not a list or object.`,
		couldNotSaveReview: (error: unknown) => `Remember: could not save the review — ${String(error)}`,
		couldNotSaveUndo: (error: unknown) => `Remember: could not save the undo — ${String(error)}`,
		couldNotRefresh: (error: unknown) => `Remember: could not refresh — ${String(error)}`,
		couldNotStartSession: (error: unknown) =>
			`Remember: could not start the review session — ${String(error)}`,
		refreshComplete: 'Remember: refresh complete.',
		cardDefinitionMissing: (path: string) => `Remember: card definition not found in ${path}.`,
		couldNotOpenDefinition: (error: unknown) =>
			`Remember: could not open the card definition — ${String(error)}`,
	},
	intervals: {
		lessThanMinute: '<1m',
		minutes: (value: number) => `${value}m`,
		hours: (value: number) => `${value}h`,
		days: (value: number) => `${value}d`,
		months: (value: number) => `${value}mo`,
		years: (value: string) => `${value}y`,
	},
} as const;
