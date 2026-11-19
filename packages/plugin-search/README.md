# @lokio/plugin-search

An in-memory full-text search over a Lokio workspace. The index updates itself from workspace change events, both from your own writes and from external edits when the adapter can watch for them.

```sh
pnpm add @lokio/core @lokio/plugin-search
```

```ts
import { search } from "@lokio/plugin-search";

const index = await workspace.use(search());
await index.ready;

index.query("kun"); // finds "Žluťoučký kůň" – case and diacritics are folded
index.query("dog bark"); // all terms must match; the last one is a prefix
index.query("milk horse", { mode: "any", path: "notes", limit: 5 });
// -> [{ path, score, snippet }]
```

## Options

| Option        | Default                     | Description                                                |
| ------------- | --------------------------- | ---------------------------------------------------------- |
| `extensions`  | `.md .txt .json .html .csv` | Which files are indexed (case-insensitive).                |
| `maxFileSize` | `1_000_000`                 | Larger files are skipped.                                  |
| `mode`        | `"all"`                     | Default for `query`: `"all"` terms must match, or `"any"`. |

## API

- `ready`: resolves once the initial index is built.
- `query(text, { limit = 20, path, mode })`: results ranked by TF-IDF. An exact term match counts twice as much as a prefix match.
- `size`: the number of indexed files.
- `idle()`: resolves once all queued updates have been applied.
- `reindex()`: rebuilds the index from scratch.

## Caveats

- The index lives in memory. The full text of every indexed file is kept for snippets, so it suits personal-scale workspaces with thousands of files, not millions.
- The tokenizer splits on anything that isn't a letter or a digit. There is no stemming and no special handling for CJK text.
- It reads files through the workspace, so with `@lokio/plugin-encryption` it indexes plaintext, but only in memory.
