import { describe, expect, it } from "vitest";
import { MemoryAdapter } from "./index.js";

describe("MemoryAdapter", () => {
  it("stores and retrieves file contents", async () => {
    const adapter = new MemoryAdapter();
    await adapter.writeFile("notes/today.md", "hello");

    expect(await adapter.exists("notes/today.md")).toBe(true);
    expect(new TextDecoder().decode(await adapter.readFile("notes/today.md"))).toBe("hello");
  });

  it("lists nested directory entries", async () => {
    const adapter = new MemoryAdapter();
    await adapter.writeFile("notes/a.md", "a");
    await adapter.writeFile("notes/b.md", "b");
    await adapter.writeFile("other.md", "o");

    expect((await adapter.readDir("notes")).sort()).toEqual(["a.md", "b.md"]);
    expect((await adapter.readDir("")).sort()).toEqual(["notes", "other.md"]);
  });

  it("throws NotFoundError for missing files", async () => {
    const adapter = new MemoryAdapter();
    await expect(adapter.readFile("missing.txt")).rejects.toThrow("Not found");
  });
});
