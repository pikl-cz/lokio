# @lokio/plugin-history

Keeps previous versions of files. Before a file is overwritten, deleted or moved (and before a directory is deleted recursively), Lokio copies the old bytes to `.lokio/history/<path>.history/<id>`.

```sh
pnpm add @lokio/core @lokio/plugin-history
```

```ts
import { Lokio } from "@lokio/core";
import { history } from "@lokio/plugin-history";

const workspace = await Lokio.openWorkspace(adapter);
const versions = await workspace.use(history({ maxVersions: 50 }));

await workspace.file("notes/today.md").write("v1");
await workspace.file("notes/today.md").write("v2");

const [latest] = await versions.versions("notes/today.md"); // newest first
await versions.readText("notes/today.md", latest.id); // "v1"
await versions.restore("notes/today.md", latest.id);
```

## Options

| Option        | Default          | Description                                            |
| ------------- | ---------------- | ------------------------------------------------------ |
| `dir`         | `.lokio/history` | Where snapshots are stored.                            |
| `maxVersions` | `20`             | Versions kept per file. Older ones are pruned.         |
| `include`     | all files        | `(path) => boolean`. Choose which files are versioned. |

Files inside `.lokio/` and the history folder are never versioned.

## API

- `versions(path)`: `{ id, timestamp, size }[]`, newest first.
- `read(path, id)` / `readText(path, id)`: the content of a version.
- `restore(path, id)`: writes the version back. The current content is snapshotted first, so a restore can be undone.
- `clear(path?)`: deletes the history of one file, or all history.

## Caveats

- Snapshots are full copies, not diffs. Use `include` to leave out large binary files.
- Recursive directory deletes read every file under the directory so they can be snapshotted.
- With [`@lokio/plugin-encryption`](../plugin-encryption), snapshots are encrypted too, whichever plugin you `use()` first. Encryption covers `.lokio/history` by default.
