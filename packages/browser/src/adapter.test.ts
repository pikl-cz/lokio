import { isLokioError } from "@lokio/core";
import { describeAdapterConformance } from "@lokio/testing/conformance";
import { createFakeFileSystem, type FakeFileSystemOptions } from "@lokio/testing/fs-access";
import type { WatchEvent } from "@lokio/types";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BrowserAdapter } from "./adapter.js";

/** Creates an adapter over the fake FS; `observe` installs the fake FileSystemObserver while constructing. */
function setup(options: FakeFileSystemOptions & { observe?: boolean } = {}) {
  const fs = createFakeFileSystem(options);
  if (options.observe) vi.stubGlobal("FileSystemObserver", fs.Observer);
  const adapter = BrowserAdapter.fromHandle(fs.root);
  vi.unstubAllGlobals();
  return { fs, adapter };
}

const encode = (text: string) => new TextEncoder().encode(text);
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
const codeOf = (promise: Promise<unknown>) =>
  promise.then(
    () => "resolved",
    (error: { code?: string }) => error.code,
  );

describeAdapterConformance(
  "BrowserAdapter (fake FS, all features)",
  () => setup({ observe: true }).adapter,
);
describeAdapterConformance(
  "BrowserAdapter (fake FS, no move/observer)",
  () => setup({ supportsMove: false }).adapter,
);

describe("BrowserAdapter feature detection", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("enables optional methods only when the browser supports them", () => {
    expect(setup({ observe: true }).adapter.watch).toBeTypeOf("function");
    expect(setup().adapter.watch).toBeUndefined();
    expect(setup({ supportsMove: false }).adapter.move).toBeUndefined();
    expect(setup().adapter.move).toBeTypeOf("function");
    vi.stubGlobal("navigator", {});
    expect(setup().adapter.lock).toBeUndefined();
  });

  it("detects File System Access API support", () => {
    expect(BrowserAdapter.isSupported()).toBe(false);
    vi.stubGlobal("window", { showDirectoryPicker: () => {} });
    expect(BrowserAdapter.isSupported()).toBe(true);
  });

  it("opens the Origin Private File System", async () => {
    vi.stubGlobal("navigator", {});
    await expect(BrowserAdapter.opfs()).rejects.toThrow(/Origin Private/);
    const fs = createFakeFileSystem();
    vi.stubGlobal("navigator", { storage: { getDirectory: async () => fs.root } });
    const adapter = await BrowserAdapter.opfs();
    expect(adapter.root).toBe(fs.root);
  });
});

describe("BrowserAdapter move detection", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("enables move when only file handles can move (Chromium) and copies directories", async () => {
    class FileSystemFileHandle {
      move() {}
    }
    vi.stubGlobal("FileSystemFileHandle", FileSystemFileHandle);
    const fs = createFakeFileSystem({ supportsMove: false });
    const adapter = BrowserAdapter.fromHandle(fs.root);
    expect(adapter.move).toBeTypeOf("function");
    await adapter.writeFile("dir/a.txt", encode("A"));
    await adapter.move!("dir", "moved");
    expect(decode(await adapter.readFile("moved/a.txt"))).toBe("A");
    expect(await adapter.exists("dir")).toBe(false);
  });
});

describe("BrowserAdapter error handling", () => {
  it("maps permission errors", async () => {
    const { fs, adapter } = setup();
    await adapter.writeFile("a.txt", encode("x"));
    fs.setPermission("readwrite", "prompt");
    fs.setPermission("read", "prompt");
    expect(await codeOf(adapter.readFile("a.txt"))).toBe("PERMISSION_DENIED");
    expect(await codeOf(adapter.writeFile("a.txt", encode("y")))).toBe("PERMISSION_DENIED");
    expect(await codeOf(adapter.readDir(""))).toBe("PERMISSION_DENIED");
    expect(await codeOf(adapter.mkdir("d"))).toBe("PERMISSION_DENIED");
    await expect(adapter.exists("a.txt")).rejects.toSatisfy((e) =>
      isLokioError(e, "PERMISSION_DENIED"),
    );
  });

  it("aborts the swap file when a write fails, keeping the original", async () => {
    const { fs, adapter } = setup();
    await adapter.writeFile("a.txt", encode("original"));
    fs.failNextWrite("QuotaExceededError");
    const error = await adapter.writeFile("a.txt", encode("new")).catch((e: unknown) => e);
    expect(isLokioError(error, "UNKNOWN")).toBe(true);
    expect((error as Error).cause).toBeInstanceOf(DOMException);
    expect(fs.openWritables).toBe(0);
    expect(decode(await adapter.readFile("a.txt"))).toBe("original");
  });

  it("rejects root-level file operations", async () => {
    const { adapter } = setup();
    expect(await codeOf(adapter.readFile(""))).toBe("INVALID_PATH");
    expect(await codeOf(adapter.rmdir(""))).toBe("INVALID_PATH");
    expect((await adapter.stat("")).kind).toBe("directory");
  });

  it("maps move conflicts to ALREADY_EXISTS", async () => {
    const { adapter } = setup();
    await adapter.mkdir("a");
    await adapter.writeFile("b/a/x", encode("x"));
    expect(await codeOf(adapter.move!("a", "b/a"))).toBe("ALREADY_EXISTS");
    expect(await codeOf(adapter.move!("missing", "z"))).toBe("NOT_FOUND");
  });

  it("falls back to copy + delete when the browser cannot move an entry", async () => {
    const { adapter } = setup();
    await adapter.writeFile("src/a.txt", encode("A"));
    await adapter.writeFile("file.txt", encode("F"));
    const moveSpy = vi
      .spyOn(Object.getPrototypeOf(adapter.root), "move")
      .mockRejectedValue(new DOMException("nope", "NotSupportedError"));
    await adapter.move!("src", "dst");
    await adapter.move!("file.txt", "moved.txt");
    moveSpy.mockRestore();
    expect(decode(await adapter.readFile("dst/a.txt"))).toBe("A");
    expect(decode(await adapter.readFile("moved.txt"))).toBe("F");
    expect(await adapter.exists("src")).toBe(false);
    expect(await adapter.exists("file.txt")).toBe(false);
  });
});

