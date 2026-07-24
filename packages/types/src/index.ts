/**
 * Shared, runtime-agnostic types used across Lokio packages.
 */

export type Awaitable<T> = T | Promise<T>;

export type EntryKind = "file" | "directory";

export interface EntryStat {
  kind: EntryKind;
  /** Size in bytes. Directories report 0. */
  size: number;
  /** Milliseconds since the Unix epoch. */
  lastModified: number;
}

export type PermissionMode = "read" | "readwrite";

export type PermissionState = "granted" | "denied" | "prompt";
