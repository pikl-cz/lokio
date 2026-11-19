import "fake-indexeddb/auto";
import { BrowserAdapter } from "@lokio/browser";
import { createFakeFileSystem } from "@lokio/testing/fs-access";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openWorkspace } from "./browser.js";

const codeOf = (promise: Promise<unknown>) =>
  promise.then(
    () => "resolved",
    (error: { code?: string }) => error.code,
  );

function stubBrowser({ supported = true } = {}) {
  const picked = createFakeFileSystem({ name: "picked" });
  const opfs = createFakeFileSystem({ name: "opfs" });
  const showDirectoryPicker = vi.fn(async () => picked.root);
  if (supported) vi.stubGlobal("window", { showDirectoryPicker });
  vi.stubGlobal("navigator", { storage: { getDirectory: async () => opfs.root } });
  return { picked, opfs, showDirectoryPicker };
}

function stubRestore(
  permission: "granted" | "prompt" | "denied" | null,
  requestResult = "granted" as const,
) {
  const fs = createFakeFileSystem({
    name: "saved",
    permission: permission ?? "granted",
    requestResult,
  });
  return vi
    .spyOn(BrowserAdapter, "restore")
    .mockResolvedValue(permission === null ? null : BrowserAdapter.fromHandle(fs.root));
}

describe("@lokio/auto (browser)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("reuses a persisted folder with granted permission", async () => {
    stubBrowser();
    const restore = stubRestore("granted");
    const setup = vi.fn();
    const workspace = await openWorkspace({ persistKey: "notes", plugins: [{ name: "p", setup }] });
    expect(restore).toHaveBeenCalledWith("notes", { mode: "readwrite" });
    expect((workspace.baseAdapter as BrowserAdapter).root.name).toBe("saved");
    expect(setup).toHaveBeenCalledOnce();
  });

  it("re-requests permission when asked to", async () => {
    stubBrowser();
    stubRestore("prompt");
    const workspace = await openWorkspace({ requestPermission: true });
    expect((workspace.baseAdapter as BrowserAdapter).root.name).toBe("saved");
  });

  it("explains how to re-grant permission when it is not granted", async () => {
    stubBrowser();
    stubRestore("prompt");
    const error = (await openWorkspace().catch((e: unknown) => e)) as Error & { code?: string };
    expect(error.code).toBe("PERMISSION_DENIED");
    expect(error.message).toMatch(/requestPermission/);
  });

  it("picks and persists a folder when nothing usable is saved", async () => {
    const { showDirectoryPicker } = stubBrowser();
    stubRestore("denied");
    const pick = vi.spyOn(BrowserAdapter, "pick");
    const workspace = await openWorkspace({
      pick: true,
      pickerId: "lokio",
      persistKey: "k",
      mode: "read",
    });
    expect(pick).toHaveBeenCalledWith({ mode: "read", id: "lokio" });
    expect(showDirectoryPicker).toHaveBeenCalledOnce();
    expect((workspace.baseAdapter as BrowserAdapter).root.name).toBe("picked");
  }, 10_000);

  it("falls back to OPFS", async () => {
    stubBrowser({ supported: false });
    const workspace = await openWorkspace({ fallback: "opfs", pick: true });
    expect((workspace.baseAdapter as BrowserAdapter).root.name).toBe("opfs");
  });

  it("explains missing support and missing folders", async () => {
    stubBrowser({ supported: false });
    expect(await codeOf(openWorkspace())).toBe("NOT_SUPPORTED");
    vi.unstubAllGlobals();
    stubBrowser();
    stubRestore(null);
    expect(await codeOf(openWorkspace())).toBe("NOT_FOUND");
  });

  it("treats a failing handle store as nothing saved", async () => {
    stubBrowser();
    vi.spyOn(BrowserAdapter, "restore").mockRejectedValue(new Error("IndexedDB blocked"));
    expect(await codeOf(openWorkspace())).toBe("NOT_FOUND");
  });
});

describe("@lokio/auto (browser) persistence", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("remembers the picked folder", async () => {
    stubBrowser();
    stubRestore(null);
    // fake-indexeddb can't structured-clone fake handles; a plain stand-in proves the save happens.
    const picked = { kind: "directory", name: "plain" } as unknown as FileSystemDirectoryHandle;
    vi.spyOn(BrowserAdapter, "pick").mockResolvedValue(BrowserAdapter.fromHandle(picked));
    await openWorkspace({ pick: true, persistKey: "remember-me" });
    const { loadHandle } = await import("@lokio/browser");
    expect(await loadHandle("remember-me")).toEqual(picked);
  });
});
