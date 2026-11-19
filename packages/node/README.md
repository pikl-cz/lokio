# @lokio/node

Lokio adapter for Node.js, backed by `fs/promises`. Use it in Node, CLIs, Electron main processes and Tauri sidecars.

```sh
npm install @lokio/core @lokio/node
```

## Quick start

```ts
import { Lokio } from "@lokio/core";
import { NodeAdapter } from "@lokio/node";

const workspace = await Lokio.openWorkspace(new NodeAdapter({ root: "./my-notes" }));

await workspace.file("notes/today.md").write("# Today");
const stop = workspace.watch((event) => console.log(event.source, event.type, event.path));
```

## Options

| Option         | Default  | Description                                                                        |
| -------------- | -------- | ---------------------------------------------------------------------------------- |
| `root`         | required | Folder that becomes the workspace root. Nothing outside it is ever touched.        |
| `atomicWrites` | `true`   | Write to a temp file and rename it into place.                                     |
| `create`       | `true`   | Create the root folder if missing; with `false` a missing root throws `NOT_FOUND`. |
| `lockStaleMs`  | `30000`  | Age after which a lock file left by a crashed process may be taken over.           |

## Capabilities

| Capability          | Supported | Notes                                                                |
| ------------------- | --------- | -------------------------------------------------------------------- |
| `move`              | yes       | `fs.rename`; falls back to copy + delete across devices.             |
| `watch`             | yes       | Recursive `fs.watch`.                                                |
| `atomicWrite`       | yes       | Unless `atomicWrites: false`.                                        |
| `crossProcessLocks` | yes       | Lock files in `.lokio/locks/`.                                       |
| `permissions`       | no        | Node has no permission prompt; OS errors map to `PERMISSION_DENIED`. |

## Semantics and caveats

- **Sandboxing:** every path is resolved inside `root`. Paths that escape it throw `INVALID_PATH`, and the root can never be deleted or moved.
- **Atomic writes:** a crash mid-write never leaves a truncated file. Temp files (`*.lokio-tmp`) are hidden from listings and watchers.
- **Watching:**
  - Event types come from checking the disk, not from `fs.watch` directly, because platforms disagree (macOS reports in-place writes as `rename`).
  - Events may be coalesced or duplicated.
  - A file another app replaces atomically can be reported as `created`.
  - On filesystems without birth times, files that existed before watching started are reported as `created` on their first change.
  - Recursive `fs.watch` needs Node 20+ on Linux.
- **Locks:**
  - `lock(name, fn, { timeoutMs })` creates `.lokio/locks/<name>.lock` exclusively and waits up to `timeoutMs` (default 10s) before throwing `LOCK_TIMEOUT`.
  - Held locks are refreshed while `fn` runs, so long tasks aren't treated as abandoned.
  - Stale-lock takeover is best effort. Two processes that detect the same stale lock at the same moment can, rarely, both proceed.
  - Locks work on local disks; network filesystems may not honour exclusive create.
- **Symlinks** are followed. A listing reports the kind of the link's target, and a broken link is reported as a file.
- `close()` (called by `workspace.close()`) stops all watchers.
