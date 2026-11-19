import type { EntryStat } from "@lokio/types";
import type { LokioAdapter } from "./adapter.js";
import { type FsContext, toContext, withLock } from "./context.js";
import { InvalidPathError, isLokioError } from "./errors.js";
import { copyEntry, moveEntry, type TransferOptions } from "./ops.js";
import { basename, dirname, extname, joinPath, normalizePath } from "./path.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export class LokioFile {
  protected readonly context: FsContext;
  readonly path: string;

  constructor(adapterOrContext: LokioAdapter | FsContext, path: string) {
    this.context = toContext(adapterOrContext);
    this.path = normalizePath(path);
    if (this.path === "") throw new InvalidPathError(path, "a file path cannot be the root");
  }

  /** File name including extension, e.g. `today.md`. */
  get name(): string {
    return basename(this.path);
  }

  /** Extension including the dot, e.g. `.md`; `""` if none. */
  get extension(): string {
    return extname(this.path);
  }

  /** Path of the containing directory (`""` for the root). */
  get parentPath(): string {
    return dirname(this.path);
  }

  private get adapter(): LokioAdapter {
    return this.context.adapter;
  }

  stat(): Promise<EntryStat> {
    return this.adapter.stat(this.path);
  }

  exists(): Promise<boolean> {
    return this.adapter.exists(this.path);
  }

  read(): Promise<Uint8Array> {
    return this.adapter.readFile(this.path);
  }

  async readText(): Promise<string> {
    return decoder.decode(await this.read());
  }

  async readJSON<T = unknown>(): Promise<T> {
    return JSON.parse(await this.readText()) as T;
  }

  write(data: Uint8Array | string): Promise<void> {
    return this.adapter.writeFile(
      this.path,
      typeof data === "string" ? encoder.encode(data) : data,
    );
  }

  writeJSON(value: unknown, space = 2): Promise<void> {
    return this.write(`${JSON.stringify(value, null, space)}\n`);
  }

  /**
   * Read-modify-write under a lock, so concurrent updates of the same file
   * (from this workspace, or other tabs/processes when the adapter supports it)
   * don't overwrite each other. `current` is `undefined` if the file doesn't exist.
   */
  async updateText(fn: (current: string | undefined) => string | Promise<string>): Promise<string> {
    return withLock(this.context, `file:${this.path}`, async () => {
      const next = await fn(await this.readTextOrUndefined());
      await this.write(next);
      return next;
    });
  }

  async updateJSON<T>(fn: (current: T | undefined) => T | Promise<T>, space = 2): Promise<T> {
    let result!: T;
    await this.updateText(async (current) => {
      result = await fn(current === undefined ? undefined : (JSON.parse(current) as T));
      return `${JSON.stringify(result, null, space)}\n`;
    });
    return result;
  }

  delete(): Promise<void> {
    return this.adapter.deleteFile(this.path);
  }

  /** Moves the file and returns a handle to the new location. */
  async moveTo(path: string, options?: TransferOptions): Promise<LokioFile> {
    const target = new LokioFile(this.context, path);
    await moveEntry(this.adapter, this.path, target.path, options);
    return target;
  }

  async copyTo(path: string, options?: TransferOptions): Promise<LokioFile> {
    const target = new LokioFile(this.context, path);
    await copyEntry(this.adapter, this.path, target.path, options);
    return target;
  }

  /** Renames within the same directory. `newName` must be a plain name, not a path. */
  rename(newName: string, options?: TransferOptions): Promise<LokioFile> {
    if (/[\\/]/.test(newName) || newName === "." || newName === "..") {
      throw new InvalidPathError(newName, "expected a file name, not a path");
    }
    return this.moveTo(joinPath(this.parentPath, newName), options);
  }

  private async readTextOrUndefined(): Promise<string | undefined> {
    try {
      return await this.readText();
    } catch (error) {
      if (isLokioError(error, "NOT_FOUND")) return undefined;
      throw error;
    }
  }
}
