import type { DirEntry, EntryKind } from "@lokio/types";
import type { LokioAdapter } from "./adapter.js";
import { AlreadyExistsError, InvalidPathError } from "./errors.js";
import { isWithin, joinPath } from "./path.js";

export interface TransferOptions {
  /** Replace an existing entry at the destination. Defaults to `false`. */
  overwrite?: boolean;
}

export interface WalkEntry {
  path: string;
  kind: EntryKind;
}

export interface WalkOptions {
  /** Return `false` to skip an entry (and, for directories, everything below it). */
  filter?: (entry: WalkEntry) => boolean;
  /** Include directories in the output. Defaults to `true`. */
  directories?: boolean;
}

/** Depth-first, pre-order traversal below `path` (not including `path` itself). */
export async function* walk(
  adapter: LokioAdapter,
  path: string,
  options: WalkOptions = {},
): AsyncGenerator<WalkEntry> {
  const entries: DirEntry[] = await adapter.readDir(path);
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const child: WalkEntry = { path: joinPath(path, entry.name), kind: entry.kind };
    if (options.filter && !options.filter(child)) continue;
    if (child.kind === "directory") {
      if (options.directories !== false) yield child;
      yield* walk(adapter, child.path, options);
    } else {
      yield child;
    }
  }
}

/** Deletes a file or a directory (recursively). */
export async function removeEntry(adapter: LokioAdapter, path: string): Promise<void> {
  if (path === "") throw new InvalidPathError(path, "refusing to delete the workspace root");
  const { kind } = await adapter.stat(path);
  if (kind === "file") await adapter.deleteFile(path);
  else await adapter.rmdir(path, { recursive: true });
}

async function prepareTransfer(
  adapter: LokioAdapter,
  from: string,
  to: string,
  options: TransferOptions,
): Promise<boolean> {
  if (from === "" || to === "") throw new InvalidPathError("", "cannot move or copy the root");
  if (from === to) return false;
  if (isWithin(from, to)) {
    throw new InvalidPathError(to, `cannot move or copy "${from}" into itself`);
  }
  await adapter.stat(from); // throws NotFoundError for a missing source
  if (await adapter.exists(to)) {
    if (!options.overwrite) throw new AlreadyExistsError(to);
    await removeEntry(adapter, to);
  }
  return true;
}

async function copyRecursive(adapter: LokioAdapter, from: string, to: string): Promise<void> {
  const { kind } = await adapter.stat(from);
  if (kind === "file") {
    await adapter.writeFile(to, await adapter.readFile(from));
    return;
  }
  await adapter.mkdir(to);
  for (const entry of await adapter.readDir(from)) {
    await copyRecursive(adapter, joinPath(from, entry.name), joinPath(to, entry.name));
  }
}

/** Copies a file or directory tree. Paths must be normalized. */
export async function copyEntry(
  adapter: LokioAdapter,
  from: string,
  to: string,
  options: TransferOptions = {},
): Promise<void> {
  if (!(await prepareTransfer(adapter, from, to, options))) return;
  await copyRecursive(adapter, from, to);
}

/** Moves/renames a file or directory tree, natively when the adapter supports it. */
export async function moveEntry(
  adapter: LokioAdapter,
  from: string,
  to: string,
  options: TransferOptions = {},
): Promise<void> {
  if (!(await prepareTransfer(adapter, from, to, options))) return;
  if (adapter.move) {
    await adapter.move(from, to);
    return;
  }
  await copyRecursive(adapter, from, to);
  await removeEntry(adapter, from);
}
