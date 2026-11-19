# @lokio/core

The runtime-agnostic heart of [Lokio](https://github.com/pikl-cz/lokio): workspaces, files, directories,
change events, locks, errors and the plugin API. It has no runtime dependencies and never touches
`node:*` or `window` - pair it with an adapter such as [`@lokio/node`](../node) or
[`@lokio/browser`](../browser), or use [`@lokio/auto`](../auto) to pick one for you.

```sh
npm install @lokio/core @lokio/node      # or @lokio/browser
```

## Quick start

```ts
import { Lokio } from "@lokio/core";
import { NodeAdapter } from "@lokio/node";

const workspace = await Lokio.openWorkspace(new NodeAdapter({ root: "./my-notes" }));

const today = workspace.file("journal/2026-11-19.md");
await today.write("# Today\n");
console.log(await today.readText());

await workspace.file("settings.json").updateJSON<{ theme?: string }>((current) => ({
  ...current,
  theme: "dark",
}));

for (const entry of await workspace.directory("journal").list()) {
  console.log(entry.kind, entry.name);
}
```

## Concepts

### Paths

Every path is **relative to the workspace root**, uses `/`, and is normalized by core: `\`, `.`, `..` and
duplicate slashes are handled. A path that would escape the root throws `InvalidPathError`, so user input
can't reach files outside the workspace. `""` is the root.

### Files - `workspace.file(path)` → `LokioFile`

Creating a handle never touches the disk.

| Method                                           | Description                                                            |
| ------------------------------------------------ | ---------------------------------------------------------------------- |
| `read()` / `readText()` / `readJSON<T>()`        | Read contents                                                          |
| `write(data)` / `writeJSON(value)`               | Write (creates parent directories)                                     |
| `updateText(fn)` / `updateJSON(fn)`              | Read-modify-write **under a lock** - concurrent updates are never lost |
| `moveTo(path)` / `copyTo(path)` / `rename(name)` | Return a handle to the new location. `{ overwrite: true }` to replace  |
| `stat()` / `exists()` / `delete()`               |                                                                        |
| `name`, `extension`, `parentPath`, `path`        |                                                                        |

### Directories - `workspace.directory(path)` → `LokioDirectory`

`list()` (entries with `kind`, sorted), `files()`, `directories()`, `walk({ filter, directories })`
(recursive async iterator), `create()`, `delete({ recursive })`, `moveTo`, `copyTo`, `rename`, `file()`,
`directory()`, `parent`. The root can't be deleted.

### Workspace

```ts
workspace.move("a.md", "archive/a.md"); // files or whole trees; native rename when available
workspace.copy("templates", "new-project");
workspace.remove("tmp"); // file or directory, recursively

workspace.capabilities; // { watch, move, atomicWrite, permissions, crossProcessLocks }
await workspace.requestPermission("readwrite"); // browser: call from a click handler
await workspace.close(); // disposes plugins, stops watchers
```

### Change events

```ts
const stop = workspace.watch(
  (event) => {
    // { type: "created" | "modified" | "deleted" | "unknown", path, kind?, source: "local" | "external" }
    console.log(event.source, event.type, event.path);
  },
  { path: "journal" },
);
```

- **local** events fire for every change made through the workspace, immediately.
- **external** events come from the adapter's watcher (other apps, other tabs) when
  `capabilities.watch` is true. The watcher starts with the first subscriber and stops with the last.
- Watchers usually echo your own writes back; those echoes are dropped for `echoSuppressionMs` (default
  500 ms, option of `openWorkspace`).
- Paths inside the internal `.lokio/` folder are hidden unless `includeInternal: true`.

### Locks

```ts
await workspace.lock("sync", async () => {
  /* only one at a time */
});
```

Always exclusive within the current JS realm; also across processes/tabs when the adapter provides locks
(`capabilities.crossProcessLocks` - lock files in Node, Web Locks in browsers). `file.updateText/updateJSON`
use this automatically.

### Errors

All failures are `LokioError`s with a stable `code`:
`NOT_FOUND`, `TYPE_MISMATCH`, `NOT_EMPTY`, `ALREADY_EXISTS`, `INVALID_PATH`, `PERMISSION_DENIED`,
`NOT_SUPPORTED`, `WORKSPACE_CLOSED`, `LOCK_TIMEOUT`, `UNKNOWN`. The original runtime error is in `cause`.

```ts
import { isLokioError } from "@lokio/core";

try {
  await workspace.file("missing.md").readText();
} catch (error) {
  if (isLokioError(error, "NOT_FOUND")) {
    /* ... */
  }
}
```

Prefer `isLokioError` over `instanceof` - it keeps working if your bundle ends up with two copies of
`@lokio/core`.

## Plugins

```ts
import { AdapterWrapper, definePlugin, type LokioAdapter } from "@lokio/core";

class Logging extends AdapterWrapper {
  override async writeFile(path: string, data: Uint8Array) {
    console.log("write", path, data.byteLength);
    return this.inner.writeFile(path, data);
  }
}

export const logging = () =>
  definePlugin({
    name: "logging",
    wrapAdapter: (adapter: LokioAdapter) => new Logging(adapter), // optional: decorate I/O
    setup: (workspace) => ({ count: () => 0 }), // optional: returns the plugin API
    dispose: () => {}, // optional
  });

const api = await workspace.use(logging()); // typed API
await workspace.unuse("logging");
// or: Lokio.openWorkspace({ adapter, plugins: [logging()] })
```

Wrappers apply to handles created before the plugin was added, and are stacked in `use()` order (last is
outermost). Official plugins: [history](../plugin-history), [encryption](../plugin-encryption),
[search](../plugin-search).

## Writing an adapter

Implement `LokioAdapter` (see the JSDoc for the exact contract) and run the shared conformance suite:

```ts
import { describeAdapterConformance } from "@lokio/testing/conformance";

describeAdapterConformance("MyAdapter", () => new MyAdapter());
```

Optional methods - `move`, `watch`, `lock`, `queryPermission`/`requestPermission`, `close` - unlock the
corresponding capabilities; core falls back sensibly when they are missing (e.g. move → copy + delete).

## License

MIT
