import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openWorkspace } from "./node.js";

describe("@lokio/auto (node)", () => {
  const dirs: string[] = [];
  afterEach(async () => {
    vi.restoreAllMocks();
    for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
  });

  it("opens a NodeAdapter workspace at root, creating it if needed", async () => {
    const base = await mkdtemp(join(tmpdir(), "lokio-auto-"));
    dirs.push(base);
    const root = join(base, "new-workspace");
    const setup = vi.fn();
    const workspace = await openWorkspace({ root, plugins: [{ name: "p", setup }] });
    expect(workspace.adapterName).toBe("node");
    expect(setup).toHaveBeenCalledOnce();
    await workspace.file("a.md").write("hi");
    expect(await readFile(join(root, "a.md"), "utf8")).toBe("hi");
  });

  it("defaults to the current directory", async () => {
    const base = await mkdtemp(join(tmpdir(), "lokio-auto-"));
    dirs.push(base);
    vi.spyOn(process, "cwd").mockReturnValue(base);
    const workspace = await openWorkspace();
    await workspace.file("cwd.txt").write("x");
    expect(await readFile(join(base, "cwd.txt"), "utf8")).toBe("x");
  });
});
