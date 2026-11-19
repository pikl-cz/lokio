import {
  dirname,
  isWithin,
  type LokioAdapter,
  NotEmptyError,
  NotFoundError,
  normalizePath,
  TypeMismatchError,
} from "@lokio/core";
import type { DirEntry, EntryStat, Unsubscribe, WatchEvent } from "@lokio/types";

interface FileEntry {
  data: Uint8Array;
  lastModified: number;
}

export interface MemoryAdapterOptions {
  /** Files to seed the adapter with, e.g. `{ "notes/a.md": "hello" }`. */
  files?: Record<string, string | Uint8Array>;
  /** Clock used for `lastModified`. Handy for deterministic tests. */
  now?: () => number;
}

/**
 * A fully in-memory adapter, useful for unit tests, previews and demos.
 * Behaves like a real filesystem: directories are explicit (so empty
 * directories exist), and stored bytes are copied in and out so callers
 * cannot mutate the "disk" through a shared buffer.
 *
 * Supports `move` and `watch`. Every mutation is reported to watchers, so
 * writing through the adapter directly (instead of through a workspace)
 * simulates a change made by another app.
 */
export class MemoryAdapter implements LokioAdapter {
  readonly name = "memory";
  readonly capabilities = { atomicWrite: true };

  private readonly files = new Map<string, FileEntry>();
  /** Directory path -> lastModified. The root ("") always exists. */
  private readonly dirs = new Map<string, number>();
  private readonly watchers = new Set<{ path: string; listener: (event: WatchEvent) => void }>();
  private readonly now: () => number;

  constructor(options: MemoryAdapterOptions = {}) {
    this.now = options.now ?? Date.now;
    this.dirs.set("", this.now());
    const encoder = new TextEncoder();
    for (const [path, content] of Object.entries(options.files ?? {})) {
      const normalized = normalizePath(path);
      this.ensureDirs(dirname(normalized));
      const data = typeof content === "string" ? encoder.encode(content) : content.slice();
      this.files.set(normalized, { data, lastModified: this.now() });
    }
  }

  async exists(path: string): Promise<boolean> {
    return this.files.has(path) || this.dirs.has(path);
  }

  async stat(path: string): Promise<EntryStat> {
    const file = this.files.get(path);
    if (file) return { kind: "file", size: file.data.byteLength, lastModified: file.lastModified };
    const dir = this.dirs.get(path);
    if (dir !== undefined) return { kind: "directory", size: 0, lastModified: dir };
    throw new NotFoundError(path);
  }

  async readFile(path: string): Promise<Uint8Array> {
    const file = this.files.get(path);
    if (file) return file.data.slice();
    if (this.dirs.has(path)) throw new TypeMismatchError(path, "file");
    throw new NotFoundError(path);
  }

  async writeFile(path: string, data: Uint8Array): Promise<void> {
    if (this.dirs.has(path)) throw new TypeMismatchError(path, "file");
    this.ensureDirs(dirname(path));
    const existed = this.files.has(path);
    this.files.set(path, { data: data.slice(), lastModified: this.now() });
    this.notify({ type: existed ? "modified" : "created", path, kind: "file" });
  }

  async deleteFile(path: string): Promise<void> {
    if (this.files.delete(path)) {
      this.notify({ type: "deleted", path, kind: "file" });
      return;
    }
    if (this.dirs.has(path)) throw new TypeMismatchError(path, "file");
    throw new NotFoundError(path);
  }

  async readDir(path: string): Promise<DirEntry[]> {
    if (!this.dirs.has(path)) {
      if (this.files.has(path)) throw new TypeMismatchError(path, "directory");
      throw new NotFoundError(path);
    }
    const offset = path ? path.length + 1 : 0;
    return this.children(path).map(({ path: child, kind }) => ({
      name: child.slice(offset),
      kind,
    }));
  }

  async mkdir(path: string): Promise<void> {
    this.ensureDirs(path);
  }

  async rmdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    if (!this.dirs.has(path)) {
      if (this.files.has(path)) throw new TypeMismatchError(path, "directory");
      throw new NotFoundError(path);
    }
    if (this.children(path).length > 0 && !options?.recursive) throw new NotEmptyError(path);
    this.removeTree(path);
    this.notify({ type: "deleted", path, kind: "directory" });
  }

  async move(from: string, to: string): Promise<void> {
    const { kind } = await this.stat(from);
    this.ensureDirs(dirname(to));
    const rebase = (key: string) => to + key.slice(from.length);
    for (const [key, entry] of [...this.files]) {
      if (isWithin(from, key)) {
        this.files.delete(key);
        this.files.set(rebase(key), entry);
      }
    }
    for (const [key, mtime] of [...this.dirs]) {
      if (key !== "" && isWithin(from, key)) {
        this.dirs.delete(key);
        this.dirs.set(rebase(key), mtime);
      }
    }
    this.notify({ type: "deleted", path: from, kind });
    this.notify({ type: "created", path: to, kind });
  }

  watch(path: string, listener: (event: WatchEvent) => void): Unsubscribe {
    const watcher = { path, listener };
    this.watchers.add(watcher);
    return () => this.watchers.delete(watcher);
  }

  private notify(event: WatchEvent): void {
    for (const watcher of [...this.watchers]) {
      if (isWithin(watcher.path, event.path)) watcher.listener(event);
    }
  }

  private ensureDirs(path: string): void {
    let current = "";
    for (const segment of path ? path.split("/") : []) {
      current = current ? `${current}/${segment}` : segment;
      if (this.files.has(current)) throw new TypeMismatchError(current, "directory");
      if (!this.dirs.has(current)) {
        this.dirs.set(current, this.now());
        this.notify({ type: "created", path: current, kind: "directory" });
      }
    }
  }

  private removeTree(path: string): void {
    for (const key of [...this.files.keys()]) if (isWithin(path, key)) this.files.delete(key);
    for (const key of [...this.dirs.keys()])
      if (key !== "" && isWithin(path, key)) this.dirs.delete(key);
  }

  /** Direct children of `path`, directories first. */
  private children(path: string): { path: string; kind: DirEntry["kind"] }[] {
    const isChild = (key: string) => key !== "" && dirname(key) === path;
    return [
      ...[...this.dirs.keys()]
        .filter(isChild)
        .map((p) => ({ path: p, kind: "directory" as const })),
      ...[...this.files.keys()].filter(isChild).map((p) => ({ path: p, kind: "file" as const })),
    ];
  }
}
