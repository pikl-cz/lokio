import { MemoryAdapter } from "@lokio/testing";
import { describe, expect, it } from "vitest";
import { isLokioError } from "./errors.js";
import { LokioFile } from "./file.js";

const setup = (files: Record<string, string> = {}) => {
  const adapter = new MemoryAdapter({ files });
  return { adapter, file: (path: string) => new LokioFile(adapter, path) };
};

const codeOf = async (promise: Promise<unknown>) =>
  promise.then(
    () => "resolved",
    (error: { code?: string }) => error.code,
  );

describe("LokioFile", () => {
  it("exposes name, extension and parent path", () => {
    const { file } = setup();
    const handle = file("/notes//2024/today.md");
    expect(handle.path).toBe("notes/2024/today.md");
    expect(handle.name).toBe("today.md");
    expect(handle.extension).toBe(".md");
    expect(handle.parentPath).toBe("notes/2024");
  });

  it("cannot point at the root", () => {
    const { adapter } = setup();
    expect(() => new LokioFile(adapter, "/")).toThrow(/root/);
  });

  it("reads and writes bytes, text and JSON", async () => {
    const { file } = setup();
    const handle = file("data.json");
    await handle.write(new Uint8Array([123, 125]));
    expect(await handle.readJSON()).toEqual({});
    await handle.writeJSON({ a: [1, 2] });
    expect(await handle.readText()).toBe('{\n  "a": [\n    1,\n    2\n  ]\n}\n');
    expect(await handle.readJSON<{ a: number[] }>()).toEqual({ a: [1, 2] });
    expect((await handle.stat()).kind).toBe("file");
  });

  it("deletes", async () => {
    const { file } = setup({ "a.txt": "a" });
    await file("a.txt").delete();
    expect(await file("a.txt").exists()).toBe(false);
  });

  describe("updateText / updateJSON", () => {
    it("passes undefined for a missing file", async () => {
      const { file } = setup();
      const result = await file("counter.txt").updateText((current) => `${current ?? "none"}!`);
      expect(result).toBe("none!");
    });

    it("serializes concurrent updates so none are lost", async () => {
      const { file } = setup();
      const counter = file("counter.json");
      await Promise.all(
        Array.from({ length: 20 }, () =>
          counter.updateJSON<{ n: number }>(async (current) => {
            await new Promise((resolve) => setTimeout(resolve, 1));
            return { n: (current?.n ?? 0) + 1 };
          }),
        ),
      );
      expect(await counter.readJSON()).toEqual({ n: 20 });
    });

    it("rethrows read errors other than NOT_FOUND", async () => {
      const { adapter, file } = setup();
      await adapter.mkdir("dir");
      const error = await file("dir")
        .updateText(() => "x")
        .catch((e: unknown) => e);
      expect(isLokioError(error, "TYPE_MISMATCH")).toBe(true);
    });
  });

  describe("moveTo / copyTo / rename", () => {
    it("moves and returns the new handle", async () => {
      const { file } = setup({ "a.md": "A" });
      const moved = await file("a.md").moveTo("archive/a.md");
      expect(moved.path).toBe("archive/a.md");
      expect(await moved.readText()).toBe("A");
      expect(await file("a.md").exists()).toBe(false);
    });

    it("copies", async () => {
      const { file } = setup({ "a.md": "A" });
      const copy = await file("a.md").copyTo("b.md");
      expect(await copy.readText()).toBe("A");
      expect(await file("a.md").readText()).toBe("A");
    });

    it("renames within the same directory", async () => {
      const { file } = setup({ "notes/a.md": "A" });
      const renamed = await file("notes/a.md").rename("b.md");
      expect(renamed.path).toBe("notes/b.md");
    });

    it("rejects paths as new names", () => {
      const { file } = setup({ "a.md": "A" });
      expect(() => file("a.md").rename("x/b.md")).toThrow(/name/);
      expect(() => file("a.md").rename("..")).toThrow(/name/);
    });

    it("refuses to overwrite unless asked", async () => {
      const { file } = setup({ "a.md": "A", "b.md": "B" });
      expect(await codeOf(file("a.md").moveTo("b.md"))).toBe("ALREADY_EXISTS");
      await file("a.md").moveTo("b.md", { overwrite: true });
      expect(await file("b.md").readText()).toBe("A");
    });
  });
});
