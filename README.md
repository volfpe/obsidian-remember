# Remember

A minimal spaced repetition plugin for Obsidian.

Designed for reliable use across synced devices.

## Usage

Add a `deck` property to the note:

```markdown
---
deck: lang/spanish
---
```

### Single-line cards

A single-line card has its question and answer on one line, separated by `::`:

```markdown
hola::hello
```

Use `:::` to also create a card in the reverse direction:

```markdown
perro:::dog
```

### Multi-line cards

A multi-line card has `?` on its own line between the question and answer:

```markdown
What article does "mano" take?
?
La mano — feminine despite the -o ending.
```

Use `??` to also create a card in the reverse direction.

### Cloze cards

A cloze card hides marked text in its surrounding context:

```markdown
The capital of {{c1::France}} is {{c2::Paris}}.
```

Each `cN` is a required, stable sibling number. Clozes are single-line.

## Reviewing

Click the **Remember: review** button in the left panel to start a review.
You can also run `Remember: Review` command.

## Multi-device sync

When using Obsidian Sync, enable **Settings → Sync → Selective sync → Sync all other types** on every device.


## Data storage

Remember stores all data locally in your vault.

- When a review session starts, Remember adds hidden `%%rem:<id>%%` comments to unstamped cards.
- Review history is stored in the vault root in `reviews-<device-id>.rememberlog` files. Remember uses these files to calculate each card’s schedule, so do not delete them.
