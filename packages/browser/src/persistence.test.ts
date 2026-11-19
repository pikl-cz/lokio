import { createFakeFileSystem } from "@lokio/testing/fs-access";
import { afterEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, FileSystemDirectoryHandle>();
vi.mock("./handle-store.js", () => ({
  saveHandle: vi.fn(
    async (key: string, handle: FileSystemDirectoryHandle) => void store.set(key, handle),
  ),
  loadHandle: vi.fn(async (key: string) => store.get(key)),
  deleteHandle: vi.fn(async (key: string) => void store.delete(key)),
}));

const { BrowserAdapter } = await import("./adapter.js");

describe("BrowserAdapter.pick / restore", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    store.clear();
  });

  it("throws NOT_SUPPORTED without the File System Access API", async () => {
    await expect(BrowserAdapter.pick()).rejects.toMatchObject({ code: "NOT_SUPPORTED" });
  });

  it("picks a directory read-write by default and persists it", async () => {
    const fs = createFakeFileSystem();
    const showDirectoryPicker = vi.fn(async () => fs.root);
    vi.stubGlobal("window", { showDirectoryPicker });

    const adapter = await BrowserAdapter.pick({ id: "notes", persistAs: "main" });
    expect(showDirectoryPicker).toHaveBeenCalledWith({ mode: "readwrite", id: "notes" });
    expect(adapter.root).toBe(fs.root);
    expect(store.get("main")).toBe(fs.root);

    await BrowserAdapter.pick({ mode: "read" });
    expect(showDirectoryPicker).toHaveBeenLastCalledWith({ mode: "read" });
  });

  it("restores a persisted handle, leaving the permission prompt to the caller", async () => {
    expect(await BrowserAdapter.restore("missing")).toBeNull();
    const fs = createFakeFileSystem({ permission: "prompt" });
    store.set("main", fs.root);
    const adapter = await BrowserAdapter.restore("main", { mode: "read" });
    expect(adapter?.mode).toBe("read");
    expect(await adapter?.queryPermission()).toBe("prompt");
    expect(await adapter?.requestPermission()).toBe("granted");
  });
});
