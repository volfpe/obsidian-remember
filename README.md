# Remember

A Markdown-native spaced repetition plugin for Obsidian with FSRS scheduling.

Built for reliable use across synced devices.

## Usage

Every flashcard is a Markdown note in your Remember folder. Use folders and subfolders to organize cards into decks and subdecks.

To create a card, run **Remember: new card** or click its left toolbar button.

To review, run the **Remember: Open** command or click its left toolbar icon.

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

Each card's frontmatter contains:

- `remember-id` — the generated stable card identifier
- `remember-type` — the card format: `basic` or `cloze`
- `remember-reverse` — whether a basic card also appears in the reverse direction
- `remember-suspend` — whether the card is excluded from reviews

## Multi-device sync

When using Obsidian Sync, enable **Settings → Sync → Selective sync → Sync all other types** on every device.

## Data storage

All data stays local in your vault. Remember makes no network requests.

Review history is saved in `reviews-<device-id>.rememberlog` files in the Remember folder. The schedule is calculated from these files, so do not delete them.
