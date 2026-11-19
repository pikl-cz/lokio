import { MemoryAdapter } from "@lokio/testing";
import { describe, expect, it } from "vitest";
import { AdapterWrapper } from "./adapter.js";
import { copyEntry, moveEntry, removeEntry } from "./ops.js";

const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

/** Same as MemoryAdapter but without native move, to exercise the copy + delete fallback. */
class NoMoveAdapter extends AdapterWrapper {
  constructor() {
    super(new MemoryAdapter({ files: { "src/a.md": "A", "src/n/b.md": "B", "other.md": "O" } }));
    this.move = undefined;
  }
}

const codeOf = (promise: Promise<unknown>) =>
  promise.then(
    () => "resolved",
    (error: { code?: string }) => error.code,
  );

describe.each([
  [
    "native move",
    () => new MemoryAdapter({ files: { "src/a.md": "A", "src/n/b.md": "B", "other.md": "O" } }),
  ],
  ["copy + delete fallback", () => new NoMoveAdapter()],
])("moveEntry (%s)", (_, factory) => {
  it("moves a directory tree", async () => {
    const adapter = factory();
    await moveEntry(adapter, "src", "dst");
    expect(decode(await adapter.readFile("dst/n/b.md"))).toBe("B");
    expect(await adapter.exists("src")).toBe(false);
  });

  it("is a no-op when source and target are equal", async () => {
    const adapter = factory();
    await moveEntry(adapter, "other.md", "other.md");
    expect(decode(await adapter.readFile("other.md"))).toBe("O");
  });

  it("validates input", async () => {
    const adapter = factory();
    expect(await codeOf(moveEntry(adapter, "", "x"))).toBe("INVALID_PATH");
    expect(await codeOf(moveEntry(adapter, "src", "src/inner"))).toBe("INVALID_PATH");
    expect(await codeOf(moveEntry(adapter, "missing", "x"))).toBe("NOT_FOUND");
    expect(await codeOf(moveEntry(adapter, "other.md", "src"))).toBe("ALREADY_EXISTS");
  });

  it("overwrites a directory with a file when asked", async () => {
    const adapter = factory();
    await moveEntry(adapter, "other.md", "src", { overwrite: true });
    expect((await adapter.stat("src")).kind).toBe("file");
  });
});

describe("copyEntry / removeEntry", () => {
  it("copies files and trees", async () => {
    const adapter = new MemoryAdapter({ files: { "a/x.md": "X" } });
    await copyEntry(adapter, "a", "b");
    await copyEntry(adapter, "a/x.md", "c.md");
    expect(decode(await adapter.readFile("b/x.md"))).toBe("X");
    expect(decode(await adapter.readFile("c.md"))).toBe("X");
    expect(await adapter.exists("a/x.md")).toBe(true);
  });

  it("removes files and trees but never the root", async () => {
    const adapter = new MemoryAdapter({ files: { "a/x.md": "X", "f.md": "" } });
    await removeEntry(adapter, "a");
    await removeEntry(adapter, "f.md");
    expect(await adapter.readDir("")).toEqual([]);
    expect(await codeOf(removeEntry(adapter, ""))).toBe("INVALID_PATH");
  });
});
