import { NotFoundError, type LokioAdapter } from "@lokio/core";
import type { EntryStat } from "@lokio/types";

function normalize(path: string): string {
  return path.replace(/^\/+/, "").replace(/\/+$/, "");
}

/**
 * A fully in-memory adapter, useful for unit tests and previews.
 * Directories are implicit: any path prefix shared by stored files is
 * considered an existing directory.
 */
export class MemoryAdapter implements LokioAdapter {
  readonly name = "memory";
  private readonly files = new Map<string, Uint8Array>();

  async exists(path: string): Promise<boolean> {
    const normalized = normalize(path);
    if (normalized === "") return true;
    if (this.files.has(normalized)) return true;
    const prefix = `${normalized}/`;
    for (const key of this.files.keys()) {
      if (key.startsWith(prefix)) return true;
    }
    return false;
  }

  async stat(path: string): Promise<EntryStat> {
    const normalized = normalize(path);
    const data = this.files.get(normalized);
    if (data) {
      return { kind: "file", size: data.byteLength, lastModified: Date.now() };
    }
    if (await this.exists(normalized)) {
      return { kind: "directory", size: 0, lastModified: Date.now() };
    }
    throw new NotFoundError(path);
  }

  async readFile(path: string): Promise<Uint8Array> {
    const data = this.files.get(normalize(path));
    if (!data) throw new NotFoundError(path);
    return data;
  }

  async writeFile(path: string, data: Uint8Array | string): Promise<void> {
    const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
    this.files.set(normalize(path), bytes);
  }

  async deleteFile(path: string): Promise<void> {
    const normalized = normalize(path);
    if (!this.files.delete(normalized)) throw new NotFoundError(path);
  }

  async readDir(path: string): Promise<string[]> {
    const normalized = normalize(path);
    const prefix = normalized ? `${normalized}/` : "";
    const entries = new Set<string>();
    for (const key of this.files.keys()) {
      if (!key.startsWith(prefix)) continue;
      const segment = key.slice(prefix.length).split("/")[0];
      if (segment) entries.add(segment);
    }
    return [...entries];
  }

  async mkdir(): Promise<void> {
    // Directories are implicit in the in-memory model; nothing to persist.
  }

  async rmdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    const normalized = normalize(path);
    const prefix = normalized ? `${normalized}/` : "";
    const keys = [...this.files.keys()].filter((key) => key.startsWith(prefix));
    if (keys.length > 0 && !options?.recursive) {
      throw new Error(`Directory not empty: ${path}`);
    }
    for (const key of keys) this.files.delete(key);
  }
}

export function createMockAdapter(): MemoryAdapter {
  return new MemoryAdapter();
}
