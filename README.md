# Remember

A spaced repetition plugin for Obsidian with FSRS scheduling.

Built for reliable use across synced devices.

## Usage

Every card is one Markdown note inside the **Remember** folder (configurable in settings). Folders inside it are decks; nested folders are subdecks.

Create a card with the **Remember: new card** command or  button in the left toolbar. New decks are made by creating folders.

To review, run the **Remember: Open** command or click its toolbar icon.

### Basic cards

```markdown
---
remember-id: k2mf9x1a0q7b3c8d
remember-type: basic
remember-reverse: false
---

# Front

hola

# Back

hello
```

Set `remember-reverse: true` to also create a card in the reverse direction.

### Cloze cards

A cloze card hides marked text in its surrounding context. The whole note body is the card:

```markdown
---
remember-id: k2mf9x1a0q7b3c8e
remember-type: cloze
---

The capital of {{c1::France}} is {{c2::Paris}}.
```

Each `cN` is a required, stable card number.

### Suspending cards

Add `remember-suspend: true` to the frontmatter to exclude a card from reviews without deleting its history.

### Adding existing notes

Create any note into the Remember folder and give it `# Front`/`# Back` sections or a cloze marker. Remember adds the missing frontmatter when it opens.

## Multi-device sync

When using Obsidian Sync, enable **Settings → Sync → Selective sync → Sync all other types** on every device.

## Data storage

Remember stores all data locally in your vault: cards are plain Markdown notes, and review history lives in `reviews-<device-id>.rememberlog` files in the Remember folder. The schedule is calculated from these files, so do not delete them.
