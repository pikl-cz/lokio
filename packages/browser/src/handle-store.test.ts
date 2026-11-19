import "fake-indexeddb/auto";
import { describe, expect, it, vi } from "vitest";
import { deleteHandle, loadHandle, saveHandle } from "./handle-store.js";

// fake-indexeddb clones with structuredClone, which (unlike browsers) can't clone
// FileSystemHandle instances - a plain object stands in for one here.
const handle = { kind: "directory", name: "notes" } as unknown as FileSystemDirectoryHandle;

describe("handle store", () => {
  it("saves, loads and deletes handles", async () => {
    expect(await loadHandle("k")).toBeUndefined();
    await saveHandle("k", handle);
    expect(await loadHandle("k")).toEqual(handle);
    await saveHandle("k", { ...handle, name: "other" } as unknown as FileSystemDirectoryHandle);
    expect((await loadHandle("k"))?.name).toBe("other");
    await deleteHandle("k");
    expect(await loadHandle("k")).toBeUndefined();
  });

  it("rejects when the value cannot be stored", async () => {
    await expect(
      saveHandle("bad", (() => {}) as unknown as FileSystemDirectoryHandle),
    ).rejects.toThrow();
  });

  it("reports missing IndexedDB as NOT_SUPPORTED", async () => {
    vi.stubGlobal("indexedDB", undefined);
    await expect(loadHandle("k")).rejects.toMatchObject({ code: "NOT_SUPPORTED" });
    vi.unstubAllGlobals();
  });
});
