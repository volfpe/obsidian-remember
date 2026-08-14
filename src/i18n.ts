// English interface copy lives here so additional locales can replace it without touching behavior.

export const STRINGS = {
	plugin: {
		reviewCommand: 'Review',
		reviewRibbon: 'Remember: review',
	},
	settings: {
		deckPropertyName: 'Deck property name',
		deckPropertyDescription: 'Frontmatter property that assigns a note to a deck, e.g. "deck: lang/spanish".',
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
		title: 'Remember',
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
			total: {
				label: 'Total',
				tooltip: 'All cards in this deck and its subdecks.',
			},
		},
		countHeaderAria: (label: string, tooltip: string) => `${label}: ${tooltip}`,
		progressSeparator: '/',
		progressAria: (current: number, total: number) => `Card ${current} of ${total}`,
		showAnswer: 'Show answer',
		ratings: {
			again: 'Again',
			hard: 'Hard',
			good: 'Good',
			easy: 'Easy',
		},
		undoAria: 'Undo last review',
	},
	notices: {
		duplicateCardId: (path: string) =>
			`Remember: duplicate card id in ${path} — delete one of the copied %%rem%% tokens.`,
		invalidDeckProperty: (path: string) =>
			`Remember: ${path} has an invalid deck property; expected a single value, not a list or object.`,
		couldNotSaveReview: (error: unknown) => `Remember: could not save the review — ${String(error)}`,
		couldNotSaveUndo: (error: unknown) => `Remember: could not save the undo — ${String(error)}`,
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
