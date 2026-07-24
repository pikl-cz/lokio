import { NotFoundError, NotSupportedError, type LokioAdapter } from "@lokio/core";
import type { EntryStat, PermissionMode, PermissionState } from "@lokio/types";

function splitPath(path: string): string[] {
  return path.split("/").filter(Boolean);
}

/** Adapter for browsers, backed by the File System Access API. */
export class BrowserAdapter implements LokioAdapter {
  readonly name = "browser";

  private constructor(private readonly root: FileSystemDirectoryHandle) {}

  static fromHandle(root: FileSystemDirectoryHandle): BrowserAdapter {
    return new BrowserAdapter(root);
  }

  /** Prompts the user to pick a directory via the native file picker. */
  static async pick(): Promise<BrowserAdapter> {
    if (typeof window === "undefined" || !("showDirectoryPicker" in window)) {
      throw new NotSupportedError("File System Access API");
    }
    const handle = await window.showDirectoryPicker();
    return new BrowserAdapter(handle);
  }

  private async resolveDirectory(path: string, create: boolean): Promise<FileSystemDirectoryHandle> {
    let dir = this.root;
    for (const segment of splitPath(path)) {
      dir = await dir.getDirectoryHandle(segment, { create });
    }
    return dir;
  }

  private async resolveFileHandle(path: string, create: boolean): Promise<FileSystemFileHandle> {
    const segments = splitPath(path);
    const fileName = segments.pop();
    if (!fileName) throw new NotFoundError(path);
    const dir = await this.resolveDirectory(segments.join("/"), create);
    return dir.getFileHandle(fileName, { create });
  }

  async exists(path: string): Promise<boolean> {
    try {
      await this.stat(path);
      return true;
    } catch {
      return false;
    }
  }

  async stat(path: string): Promise<EntryStat> {
    try {
      const handle = await this.resolveFileHandle(path, false);
      const file = await handle.getFile();
      return { kind: "file", size: file.size, lastModified: file.lastModified };
    } catch {
      try {
        await this.resolveDirectory(path, false);
        return { kind: "directory", size: 0, lastModified: Date.now() };
      } catch {
        throw new NotFoundError(path);
      }
    }
  }

  async readFile(path: string): Promise<Uint8Array> {
    const handle = await this.resolveFileHandle(path, false);
    const file = await handle.getFile();
    return new Uint8Array(await file.arrayBuffer());
  }

  async writeFile(path: string, data: Uint8Array | string): Promise<void> {
    const handle = await this.resolveFileHandle(path, true);
    const writable = await handle.createWritable();
    await writable.write(data as FileSystemWriteChunkType);
    await writable.close();
  }

  async deleteFile(path: string): Promise<void> {
    const segments = splitPath(path);
    const fileName = segments.pop();
    if (!fileName) throw new NotFoundError(path);
    const dir = await this.resolveDirectory(segments.join("/"), false);
    await dir.removeEntry(fileName);
  }

  async readDir(path: string): Promise<string[]> {
    const dir = await this.resolveDirectory(path, false);
    const entries: string[] = [];
    for await (const name of dir.keys()) {
      entries.push(name);
    }
    return entries;
  }

  async mkdir(path: string): Promise<void> {
    await this.resolveDirectory(path, true);
  }

  async rmdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    const segments = splitPath(path);
    const dirName = segments.pop();
    if (!dirName) throw new NotFoundError(path);
    const parent = await this.resolveDirectory(segments.join("/"), false);
    await parent.removeEntry(dirName, { recursive: Boolean(options?.recursive) });
  }

  async requestPermission(mode: PermissionMode = "read"): Promise<PermissionState> {
    if (!this.root.requestPermission) return "granted";
    return this.root.requestPermission({ mode });
  }
}