describe("BrowserAdapter permissions", () => {
  it("queries first and prompts only when needed", async () => {
    const { fs, adapter } = setup({ permission: "prompt", requestResult: "granted" });
    expect(await adapter.queryPermission()).toBe("prompt");
    const request = vi.spyOn(fs.root, "requestPermission");
    expect(await adapter.requestPermission()).toBe("granted");
    expect(await adapter.requestPermission()).toBe("granted");
    expect(request).toHaveBeenCalledOnce();
  });

  it("does not prompt when denied", async () => {
    const { adapter } = setup({ permission: "denied" });
    expect(await adapter.requestPermission("read")).toBe("denied");
  });

  it("treats handles without a permission model (OPFS in some browsers) as granted", async () => {
    const { fs } = setup();
    const bare = Object.assign(Object.create(Object.getPrototypeOf(fs.root)), fs.root);
    Object.defineProperty(bare, "queryPermission", { value: undefined });
    const adapter = BrowserAdapter.fromHandle(bare as FileSystemDirectoryHandle);
    expect(await adapter.queryPermission()).toBe("granted");
    expect(await adapter.requestPermission()).toBe("granted");
  });
});

describe("BrowserAdapter watch", () => {
  it("reports changes below the watched path and stops on unsubscribe / close", async () => {
    const { adapter } = setup({ observe: true });
    await adapter.mkdir("notes");
    const events: WatchEvent[] = [];
    const stop = await adapter.watch!("notes", (event) => events.push(event));
    await adapter.writeFile("notes/a.md", encode("a"));
    await adapter.move!("notes/a.md", "notes/b.md");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(events).toContainEqual({ type: "created", path: "notes/a.md", kind: "file" });
    expect(events).toContainEqual({ type: "deleted", path: "notes/a.md", kind: "file" });
    expect(events).toContainEqual({ type: "created", path: "notes/b.md", kind: "file" });

    stop();
    events.length = 0;
    await adapter.writeFile("notes/c.md", encode("c"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(events).toEqual([]);

    await adapter.watch!("", (event) => events.push(event));
    await adapter.close();
    await adapter.writeFile("d.md", encode("d"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(events).toEqual([]);
  });

  it("rejects watching a missing directory", async () => {
    const { adapter } = setup({ observe: true });
    expect(await codeOf(adapter.watch!("missing", () => {}))).toBe("NOT_FOUND");
  });
});

describe("BrowserAdapter locks", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("uses namespaced Web Locks", async () => {
    const request = vi.fn((_name: string, _options: unknown, fn: () => Promise<unknown>) => fn());
    vi.stubGlobal("navigator", { locks: { request } });
    const { adapter } = setup();
    expect(await adapter.lock!("doc", async () => 42)).toBe(42);
    expect(request).toHaveBeenCalledWith("lokio:doc", {}, expect.any(Function));
  });

  it("times out with LOCK_TIMEOUT", async () => {
    const { adapter } = setup();
    let release!: () => void;
    const held = adapter.lock!("busy", () => new Promise<void>((resolve) => (release = resolve)));
    const waiting = adapter.lock!("busy", async () => "never", { timeoutMs: 20 });
    expect(await codeOf(waiting)).toBe("LOCK_TIMEOUT");
    release();
    await held;
    expect(await adapter.lock!("busy", async () => "free", { timeoutMs: 1000 })).toBe("free");
  });

  it("propagates errors from the locked function", async () => {
    const { adapter } = setup();
    await expect(
      adapter.lock!(
        "x",
        async () => {
          throw new Error("inner");
        },
        { timeoutMs: 1000 },
      ),
    ).rejects.toThrow("inner");
  });
});
