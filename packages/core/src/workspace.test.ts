import { describe, expect, it } from "vitest";
import type { LokioAdapter } from "./adapter.js";
import { NotFoundError } from "./errors.js";
import { Lokio } from "./index.js";
import type { EntryStat } from "@lokio/types";

/** Tiny in-memory adapter used only to exercise the Workspace API in isolation. */
class TestAdapter implements LokioAdapter {
  readonly name = "test";
  private readonly files = new Map<string, Uint8Array>();

  async exists(path: string): Promise<boolean> {
    return this.files.has(path);
  }

  async stat(path: string): Promise<EntryStat> {
    const data = this.files.get(path);
    if (!data) throw new NotFoundError(path);
    return { kind: "file", size: data.byteLength, lastModified: Date.now() };
  }

  async readFile(path: string): Promise<Uint8Array> {
    const data = this.files.get(path);
    if (!data) throw new NotFoundError(path);
    return data;
  }

  async writeFile(path: string, data: Uint8Array | string): Promise<void> {
    this.files.set(path, typeof data === "string" ? new TextEncoder().encode(data) : data);
  }

  async deleteFile(path: string): Promise<void> {
    this.files.delete(path);
  }

  async readDir(path: string): Promise<string[]> {
    const prefix = path ? `${path}/` : "";
    return [...this.files.keys()]
      .filter((key) => key.startsWith(prefix))
      .map((key) => key.slice(prefix.length).split("/")[0] ?? key);
  }

  async mkdir(): Promise<void> {}

  async rmdir(path: string): Promise<void> {
    const prefix = path ? `${path}/` : "";
    for (const key of [...this.files.keys()]) {
      if (key.startsWith(prefix)) this.files.delete(key);
    }
  }
}

describe("Workspace", () => {
  it("writes and reads a file through the adapter", async () => {
    const workspace = await Lokio.openWorkspace(new TestAdapter());

    const file = await workspace.open("dreams/today.dream");
    await file.write("hello lokio");

    expect(await file.exists()).toBe(true);
    expect(await file.readText()).toBe("hello lokio");
  });

  it("lists directory contents", async () => {
    const workspace = await Lokio.openWorkspace(new TestAdapter());
    await (await workspace.open("a.md")).write("a");
    await (await workspace.open("b.md")).write("b");

    const entries = await workspace.directory().list();
    expect([...entries].sort()).toEqual(["a.md", "b.md"]);
  });

  it("runs plugins exactly once and emits a setup event", async () => {
    const workspace = await Lokio.openWorkspace(new TestAdapter());
    const setupCalls: string[] = [];
    workspace.events.on("plugin:setup", (name) => setupCalls.push(name));

    const plugin = {
      name: "example",
      setup: () => {
        setupCalls.push("setup:example");
      },
    };

    await workspace.use(plugin);
    await workspace.use(plugin);

    expect(setupCalls).toEqual(["setup:example", "example"]);
    expect(workspace.plugin("example")).toBe(plugin);
  });
});
