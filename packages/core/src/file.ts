import type { EntryStat } from "@lokio/types";
import type { LokioAdapter } from "./adapter.js";

export class LokioFile {
  constructor(
    private readonly adapter: LokioAdapter,
    public readonly path: string,
  ) {}

  stat(): Promise<EntryStat> {
    return this.adapter.stat(this.path);
  }

  read(): Promise<Uint8Array> {
    return this.adapter.readFile(this.path);
  }

  async readText(): Promise<string> {
    return new TextDecoder().decode(await this.read());
  }

  write(data: Uint8Array | string): Promise<void> {
    return this.adapter.writeFile(this.path, data);
  }

  delete(): Promise<void> {
    return this.adapter.deleteFile(this.path);
  }

  exists(): Promise<boolean> {
    return this.adapter.exists(this.path);
  }
}
