import type { DirEntry, EntryStat } from "@lokio/types";
import type { LokioAdapter } from "./adapter.js";
import { type FsContext, toContext } from "./context.js";
import { InvalidPathError } from "./errors.js";
import { LokioFile } from "./file.js";
import {
  copyEntry,
  moveEntry,
  type TransferOptions,
  type WalkEntry,
  type WalkOptions,
  walk,
} from "./ops.js";
import { basename, dirname, joinPath, normalizePath } from "./path.js";

export class LokioDirectory {
  protected readonly context: FsContext;
  /** Normalized path; `""` is the workspace root. */
  readonly path: string;

  constructor(adapterOrContext: LokioAdapter | FsContext, path = "") {
    this.context = toContext(adapterOrContext);
    this.path = normalizePath(path);
  }

  get name(): string {
    return basename(this.path);
  }

  get isRoot(): boolean {
    return this.path === "";
  }

  /** The containing directory, or `undefined` for the root. */
  get parent(): LokioDirectory | undefined {
    return this.isRoot ? undefined : new LokioDirectory(this.context, dirname(this.path));
  }

  private get adapter(): LokioAdapter {
    return this.context.adapter;
  }

  file(relativePath: string): LokioFile {
    return new LokioFile(this.context, joinPath(this.path, relativePath));
  }

  directory(relativePath: string): LokioDirectory {
    return new LokioDirectory(this.context, joinPath(this.path, relativePath));
  }

  /** Direct children with their kind, sorted by name. */
  async list(): Promise<DirEntry[]> {
    const entries = await this.adapter.readDir(this.path);
    return entries.sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Direct child files. */
  async files(): Promise<LokioFile[]> {
    return (await this.list())
      .filter((entry) => entry.kind === "file")
      .map((entry) => this.file(entry.name));
  }

  /** Direct child directories. */
  async directories(): Promise<LokioDirectory[]> {
    return (await this.list())
      .filter((entry) => entry.kind === "directory")
      .map((entry) => this.directory(entry.name));
  }

  /** Recursively yields every entry below this directory (workspace-relative paths). */
  walk(options?: WalkOptions): AsyncGenerator<WalkEntry> {
    return walk(this.adapter, this.path, options);
  }

  stat(): Promise<EntryStat> {
    return this.adapter.stat(this.path);
  }

  exists(): Promise<boolean> {
    return this.adapter.exists(this.path);
  }

  /** Creates the directory (and parents). No-op if it exists. */
  create(): Promise<void> {
    return this.adapter.mkdir(this.path);
  }

  delete(options?: { recursive?: boolean }): Promise<void> {
    if (this.isRoot) {
      return Promise.reject(new InvalidPathError("", "refusing to delete the workspace root"));
    }
    return this.adapter.rmdir(this.path, options);
  }

  async moveTo(path: string, options?: TransferOptions): Promise<LokioDirectory> {
    const target = new LokioDirectory(this.context, path);
    await moveEntry(this.adapter, this.path, target.path, options);
    return target;
  }

  async copyTo(path: string, options?: TransferOptions): Promise<LokioDirectory> {
    const target = new LokioDirectory(this.context, path);
    await copyEntry(this.adapter, this.path, target.path, options);
    return target;
  }

  rename(newName: string, options?: TransferOptions): Promise<LokioDirectory> {
    if (/[\\/]/.test(newName) || newName === "." || newName === "..") {
      throw new InvalidPathError(newName, "expected a directory name, not a path");
    }
    return this.moveTo(joinPath(dirname(this.path), newName), options);
  }
}
