# @lokio/auto

Open a Lokio workspace with the right adapter for the current runtime - one import for apps that run in Node and in the browser.

```sh
npm install @lokio/core @lokio/auto
```

```ts
import { openWorkspace } from "@lokio/auto";

const workspace = await openWorkspace({ root: "./notes" }); // Node: NodeAdapter
```

Bundlers and Node pick the right build through [conditional exports](https://nodejs.org/api/packages.html#conditional-exports) (`browser` / `node`), so the browser bundle never contains `node:fs`.

## Node

Uses `NodeAdapter` rooted at `options.root` (default `process.cwd()`), creating the folder if it is missing.

## Browser

Tries, in order:

1. The folder saved under `persistKey` (default `"default"`) - if permission is granted, or once `requestPermission: true` gets it granted.
2. The directory picker, if `pick: true`. The chosen folder is saved under `persistKey`.
3. The Origin Private File System, if `fallback: "opfs"`.

Otherwise it throws a `LokioError` that says what to do: `PERMISSION_DENIED` (a folder is saved but needs permission again), `NOT_SUPPORTED` (no File System Access API - use `fallback: "opfs"`) or `NOT_FOUND` (no folder chosen yet).

Picking and requesting permission need a user gesture:

```ts
// On startup: reuse the folder if the browser still allows it.
const workspace = await openWorkspace().catch(() => undefined);

// In a click handler: ask again, or let the user choose a folder.
button.onclick = async () => {
  const workspace = await openWorkspace({ requestPermission: true, pick: true });
};
```

## Options

| Option              | Runtime | Default         | Description                                                      |
| ------------------- | ------- | --------------- | ---------------------------------------------------------------- |
| `root`              | Node    | `process.cwd()` | Workspace folder.                                                |
| `persistKey`        | Browser | `"default"`     | IndexedDB key for the remembered folder.                         |
| `mode`              | Browser | `"readwrite"`   | Permission mode to check or request.                             |
| `requestPermission` | Browser | `false`         | Prompt again for a remembered folder (user gesture).             |
| `pick`              | Browser | `false`         | Show the directory picker if needed (user gesture).              |
| `pickerId`          | Browser | -               | `id` for `showDirectoryPicker`, so it remembers its location.    |
| `fallback`          | Browser | `"none"`        | `"opfs"` to use the Origin Private File System as a last resort. |
| `plugins`           | both    | `[]`            | Plugins installed before the workspace is returned.              |
| `echoSuppressionMs` | both    | `500`           | See `WorkspaceOptions` in `@lokio/core`.                         |
