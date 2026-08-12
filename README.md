# Remember

A minimal spaced repetition inside Obsidian.

Designed for reliable use across synced devices.

## Usage

Add a `deck` property to the note:

```markdown
---
deck: lang/spanish
---
```

A single-line card has its question and answer on one line, separated by `::`:

```markdown
hola::hello
```

Use `:::` to also create a card in the reverse direction:

```markdown
perro:::dog
```

A multi-line card has `?` on its own line between the question and answer:

```markdown
What article does "mano" take?
?
La mano — feminine despite the -o ending.
```

Use `??` instead of `?` to also create a card in the reverse direction.

Run **Remember: Review**, choose a deck, reveal each answer, and rate it.

## Data storage

Remember stores all data locally in your vault.

- When a review session starts, Remember adds hidden `%%rem:<id>%%` comments to unstamped cards.
- Review history is stored as per-device `reviews-*.jsonl` files in `_remember` by default. You can change this folder in the plugin settings.