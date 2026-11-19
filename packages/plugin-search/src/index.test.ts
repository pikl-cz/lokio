import { Lokio } from "@lokio/core";
import { MemoryAdapter } from "@lokio/testing";
import { describe, expect, it, vi } from "vitest";
import { fold, search, tokenize } from "./index.js";

async function setup(files: Record<string, string>, options?: Parameters<typeof search>[0]) {
  const adapter = new MemoryAdapter({ files });
  const workspace = await Lokio.openWorkspace(adapter);
  const api = await workspace.use(search(options));
  await api.ready;
  return { adapter, workspace, api };
}

const paths = (results: { path: string }[]) => results.map((r) => r.path);

describe("tokenizer", () => {
  it("folds case and diacritics and splits on non-word characters", () => {
    expect(fold("Žluťoučký KŮŇ")).toBe("zlutoucky kun");
    expect(tokenize("Hello, world! 42x — příliš")).toEqual(["hello", "world", "42x", "prilis"]);
    expect(tokenize("  ,, ")).toEqual([]);
  });
});

describe("search plugin", () => {
  const files = {
    "animals/horse.md": "Žluťoučký kůň úpěl ďábelské ódy.",
    "animals/dog.md": "The dog barked at the horse. Dog dog dog.",
    "notes/todo.txt": "Buy milk and feed the dog",
    "data.json": '{"title": "recipes"}',
    "image.png": "dog dog dog",
    ".lokio/state.md": "dog",
  };

  it("indexes supported files on setup, skipping internal and unknown extensions", async () => {
    const { api } = await setup(files);
    expect(api.size).toBe(4);
    expect(paths(api.query("dog"))).not.toContain("image.png");
    expect(paths(api.query("dog"))).not.toContain(".lokio/state.md");
  });

  it("matches regardless of diacritics, in both directions", async () => {
    const { api } = await setup(files);
    expect(paths(api.query("kun"))).toEqual(["animals/horse.md"]);
    expect(paths(api.query("KŮŇ"))).toEqual(["animals/horse.md"]);
  });

  it("ranks by term frequency and returns snippets from the original text", async () => {
    const { api } = await setup(files);
    const results = api.query("dog");
    expect(paths(results)[0]).toBe("animals/dog.md");
    expect(results[0]!.score).toBeGreaterThan(results[1]!.score);
    expect(api.query("ody")[0]!.snippet).toContain("ďábelské ódy");
  });

  it("prefix-matches the last token only", async () => {
    const { api } = await setup(files);
    expect(paths(api.query("recip"))).toEqual(["data.json"]);
    expect(api.query("recip dog")).toEqual([]);
  });

  it("supports all/any modes, path scoping and limits", async () => {
    const { api } = await setup(files);
    expect(paths(api.query("milk horse"))).toEqual([]);
    expect(paths(api.query("milk horse", { mode: "any" })).sort()).toEqual([
      "animals/dog.md",
      "notes/todo.txt",
    ]);
    expect(paths(api.query("dog", { path: "notes" }))).toEqual(["notes/todo.txt"]);
    expect(api.query("dog", { limit: 1 })).toHaveLength(1);
    expect(api.query("   ")).toEqual([]);
  });

  it("uses the default mode from plugin options", async () => {
    const { api } = await setup(files, { mode: "any" });
    expect(api.query("milk horse").length).toBe(2);
  });

  it("respects custom extensions and max file size", async () => {
    const { api } = await setup(
      { "a.MD": "alpha", "b.txt": "alpha", "big.md": `alpha ${"x".repeat(100)}` },
      { extensions: [".md"], maxFileSize: 50 },
    );
    expect(paths(api.query("alpha"))).toEqual(["a.MD"]);
  });

  it("follows local writes, deletes and moves", async () => {
    const { api, workspace } = await setup({ "a.md": "apple" });
    await workspace.file("b.md").write("banana");
    await workspace.file("a.md").write("cherry");
    await api.idle();
    expect(paths(api.query("banana"))).toEqual(["b.md"]);
    expect(api.query("apple")).toEqual([]);
    expect(paths(api.query("cherry"))).toEqual(["a.md"]);

    await workspace.move("b.md", "fruit/b.md");
    await api.idle();
    expect(paths(api.query("banana"))).toEqual(["fruit/b.md"]);

    await workspace.directory("fruit").delete({ recursive: true });
    await workspace.file("a.md").delete();
    await api.idle();
    expect(api.size).toBe(0);
  });

  it("follows external changes, including moved directories", async () => {
    const { api, adapter } = await setup({ "dir/a.md": "external" });
    await adapter.writeFile("x.md", new TextEncoder().encode("outside world"));
    await adapter.move("dir", "moved");
    await api.idle();
    expect(paths(api.query("outside"))).toEqual(["x.md"]);
    expect(paths(api.query("external"))).toEqual(["moved/a.md"]);
  });

  it("drops a file that grows beyond the size limit", async () => {
    const { api, workspace } = await setup({ "a.md": "small" }, { maxFileSize: 10 });
    await workspace.file("a.md").write("small but now far too large");
    await api.idle();
    expect(api.size).toBe(0);
  });

  it("rebuilds on reindex", async () => {
    const { api, adapter } = await setup({ "a.md": "one" });
    const spy = vi.spyOn(adapter, "watch");
    expect(spy).not.toHaveBeenCalled();
    await api.reindex();
    expect(api.size).toBe(1);
  });

  it("stops updating and clears after dispose", async () => {
    const { api, workspace } = await setup({ "a.md": "one" });
    await workspace.unuse("search");
    expect(api.size).toBe(0);
    await workspace.file("b.md").write("two");
    await api.idle();
    expect(api.size).toBe(0);
  });
});
