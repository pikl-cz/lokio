import type {
  AdapterCapabilities,
  DirEntry,
  EntryStat,
  PermissionMode,
  PermissionState,
  Unsubscribe,
  WatchEvent,
} from "@lokio/types";

/**
 * The contract every runtime adapter (browser, node, ...) must implement.
 * Applications never talk to a runtime API directly - only through this interface.
 *
 * Contract (verified by `describeAdapterConformance` in @lokio/testing):
 * - Paths are already normalized by core: relative, `/`-separated, no `.`/`..`;
 *   `""` is the workspace root.
 * - Failures are reported as Lokio errors (`NotFoundError`, `TypeMismatchError`,
 *   `NotEmptyError`, `AlreadyExistsError`, `PermissionDeniedError`), never raw runtime errors.
 * - `writeFile` creates missing parent directories.
 * - `deleteFile` only deletes files; `rmdir` only deletes directories.
 */
export interface LokioAdapter {
  readonly name: string;
  /** Overrides for capabilities that cannot be inferred from the presence of optional methods. */
  readonly capabilities?: Partial<AdapterCapabilities>;

  /** Resolves to `false` only when the entry is missing; other failures reject. */
  exists(path: string): Promise<boolean>;
  stat(path: string): Promise<EntryStat>;

  readFile(path: string): Promise<Uint8Array>;
  writeFile(path: string, data: Uint8Array): Promise<void>;
  deleteFile(path: string): Promise<void>;

  readDir(path: string): Promise<DirEntry[]>;
  /** Creates the directory and any missing parents. No-op if it already exists. */
  mkdir(path: string): Promise<void>;
  /** Never called with the root (`""`) - core refuses that. */
  rmdir(path: string, options?: { recursive?: boolean }): Promise<void>;

  /**
   * Optional native rename. Core guarantees `from` exists, `to` does not exist
   * and `to` is not inside `from`. Must create missing parents of `to`.
   * Without it, core falls back to copy + delete.
   */
  move?(from: string, to: string): Promise<void>;

  /** Optional: report external changes below `path` (recursively). */
  watch?(path: string, listener: (event: WatchEvent) => void): Unsubscribe | Promise<Unsubscribe>;

  /** Optional: a lock shared across processes/tabs. Core always adds an in-process lock on top. */
  lock?<T>(name: string, fn: () => Promise<T>, options?: { timeoutMs?: number }): Promise<T>;

  /** Optional: not every runtime has a permission model (e.g. Node has none). */
  queryPermission?(mode: PermissionMode): Promise<PermissionState>;
  requestPermission?(mode: PermissionMode): Promise<PermissionState>;

  /** Optional: release resources (watchers, handles). Called by `workspace.close()`. */
  close?(): Promise<void>;
}

/** Resolves the effective capabilities of an adapter (or adapter stack). */
export function getCapabilities(adapter: LokioAdapter): AdapterCapabilities {
  return {
    watch: typeof adapter.watch === "function",
    move: typeof adapter.move === "function",
    atomicWrite: false,
    permissions: typeof adapter.requestPermission === "function",
    crossProcessLocks: typeof adapter.lock === "function",
    ...adapter.capabilities,
  };
}

/**
 * Base class for adapter decorators (encryption, history, logging, ...).
 * Forwards every call to `inner`, including optional methods - but only the
 * optional methods `inner` actually has, so capabilities stay truthful.
 * Override just the methods you need.
 */
// Declaration merging: the optional methods are declared as (optional) methods,
// not properties, so subclasses can override them with ordinary methods.
export interface AdapterWrapper {
  move?(from: string, to: string): Promise<void>;
  watch?(path: string, listener: (event: WatchEvent) => void): Unsubscribe | Promise<Unsubscribe>;
  lock?<T>(name: string, fn: () => Promise<T>, options?: { timeoutMs?: number }): Promise<T>;
  queryPermission?(mode: PermissionMode): Promise<PermissionState>;
  requestPermission?(mode: PermissionMode): Promise<PermissionState>;
}

// biome-ignore lint/suspicious/noUnsafeDeclarationMerging: intentional, see above
export class AdapterWrapper implements LokioAdapter {
  readonly name: string;

  constructor(protected readonly inner: LokioAdapter) {
    this.name = inner.name;
    // Only fill in optional methods a subclass hasn't overridden.
    if (inner.move && !this.move) this.move = (from, to) => inner.move!(from, to);
    if (inner.watch && !this.watch) this.watch = (path, listener) => inner.watch!(path, listener);
    if (inner.lock && !this.lock) this.lock = (name, fn, options) => inner.lock!(name, fn, options);
    if (inner.queryPermission && !this.queryPermission) {
      this.queryPermission = (mode) => inner.queryPermission!(mode);
    }
    if (inner.requestPermission && !this.requestPermission) {
      this.requestPermission = (mode) => inner.requestPermission!(mode);
    }
  }

  get capabilities(): Partial<AdapterCapabilities> | undefined {
    return this.inner.capabilities;
  }

  exists(path: string): Promise<boolean> {
    return this.inner.exists(path);
  }
  stat(path: string): Promise<EntryStat> {
    return this.inner.stat(path);
  }
  readFile(path: string): Promise<Uint8Array> {
    return this.inner.readFile(path);
  }
  writeFile(path: string, data: Uint8Array): Promise<void> {
    return this.inner.writeFile(path, data);
  }
  deleteFile(path: string): Promise<void> {
    return this.inner.deleteFile(path);
  }
  readDir(path: string): Promise<DirEntry[]> {
    return this.inner.readDir(path);
  }
  mkdir(path: string): Promise<void> {
    return this.inner.mkdir(path);
  }
  rmdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    return this.inner.rmdir(path, options);
  }
  async close(): Promise<void> {
    await this.inner.close?.();
  }
}
