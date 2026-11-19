import { Lokio, type Workspace } from "@lokio/core";
import { MemoryAdapter } from "@lokio/testing";
import { describe, expect, it } from "vitest";
import { history } from "./index.js";

async function setup(options?: Parameters<typeof history>[0], files: Record<string, string> = {}) {
  const adapter = new MemoryAdapter({ files });
  const workspace: Workspace = await Lokio.openWorkspace(adapter);
  const api = await workspace.use(history(options));
  return { adapter, workspace, api };
}

describe("history plugin", () => {
  it("snapshots the previous content on overwrite, newest first", async () => {
    const { workspace, api } = await setup();
    const file = workspace.file("notes/a.md");
    await file.write("v1");
    expect(await api.versions("notes/a.md")).toEqual([]);
    await file.write("v2");
    await file.write("v3");

    const versions = await api.versions("notes/a.md");
    expect(versions).toHaveLength(2);
    expect(await api.readText("notes/a.md", versions[0]!.id)).toBe("v2");
    expect(await api.readText("notes/a.md", versions[1]!.id)).toBe("v1");
    expect(versions[0]!.size).toBe(2);
    expect(versions[0]!.timestamp).toBeGreaterThan(0);
  });

  it("snapshots on delete, move and recursive directory delete", async () => {
    const { workspace, api } = await setup({}, { "a.md": "A", "b.md": "B", "dir/c.md": "C" });
    await workspace.file("a.md").delete();
    await workspace.move("b.md", "moved.md");
    await workspace.directory("dir").delete({ recursive: true });

    expect(await api.readText("a.md", (await api.versions("a.md"))[0]!.id)).toBe("A");
    expect(await api.readText("b.md", (await api.versions("b.md"))[0]!.id)).toBe("B");
    expect(await api.readText("dir/c.md", (await api.versions("dir/c.md"))[0]!.id)).toBe("C");
  });

  it("snapshots via the copy + delete fallback when the adapter cannot move", async () => {
    const adapter = new MemoryAdapter({ files: { "a.md": "A" } });
    (adapter as { move?: unknown }).move = undefined;
    const workspace = await Lokio.openWorkspace(adapter);
    const api = await workspace.use(history());
    await workspace.move("a.md", "b.md");
    expect(await api.versions("a.md")).toHaveLength(1);
  });

  it("prunes beyond maxVersions", async () => {
    const { workspace, api } = await setup({ maxVersions: 3 });
    for (let i = 0; i < 6; i++) await workspace.file("a.md").write(`v${i}`);
    const versions = await api.versions("a.md");
    expect(versions).toHaveLength(3);
    expect(await api.readText("a.md", versions[2]!.id)).toBe("v2");
  });

  it("restores a version and snapshots the current content first", async () => {
    const { workspace, api } = await setup();
    const file = workspace.file("a.md");
    await file.write("old");
    await file.write("new");
    const [old] = await api.versions("a.md");
    await api.restore("a.md", old!.id);
    expect(await file.readText()).toBe("old");
    const versions = await api.versions("a.md");
    expect(await api.readText("a.md", versions[0]!.id)).toBe("new");
  });

  it("respects include and never versions its own or other internal files", async () => {
    const { workspace, api, adapter } = await setup({ include: (path) => path.endsWith(".md") });
    await workspace.file("a.txt").write("1");
    await workspace.file("a.txt").write("2");
    await workspace.file(".lokio/state.json").write("1");
    await workspace.file(".lokio/state.json").write("2");
    await workspace.file("a.md").write("1");
    await workspace.file("a.md").write("2");

    expect(await api.versions("a.txt")).toEqual([]);
    expect(await api.versions(".lokio/state.json")).toEqual([]);
    expect(await api.versions("a.md")).toHaveLength(1);
    expect(await adapter.readDir(".lokio/history")).toEqual([
      { name: "a.md.history", kind: "directory" },
    ]);
  });

  it("supports a custom folder and does not version it", async () => {
    const { workspace, api, adapter } = await setup({ dir: "_versions" });
    await workspace.file("a.md").write("1");
    await workspace.file("a.md").write("2");
    const [version] = await api.versions("a.md");
    expect(await adapter.exists(`_versions/a.md.history/${version!.id}`)).toBe(true);
    await workspace.file(`_versions/a.md.history/${version!.id}`).write("tamper");
    expect(await api.versions("_versions/a.md.history")).toEqual([]);
  });

  it("clears one file or everything", async () => {
    const { workspace, api } = await setup();
    for (const path of ["a.md", "b.md"]) {
      await workspace.file(path).write("1");
      await workspace.file(path).write("2");
    }
    await api.clear("a.md");
    expect(await api.versions("a.md")).toEqual([]);
    expect(await api.versions("b.md")).toHaveLength(1);
    await api.clear();
    await api.clear();
    expect(await api.versions("b.md")).toEqual([]);
  });

  it("rejects unknown version ids", async () => {
    const { api } = await setup();
    await expect(api.read("a.md", "../../etc")).rejects.toThrow(/Not found/);
    await expect(api.read("a.md", "000000000000001-000000")).rejects.toThrow(/Not found/);
  });

  it("stops versioning after unuse and resumes after use", async () => {
    const { workspace, api } = await setup();
    const file = workspace.file("a.md");
    await file.write("1");
    await workspace.unuse("history");
    await file.write("2");
    await expect(api.versions("a.md")).rejects.toThrow(/not installed/);

    const again = await workspace.use(history());
    expect(await again.versions("a.md")).toEqual([]);
    await file.write("3");
    const [latest] = await again.versions("a.md");
    expect(await again.readText("a.md", latest!.id)).toBe("2");
  });
});
