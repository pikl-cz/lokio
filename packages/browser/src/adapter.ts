import {
  basename,
  dirname,
  InvalidPathError,
  joinPath,
  LockTimeoutError,
  type LokioAdapter,
  NotSupportedError,
  TypeMismatchError,
} from "@lokio/core";
import type {
  DirEntry,
  EntryStat,
  PermissionMode,
  PermissionState,
  Unsubscribe,
  WatchEvent,
} from "@lokio/types";
import { isMissing, toLokioError } from "./errors.js";
import { loadHandle, saveHandle } from "./handle-store.js";
import { type FileSystemObserverLike, getObserverConstructor, toWatchEvents } from "./observer.js";

function splitPath(path: string): string[] {
  return path.split("/").filter(Boolean);
}

/** `FileSystemHandle.move()` - Chromium only, not in the standard typings yet. */
type MovableHandle = FileSystemHandle & {
  move(destination: FileSystemDirectoryHandle, newName?: string): Promise<void>;
};

/**
 * Chromium implements `move()` on file handles (not on directory handles), so
 * check the FileSystemFileHandle prototype as well as the root handle itself.
 */
function supportsMove(root: FileSystemDirectoryHandle): boolean {
  const fileHandle = (globalThis as { FileSystemFileHandle?: { prototype?: { move?: unknown } } })
    .FileSystemFileHandle;
  return (
    typeof fileHandle?.prototype?.move === "function" ||
    typeof (root as Partial<MovableHandle>).move === "function"
  );
}

interface LockManagerLike {
  request<T>(
    name: string,
    options: { signal?: AbortSignal },
    callback: () => Promise<T>,
  ): Promise<T>;
}

function getLockManager(): LockManagerLike | undefined {
  const locks = (globalThis as { navigator?: { locks?: LockManagerLike } }).navigator?.locks;
  return typeof locks?.request === "function" ? locks : undefined;
}

export interface PickOptions {
  /** Defaults to "readwrite" - Lokio workspaces are meant to be written to. */
  mode?: PermissionMode;
  /** Lets the browser remember the last picked directory per id. */
  id?: string;
  /** Persist the picked handle under this key (see `BrowserAdapter.restore`). */
  persistAs?: string;
}

export interface RestoreOptions {
  /** Permission mode later passed to `queryPermission`/`requestPermission`. Defaults to "readwrite". */
  mode?: PermissionMode;
}

/**
 * Adapter for browsers, backed by the File System Access API (a folder the user
 * picked) or the Origin Private File System.
 *
 * Optional capabilities are enabled by feature detection:
 * - `move` when the browser supports `FileSystemHandle.move()`
 * - `watch` when `FileSystemObserver` exists (Chromium 129+)
 * - `lock` (cross-tab) when the Web Locks API exists
 */
export class BrowserAdapter implements LokioAdapter {
  readonly name = "browser";
  /** Writes go to a swap file that replaces the original only on success. */
  readonly capabilities = { atomicWrite: true };

  move?: (from: string, to: string) => Promise<void>;
  watch?: (path: string, listener: (event: WatchEvent) => void) => Promise<Unsubscribe>;
  lock?: <T>(name: string, fn: () => Promise<T>, options?: { timeoutMs?: number }) => Promise<T>;

  private readonly observers = new Set<FileSystemObserverLike>();

  private constructor(
    readonly root: FileSystemDirectoryHandle,
    readonly mode: PermissionMode = "readwrite",
  ) {
    if (supportsMove(root)) this.move = (from, to) => this.moveEntry(from, to);
    const Observer = getObserverConstructor();
    if (Observer) {
      this.watch = async (path, listener) => {
        const directory = await this.resolveExistingDirectory(path);
        const observer = new Observer((records) => {
          for (const record of records)
            for (const event of toWatchEvents(record, path)) listener(event);
        });
        await observer.observe(directory, { recursive: true });
        this.observers.add(observer);
        return () => {
          observer.disconnect();
          this.observers.delete(observer);
        };
      };
    }
    const locks = getLockManager();
    if (locks) {
      this.lock = (name, fn, options) => withWebLock(locks, name, fn, options?.timeoutMs);
    }
  }

  static isSupported(): boolean {
    return typeof window !== "undefined" && "showDirectoryPicker" in window;
  }

