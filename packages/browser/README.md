# @lokio/browser

Lokio adapter for browsers, backed by the [File System Access API](https://developer.mozilla.org/docs/Web/API/File_System_API) (a real folder the user picks) or the Origin Private File System (OPFS).

```sh
npm install @lokio/core @lokio/browser
```

## Quick start

```ts
import { Lokio } from "@lokio/core";
import { BrowserAdapter } from "@lokio/browser";

button.addEventListener("click", async () => {
  // Must run inside a user gesture. The handle is remembered in IndexedDB.
  const adapter = await BrowserAdapter.pick({ persistAs: "notes" });
  const workspace = await Lokio.openWorkspace(adapter);
  await workspace.file("today.md").write("# Today");
});
```

### Reopening the folder after a reload

Browsers keep the saved handle but usually reset its permission. `restore()` returns the adapter anyway (or `null` if nothing was saved) - check the permission and, if needed, ask for it from a user gesture:

```ts
const adapter = await BrowserAdapter.restore("notes");
if (adapter && (await adapter.queryPermission()) === "granted") {
  open(adapter);
} else if (adapter) {
  reopenButton.onclick = async () => {
    if ((await adapter.requestPermission()) === "granted") open(adapter);
  };
}
```

`@lokio/auto` wraps this whole flow in a single `openWorkspace()` call.

### OPFS

No picker, no permission prompt, available in all modern browsers - but invisible to the user (no "real" files they can open in another app):

```ts
const workspace = await Lokio.openWorkspace(await BrowserAdapter.opfs());
```

## API

| Member                                         | Description                                                           |
| ---------------------------------------------- | --------------------------------------------------------------------- |
| `BrowserAdapter.isSupported()`                 | Whether `showDirectoryPicker` exists (Chromium-based browsers).       |
| `BrowserAdapter.pick({ mode, id, persistAs })` | Shows the directory picker. `mode` defaults to `"readwrite"`.         |
| `BrowserAdapter.restore(key, { mode })`        | Reopens a persisted handle, or `null`.                                |
| `BrowserAdapter.opfs()`                        | Adapter over the Origin Private File System.                          |
| `BrowserAdapter.fromHandle(handle, mode?)`     | Wraps any `FileSystemDirectoryHandle` (e.g. from drag & drop).        |
| `adapter.queryPermission(mode?)`               | Current permission state, without prompting.                          |
| `adapter.requestPermission(mode?)`             | Prompts only if the state is `"prompt"`. Needs a user gesture.        |
| `saveHandle` / `loadHandle` / `deleteHandle`   | Low-level IndexedDB handle store (database `lokio`, store `handles`). |

## Capabilities

Detected at runtime:

| Capability          | When                                        | Notes                                                                                |
| ------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------ |
| `atomicWrite`       | always                                      | Writes go to a swap file; a failed write is aborted and never replaces the original. |
| `move`              | `FileSystemHandle.move()` exists (Chromium) | Files move natively; directories (no native `move()`) are copied.                    |
| `watch`             | `FileSystemObserver` exists (Chromium 129+) | `unknown`/`errored` records become an `unknown` change - re-scan.                    |
| `crossProcessLocks` | Web Locks API exists                        | Cross-tab locks named `lokio:<name>`; `timeoutMs` throws `LOCK_TIMEOUT`.             |
| `permissions`       | always                                      | Handles without a permission model (OPFS) report `"granted"`.                        |

## Errors

`DOMException`s are translated to Lokio errors: `NotFoundError` → `NOT_FOUND`, `TypeMismatchError` → `TYPE_MISMATCH`, `NotAllowedError`/`SecurityError` → `PERMISSION_DENIED`, `InvalidModificationError` → `NOT_EMPTY` (rmdir) or `ALREADY_EXISTS` (move). Everything else becomes a `LokioError` with the original error as `cause`.

## Caveats

- Directories have no modification time in this API - `stat().lastModified` is `0` for them.
- Firefox and Safari support only the OPFS, not `showDirectoryPicker`.

## Testing

`@lokio/testing/fs-access` ships an in-memory fake of the File System Access API, so you can unit-test code built on this adapter in Node. The real-browser suite runs with `pnpm test:browser` (Vitest browser mode + Playwright, against the OPFS).
