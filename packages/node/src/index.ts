import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { NotFoundError, type LokioAdapter } from "@lokio/core";
import type { EntryStat } from "@lokio/types";

export interface NodeAdapterOptions {
  /** Directory that becomes the workspace root. All paths are resolved relative to it. */
  root: string;
}

/** Adapter for Node, CLI tools, Electron and Tauri backends. */
export class NodeAdapter implements LokioAdapter {
  readonly name = "node";
  private readonly root: string;

  constructor(options: NodeAdapterOptions) {
    this.root = resolve(options.root);
  }

  private resolvePath(path: string): string {
    return join(this.root, path);
  }

  async exists(path: string): Promise<boolean> {
    try {
      await stat(this.resolvePath(path));
      return true;
    } catch {
      return false;
    }
  }

  async stat(path: string): Promise<EntryStat> {
    try {
      const info = await stat(this.resolvePath(path));
      return {
        kind: info.isDirectory() ? "directory" : "file",
        size: info.size,
        lastModified: info.mtimeMs,
      };
    } catch {
      throw new NotFoundError(path);
    }
  }

  async readFile(path: string): Promise<Uint8Array> {
    try {
      return await readFile(this.resolvePath(path));
    } catch {
      throw new NotFoundError(path);
    }
  }

  async writeFile(path: string, data: Uint8Array | string): Promise<void> {
    const target = this.resolvePath(path);
    const dir = target.split(sep).slice(0, -1).join(sep);
    if (dir) await mkdir(dir, { recursive: true });
    await writeFile(target, data);
  }

  async deleteFile(path: string): Promise<void> {
    try {
      await rm(this.resolvePath(path));
    } catch {
      throw new NotFoundError(path);
    }
  }

  async readDir(path: string): Promise<string[]> {
    try {
      return await readdir(this.resolvePath(path));
    } catch {
      throw new NotFoundError(path);
    }
  }

  async mkdir(path: string): Promise<void> {
    await mkdir(this.resolvePath(path), { recursive: true });
  }

  async rmdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    await rm(this.resolvePath(path), { recursive: Boolean(options?.recursive) });
  }
}