  static fromHandle(root: FileSystemDirectoryHandle, mode?: PermissionMode): BrowserAdapter {
    return new BrowserAdapter(root, mode);
  }

  /** Uses the Origin Private File System - no picker, no permission prompt, invisible to the user. */
  static async opfs(): Promise<BrowserAdapter> {
    if (typeof navigator === "undefined" || !navigator.storage?.getDirectory) {
      throw new NotSupportedError("Origin Private File System");
    }
    return new BrowserAdapter(await navigator.storage.getDirectory());
  }

  /** Prompts the user to pick a directory via the native file picker. Requires a user gesture. */
  static async pick(options: PickOptions = {}): Promise<BrowserAdapter> {
    if (!BrowserAdapter.isSupported()) {
      throw new NotSupportedError("File System Access API");
    }
    const mode = options.mode ?? "readwrite";
    const handle = await window.showDirectoryPicker({
      mode,
      ...(options.id ? { id: options.id } : {}),
    });
    if (options.persistAs) await saveHandle(options.persistAs, handle);
    return new BrowserAdapter(handle, mode);
  }

  /**
   * Reopens a directory saved via `pick({ persistAs })` or `saveHandle()`.
   * Resolves to `null` if nothing was saved under `key`.
   *
   * The adapter is returned even when permission is not granted yet -
   * browsers usually reset it after a reload. Check `queryPermission()` and,
   * if it is `"prompt"`, call `requestPermission()` from a user gesture.
   */
  static async restore(key: string, options: RestoreOptions = {}): Promise<BrowserAdapter | null> {
    const handle = await loadHandle(key);
    return handle ? new BrowserAdapter(handle, options.mode ?? "readwrite") : null;
  }

  // ------------------------------------------------------------- resolving

  private async resolveDirectory(
    path: string,
    create: boolean,
  ): Promise<FileSystemDirectoryHandle> {
    let dir = this.root;
    for (const segment of splitPath(path)) {
      dir = await dir.getDirectoryHandle(segment, { create });
    }
    return dir;
  }

  private async resolveExistingDirectory(path: string): Promise<FileSystemDirectoryHandle> {
    try {
      return await this.resolveDirectory(path, false);
    } catch (error) {
      throw toLokioError(error, path, "directory");
    }
  }

  /** Splits a non-root path into its parent directory handle and entry name. */
  private async resolveParent(
    path: string,
    create: boolean,
  ): Promise<{ parent: FileSystemDirectoryHandle; name: string }> {
    const segments = splitPath(path);
    const name = segments.pop();
    if (!name) throw new InvalidPathError(path, "expected a non-root path");
    return { parent: await this.resolveDirectory(segments.join("/"), create), name };
  }

  private async resolveHandle(path: string): Promise<FileSystemHandle> {
    if (splitPath(path).length === 0) return this.root;
    const { parent, name } = await this.resolveParent(path, false);
    try {
      return await parent.getFileHandle(name);
    } catch (error) {
      if ((error as Error).name !== "TypeMismatchError") throw error;
      return parent.getDirectoryHandle(name);
    }
  }

  // ------------------------------------------------------------ operations

  async exists(path: string): Promise<boolean> {
    try {
      await this.stat(path);
      return true;
    } catch (error) {
      if (isMissing(error)) return false;
      throw error;
    }
  }

  async stat(path: string): Promise<EntryStat> {
    try {
      const handle = await this.resolveHandle(path);
      if (handle.kind === "file") {
        const file = await (handle as FileSystemFileHandle).getFile();
        return { kind: "file", size: file.size, lastModified: file.lastModified };
      }
      // The File System Access API exposes no mtime for directories.
      return { kind: "directory", size: 0, lastModified: 0 };
    } catch (error) {
      throw toLokioError(error, path, "file");
    }
  }

  async readFile(path: string): Promise<Uint8Array> {
    try {
      const { parent, name } = await this.resolveParent(path, false);
      const file = await (await parent.getFileHandle(name)).getFile();
      return new Uint8Array(await file.arrayBuffer());
    } catch (error) {
      throw toLokioError(error, path, "file");
    }
  }

