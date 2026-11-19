# Example: Node journal

A tiny command-line journal. Entries are plain Markdown files in `./journal-data` - open them in any
editor. Uses `@lokio/node`, the history plugin (previous versions in `.lokio/history`) and the search
plugin (diacritics-insensitive full-text search).

```sh
pnpm install && pnpm build          # in the repo root
cd examples/node-journal
node journal.js write "Dreamed about a red horse"
node journal.js write "Then about a žluťoučký kůň"
node journal.js search kun
node journal.js history
```
