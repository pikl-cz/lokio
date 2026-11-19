# @lokio/testing

Testing helpers for Lokio apps, plugins and adapters.

```sh
npm install -D @lokio/testing
```

## MemoryAdapter

A fully in-memory adapter that behaves like a real filesystem (explicit directories, copied buffers, `move`, `watch`). Use it in unit tests, Storybook stories and demos.

```ts
import { Lokio } from "@lokio/core";
import { MemoryAdapter } from "@lokio/testing";

const adapter = new MemoryAdapter({ files: { "notes/a.md": "# A" }, now: () => 0 });
const workspace = await Lokio.openWorkspace(adapter);

// Writing through the adapter directly simulates a change made by another app:
await adapter.writeFile("notes/b.md", new TextEncoder().encode("from outside"));
```

## Adapter conformance suite

Every adapter must behave the same. Writing your own (Tauri, Electron, S3, ...)? Run the shared contract with Vitest:

```ts
import { describeAdapterConformance } from "@lokio/testing/conformance";

describeAdapterConformance("MyAdapter", () => new MyAdapter(), {
  cleanup: (adapter) => adapter.close?.(),
});
```

Checks for optional methods (`move`, `watch`, `lock`) are skipped when the adapter doesn't implement them.

Without Vitest, run the same checks yourself - this is what `lokio doctor` does:

```ts
import { runAdapterChecks } from "@lokio/testing";

const results = await runAdapterChecks(() => new MyAdapter());
for (const r of results) console.log(r.status, r.name, r.error ?? "");
```

## Fake File System Access API

`@lokio/testing/fs-access` is an in-memory fake of the browser's File System Access API, for testing browser code (such as `BrowserAdapter`) in Node:

```ts
import { BrowserAdapter } from "@lokio/browser";
import { createFakeFileSystem } from "@lokio/testing/fs-access";

const fs = createFakeFileSystem({ permission: "prompt", requestResult: "granted" });
vi.stubGlobal("FileSystemObserver", fs.Observer); // optional: enable watch()
const adapter = BrowserAdapter.fromHandle(fs.root);

fs.setPermission("readwrite", "denied"); // the user revoked access
fs.failNextWrite("QuotaExceededError"); // the disk is full
```

It mirrors browser behaviour where it matters:

- `getFileHandle` / `getDirectoryHandle` with `{ create }`, `removeEntry` with `{ recursive }`, `keys` / `values` / `entries` / async iteration, `resolve`, `isSameEntry`.
- `DOMException` names as in Chromium: `NotFoundError`, `TypeMismatchError`, `InvalidModificationError`, `NotAllowedError`.
- Swap-file writes: `createWritable()` changes nothing until `close()`; `abort()` discards. `fs.openWritables` tells you whether code forgot to close or abort a stream.
- Permissions: `queryPermission` / `requestPermission`, enforced on every operation.
- `move()` on handles (`supportsMove: false` to hide it) and a `FileSystemObserver` implementation (`fs.Observer`).

`createFakeDirectoryHandle(name, options)` is a shorthand that returns just the root handle.
