import type { LokioAdapter } from "./adapter.js";
import { LokioFile } from "./file.js";

function join(base: string, segment: string): string {
  if (!base) return segment.replace(/^\/+/, "");
  return `${base.replace(/\/+$/, "")}/${segment.replace(/^\/+/, "")}`;
}

export class LokioDirectory {
  constructor(
    private readonly adapter: LokioAdapter,
    public readonly path: string = "",
  ) {}

  file(relativePath: string): LokioFile {
    return new LokioFile(this.adapter, join(this.path, relativePath));
  }

  directory(relativePath: string): LokioDirectory {
    return new LokioDirectory(this.adapter, join(this.path, relativePath));
  }

  list(): Promise<string[]> {
    return this.adapter.readDir(this.path);
  }

  create(): Promise<void> {
    return this.adapter.mkdir(this.path);
  }

  delete(options?: { recursive?: boolean }): Promise<void> {
    return this.adapter.rmdir(this.path, options);
  }

  exists(): Promise<boolean> {
    return this.adapter.exists(this.path);
  }
}
