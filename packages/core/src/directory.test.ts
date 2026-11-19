import { MemoryAdapter } from "@lokio/testing";
import { describe, expect, it } from "vitest";
import { LokioDirectory } from "./directory.js";

const setup = (files: Record<string, string> = {}) => {
  const adapter = new MemoryAdapter({ files });
  return { adapter, dir: (path = "") => new LokioDirectory(adapter, path) };
};

describe("LokioDirectory", () => {
  it("navigates", () => {
    const { dir } = setup();
    const notes = dir("notes");
    expect(notes.name).toBe("notes");
    expect(notes.isRoot).toBe(false);
    expect(notes.parent?.isRoot).toBe(true);
    expect(dir().parent).toBeUndefined();
    expect(notes.directory("2024").file("a.md").path).toBe("notes/2024/a.md");
    expect(notes.file("../x.md").path).toBe("x.md");
  });

  it("lists entries sorted with kinds, and splits files from directories", async () => {
    const { dir } = setup({ "b.md": "b", "a.md": "a", "sub/c.md": "c" });
    expect(await dir().list()).toEqual([
      { name: "a.md", kind: "file" },
      { name: "b.md", kind: "file" },
      { name: "sub", kind: "directory" },
    ]);
    expect((await dir().files()).map((f) => f.path)).toEqual(["a.md", "b.md"]);
    expect((await dir().directories()).map((d) => d.path)).toEqual(["sub"]);
  });

  it("walks recursively with filters", async () => {
    const { dir } = setup({ "a.md": "", "x/b.md": "", "x/y/c.txt": "", "skip/d.md": "" });
    const all: string[] = [];
    for await (const entry of dir().walk()) all.push(`${entry.kind[0]}:${entry.path}`);
    expect(all).toEqual([
      "f:a.md",
      "d:skip",
      "f:skip/d.md",
      "d:x",
      "f:x/b.md",
      "d:x/y",
      "f:x/y/c.txt",
    ]);

    const markdown: string[] = [];
    for await (const entry of dir().walk({
      directories: false,
      filter: (e) => e.path !== "skip" && (e.kind === "directory" || e.path.endsWith(".md")),
    })) {
      markdown.push(entry.path);
    }
    expect(markdown).toEqual(["a.md", "x/b.md"]);
  });

  it("creates, stats and deletes", async () => {
    const { dir } = setup();
    const d = dir("a/b");
    await d.create();
    expect(await d.exists()).toBe(true);
    expect((await d.stat()).kind).toBe("directory");
    await d.delete();
    expect(await d.exists()).toBe(false);
  });

  it("refuses to delete the root", async () => {
    const { dir } = setup({ "keep.md": "" });
    await expect(dir().delete({ recursive: true })).rejects.toThrow(/root/);
  });

  it("moves, copies and renames trees", async () => {
    const { dir } = setup({ "src/a.md": "A", "src/n/b.md": "B" });
    const copy = await dir("src").copyTo("copy");
    expect(await copy.file("n/b.md").readText()).toBe("B");

    const renamed = await dir("src").rename("dst");
    expect(renamed.path).toBe("dst");
    expect(await dir("src").exists()).toBe(false);
    expect(await renamed.file("a.md").readText()).toBe("A");

    const moved = await renamed.moveTo("deep/er");
    expect(await moved.file("n/b.md").readText()).toBe("B");
    expect(() => moved.rename("a/b")).toThrow(/name/);
  });
});
