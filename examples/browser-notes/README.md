# Example: browser notes

A notes app whose data is just Markdown files in a folder the user picks - editable in any other editor
at the same time. Shows `@lokio/auto` (remembered folder, picker, OPFS fallback), live external changes
via `workspace.watch` and `@lokio/plugin-search`.

```sh
pnpm install && pnpm build   # in the repo root
pnpm --filter @lokio-examples/browser-notes dev
```

Open it in Chrome or Edge (File System Access API). Other browsers fall back to the Origin Private
File System - notes then live inside the browser instead of a visible folder.
