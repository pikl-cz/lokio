/**
 * Shared, runtime-agnostic types used across Lokio packages.
 */

export type Awaitable<T> = T | Promise<T>;

export type Unsubscribe = () => void;

export type EntryKind = "file" | "directory";

export interface EntryStat {
  kind: EntryKind;
  /** Size in bytes. Directories report 0. */
  size: number;
  /** Milliseconds since the Unix epoch, or 0 when the runtime cannot tell (e.g. browser directories). */
  lastModified: number;
}

/** A directory entry as returned by `readDir`. */
export interface DirEntry {
  name: string;
  kind: EntryKind;
}

export type PermissionMode = "read" | "readwrite";

export type PermissionState = "granted" | "denied" | "prompt";

/**
 * What happened to an entry.
 * `unknown` means the runtime only knows *something* changed at that path
 * (e.g. a browser observer overflow) - re-read it.
 */
export type ChangeType = "created" | "modified" | "deleted" | "unknown";

export interface ChangeEvent {
  type: ChangeType;
  /** Normalized workspace-relative path. */
  path: string;
  /** Unknown for deletions reported by some runtimes. */
  kind?: EntryKind;
  /**
   * `local`: the change was made through this workspace.
   * `external`: reported by the adapter's watcher (another app, another tab, the user).
   */
  source: "local" | "external";
}

/** Raw change notification produced by an adapter watcher. */
export type WatchEvent = Omit<ChangeEvent, "source">;

/** Feature flags describing what an adapter (or adapter stack) supports. */
export interface AdapterCapabilities {
  /** Reports external changes via `watch()`. */
  watch: boolean;
  /** Has a native, cheap `move()` (rename). Otherwise core falls back to copy + delete. */
  move: boolean;
  /** `writeFile` never leaves a half-written file behind. */
  atomicWrite: boolean;
  /** Has a permission model (`queryPermission` / `requestPermission`). */
  permissions: boolean;
  /** Provides locks that work across processes/tabs, not just within this JS realm. */
  crossProcessLocks: boolean;
}
