import { InvalidPathError } from "./errors.js";

/**
 * Lokio paths are always relative to the workspace root, use `/` as the
 * separator and never escape the root. The empty string denotes the root.
 *
 * Every path is normalized here, in core, so adapters receive canonical
 * input and don't each have to re-implement (and get wrong) path handling.
 */
export function normalizePath(path: string): string {
  const out: string[] = [];
  for (const segment of path.split(/[\\/]+/)) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (out.length === 0) throw new InvalidPathError(path, "escapes the workspace root");
      out.pop();
      continue;
    }
    if (segment.includes("\0")) throw new InvalidPathError(path, "contains a NUL byte");
    out.push(segment);
  }
  return out.join("/");
}

export function joinPath(...parts: string[]): string {
  return normalizePath(parts.filter(Boolean).join("/"));
}

/** Parent directory of a normalized path ("" for top-level entries and the root). */
export function dirname(path: string): string {
  const index = path.lastIndexOf("/");
  return index === -1 ? "" : path.slice(0, index);
}

/** Last segment of a normalized path ("" for the root). */
export function basename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/** Extension including the dot (`".md"`), or `""` when there is none. Dotfiles have no extension. */
export function extname(path: string): string {
  const name = basename(path);
  const index = name.lastIndexOf(".");
  return index <= 0 ? "" : name.slice(index);
}

/** True when `path` equals `parent` or lies inside it. Both must be normalized. */
export function isWithin(parent: string, path: string): boolean {
  return parent === "" || path === parent || path.startsWith(`${parent}/`);
}

/** Name of the folder Lokio and its plugins use for internal metadata (history, locks, ...). */
export const LOKIO_DIR = ".lokio";

/** True for paths inside the `.lokio` metadata folder. */
export function isInternalPath(path: string): boolean {
  return isWithin(LOKIO_DIR, path);
}
