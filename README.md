# Remember

A Markdown-native spaced repetition plugin for Obsidian with FSRS scheduling.

Built for reliable use across synced devices.

## Usage

Every flashcard is a Markdown note in your Remember folder (`Remember/` by default). Use subfolders to organize cards into decks and subdecks.

Run **Remember: Open** (or click the button in the left toolbar). Then click **New card** to add a card or select a deck and start a review.

The plugin automatically manages the card's frontmatter. See [Card metadata](#card-metadata) for details.

### Basic cards

```markdown
# Front

hola

# Back

hello
```

Enable **Reverse** when creating a card (or set `remember-reverse: true` in its frontmatter) to also create a virtual card in the reverse direction.

### Cloze cards

A cloze card hides marked text in its surrounding context. The whole note body is the card:

```markdown
The capital of ==c1:France== is ==c2:Paris==.
```

Each `cN` is a required, stable card number. The example above creates two cards:

- `c1`: `The capital of […] is Paris.`
- `c2`: `The capital of France is […].`

Use the same number to hide related answers together as a single card:

```markdown
The capital of France is ==c1:Paris==, and its currency is the ==c1:euro==.
```

This creates one card that hides both highlighted clozes:

- `c1`: `The capital of France is […], and its currency is the […].`

### Suspending cards

Add `remember-suspend: true` to the frontmatter to exclude a card from reviews without deleting its history.

### Adding existing notes

You can also create a note directly in the Remember folder and add `# Front`/`# Back` sections or a cloze marker. Remember adds the missing frontmatter when it opens.

## Card metadata

Card frontmatter uses the following properties:

- `remember-id` — the generated stable card identifier
- `remember-type` — the card format: `basic` or `cloze`
- `remember-reverse` — whether a basic card also appears in the reverse direction
- `remember-suspend` — whether the card is excluded from reviews

## Deck settings

Add an optional `_remember.md` note to a deck folder to override settings for that deck. Put the settings in the note's frontmatter.

```yaml
---
remember-desired-retention: 0.95
remember-limit-new-cards-per-day: true
remember-new-cards-per-day: 10
remember-bury-siblings: false
remember-learn-ahead: true
remember-learn-ahead-minutes: 5
---
```

Missing settings come from the closest parent deck. Global Remember settings are used when no deck overrides them.

## Multi-device sync

When using Obsidian Sync, enable **Settings → Sync → Selective sync → Sync all other types** on every device.

## Data storage

All data stays local in your vault. Remember makes no network requests.

Review history is saved in `<device-id>.rememberlog` files in the Remember folder. The schedule is calculated from these files, so do not delete them.