  async writeFile(path: string, data: Uint8Array): Promise<void> {
    let writable: FileSystemWritableFileStream | undefined;
    try {
      const { parent, name } = await this.resolveParent(path, true);
      writable = await (await parent.getFileHandle(name, { create: true })).createWritable();
      await writable.write(data.slice() as FileSystemWriteChunkType);
      await writable.close();
    } catch (error) {
      // Discard the swap file so a failed write never replaces the original.
      await writable?.abort().catch(() => undefined);
      throw toLokioError(error, path, "file");
    }
  }

  async deleteFile(path: string): Promise<void> {
    // removeEntry() deletes empty directories too, so check the kind first.
    if ((await this.stat(path)).kind !== "file") throw new TypeMismatchError(path, "file");
    try {
      const { parent, name } = await this.resolveParent(path, false);
      await parent.removeEntry(name);
    } catch (error) {
      throw toLokioError(error, path, "file");
    }
  }

  async readDir(path: string): Promise<DirEntry[]> {
    try {
      const dir = await this.resolveDirectory(path, false);
      const entries: DirEntry[] = [];
      for await (const [name, handle] of dir.entries()) entries.push({ name, kind: handle.kind });
      return entries;
    } catch (error) {
      throw toLokioError(error, path, "directory");
    }
  }

  async mkdir(path: string): Promise<void> {
    try {
      await this.resolveDirectory(path, true);
    } catch (error) {
      throw toLokioError(error, path, "directory");
    }
  }

  async rmdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    if ((await this.stat(path)).kind !== "directory")
      throw new TypeMismatchError(path, "directory");
    try {
      const { parent, name } = await this.resolveParent(path, false);
      await parent.removeEntry(name, { recursive: Boolean(options?.recursive) });
    } catch (error) {
      throw toLokioError(error, path, "directory");
    }
  }

  private async moveEntry(from: string, to: string): Promise<void> {
    let handle: FileSystemHandle;
    try {
      handle = await this.resolveHandle(from);
    } catch (error) {
      throw toLokioError(error, from, "file");
    }
    const fallback = async () => {
      await this.copyTree(from, to);
      if (handle.kind === "file") await this.deleteFile(from);
      else await this.rmdir(from, { recursive: true });
    };
    // Directory handles have no move() in Chromium - copy instead.
    if (typeof (handle as Partial<MovableHandle>).move !== "function") return fallback();
    try {
      const destination = await this.resolveDirectory(dirname(to), true);
      await (handle as MovableHandle).move(destination, basename(to));
    } catch (error) {
      // Some browsers refuse certain moves (e.g. outside the OPFS) - copy instead.
      if ((error as Error).name === "NotSupportedError" || (error as Error).name === "AbortError") {
        return fallback();
      }
      throw toLokioError(error, to, "file");
    }
  }

  private async copyTree(from: string, to: string): Promise<void> {
    if ((await this.stat(from)).kind === "file") {
      await this.writeFile(to, await this.readFile(from));
      return;
    }
    await this.mkdir(to);
    for (const entry of await this.readDir(from)) {
      await this.copyTree(joinPath(from, entry.name), joinPath(to, entry.name));
    }
  }

  // ----------------------------------------------------------- permissions

  async queryPermission(mode: PermissionMode = this.mode): Promise<PermissionState> {
    if (typeof this.root.queryPermission !== "function") return "granted";
    return this.root.queryPermission({ mode });
  }

  /**
   * Checks the current permission and only prompts when needed.
   * Prompting requires a user gesture (e.g. a click handler).
   */
  async requestPermission(mode: PermissionMode = this.mode): Promise<PermissionState> {
    const current = await this.queryPermission(mode);
    if (current !== "prompt" || typeof this.root.requestPermission !== "function") return current;
    return this.root.requestPermission({ mode });
  }

  /** Disconnects all observers started by `watch()`. */
  async close(): Promise<void> {
    for (const observer of this.observers) observer.disconnect();
    this.observers.clear();
  }
}

async function withWebLock<T>(
  locks: LockManagerLike,
  name: string,
  fn: () => Promise<T>,
  timeoutMs?: number,
): Promise<T> {
  const lockName = `lokio:${name}`;
  if (timeoutMs === undefined) return locks.request(lockName, {}, fn);

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    return await locks.request(lockName, { signal: controller.signal }, () => {
      clearTimeout(timer);
      return fn();
    });
  } catch (error) {
    if (timedOut && (error as Error).name === "AbortError")
      throw new LockTimeoutError(name, timeoutMs);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
