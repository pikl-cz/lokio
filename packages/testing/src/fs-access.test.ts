/// <reference types="wicg-file-system-access" />
import { describe, expect, it } from "vitest";
import {
  createFakeDirectoryHandle,
  createFakeFileSystem,
  type FakeObserverRecord,
} from "./fs-access.js";

const nameOf = (promise: Promise<unknown>) =>
  promise.then(
    () => "resolved",
    (error: Error) => error.name,
  );

const text = async (handle: FileSystemFileHandle) => (await handle.getFile()).text();

async function write(handle: FileSystemFileHandle, data: string) {
  const writable = await handle.createWritable();
  await writable.write(data);
  await writable.close();
}

describe("fake File System Access API", () => {
  it("creates and resolves files and directories", async () => {
    const root = createFakeDirectoryHandle("my-root");
    expect(root.name).toBe("my-root");
    expect(root.kind).toBe("directory");
    const dir = await root.getDirectoryHandle("notes", { create: true });
    const file = await dir.getFileHandle("a.md", { create: true });
    await write(file, "hello");
    expect(await text(await dir.getFileHandle("a.md"))).toBe("hello");
    expect(await root.resolve(file)).toEqual(["notes", "a.md"]);
    expect(await dir.resolve(root)).toBeNull();
    expect(await file.isSameEntry(await dir.getFileHandle("a.md"))).toBe(true);
    expect(await file.isSameEntry(dir)).toBe(false);
  });

  it("uses browser DOMException names", async () => {
    const root = createFakeDirectoryHandle();
    await root.getDirectoryHandle("dir", { create: true });
    await (await root.getDirectoryHandle("dir")).getFileHandle("x", { create: true });
    expect(await nameOf(root.getFileHandle("missing"))).toBe("NotFoundError");
    expect(await nameOf(root.getFileHandle("dir"))).toBe("TypeMismatchError");
    expect(await nameOf(root.removeEntry("dir"))).toBe("InvalidModificationError");
    expect(await nameOf(root.removeEntry("missing"))).toBe("NotFoundError");
    expect(await nameOf(root.getFileHandle("a/b"))).toBe("TypeError");
    await root.removeEntry("dir", { recursive: true });
    expect(await nameOf(root.getDirectoryHandle("dir"))).toBe("NotFoundError");
  });

  it("iterates keys, values and entries", async () => {
    const root = createFakeDirectoryHandle();
    await root.getFileHandle("a", { create: true });
    await root.getDirectoryHandle("b", { create: true });
    const keys: string[] = [];
    for await (const key of root.keys()) keys.push(key);
    const kinds: string[] = [];
    for await (const handle of root.values()) kinds.push(handle.kind);
    const entries: string[] = [];
    for await (const [name, handle] of root.entries()) entries.push(`${name}:${handle.kind}`);
    const iterated: string[] = [];
    for await (const [name] of root as unknown as AsyncIterable<[string, FileSystemHandle]>)
      iterated.push(name);
    expect(keys).toEqual(["a", "b"]);
    expect(kinds).toEqual(["file", "directory"]);
    expect(entries).toEqual(["a:file", "b:directory"]);
    expect(iterated).toEqual(["a", "b"]);
  });

  it("has swap-file semantics: content is replaced on close, abort discards", async () => {
    const fs = createFakeFileSystem();
    const file = await fs.root.getFileHandle("f.txt", { create: true });
    await write(file, "original");

    const aborted = await file.createWritable();
    await aborted.write("discarded");
    expect(fs.openWritables).toBe(1);
    await aborted.abort();
    await aborted.abort();
    expect(fs.openWritables).toBe(0);
    expect(await text(file)).toBe("original");

    fs.failNextWrite();
    const failing = await file.createWritable();
    expect(await nameOf(failing.write("x"))).toBe("QuotaExceededError");
    await failing.abort();
    expect(await text(file)).toBe("original");
    expect(await nameOf(failing.write("x"))).toBe("TypeError");
  });

  it("supports write params, seek, truncate and binary chunks", async () => {
    const root = createFakeDirectoryHandle();
    const file = await root.getFileHandle("f.bin", { create: true });
    await write(file, "hello world");
    const writable = await file.createWritable({ keepExistingData: true });
    await writable.seek(6);
    await writable.write(new TextEncoder().encode("WORLD").buffer);
    await writable.write({ type: "write", position: 0, data: new Blob(["J"]) });
    await writable.write(new DataView(new TextEncoder().encode("!").buffer));
    await writable.truncate(8);
    await writable.close();
    expect(await text(file)).toBe("J!llo WO");
    const other = await file.createWritable();
    await expect(other.write(42 as unknown as string)).rejects.toThrow(TypeError);
    await other.abort();
  });

  it("fails on handles whose entry was removed", async () => {
    const root = createFakeDirectoryHandle();
    const file = await root.getFileHandle("f", { create: true });
    const writable = await file.createWritable();
    await root.removeEntry("f");
    expect(await nameOf(file.getFile())).toBe("NotFoundError");
    expect(await nameOf(writable.close())).toBe("NotFoundError");
  });

  it("enforces and requests permissions", async () => {
    const fs = createFakeFileSystem({ permission: "prompt", requestResult: "denied" });
    expect(await fs.root.queryPermission({ mode: "read" })).toBe("prompt");
    expect(await nameOf(fs.root.getFileHandle("x", { create: true }))).toBe("NotAllowedError");
    expect(await fs.root.requestPermission({ mode: "readwrite" })).toBe("denied");
    expect(await fs.root.requestPermission({ mode: "readwrite" })).toBe("denied");

    fs.setRequestResult("granted");
    fs.setPermission("readwrite", "prompt");
    expect(await fs.root.requestPermission({ mode: "readwrite" })).toBe("granted");
    expect(await fs.root.queryPermission({ mode: "read" })).toBe("granted");
    expect(await fs.root.queryPermission()).toBe("granted");
    await fs.root.getFileHandle("x", { create: true });

    fs.setPermission("readwrite", "denied");
    fs.setPermission("read", "granted");
    await fs.root.getFileHandle("x");
    expect(await nameOf(fs.root.removeEntry("x"))).toBe("NotAllowedError");
  });

  it("moves and renames entries", async () => {
    const root = createFakeDirectoryHandle();
    type Movable = FileSystemHandle & { move(a: unknown, b?: string): Promise<void> };
    const file = (await root.getFileHandle("a.txt", { create: true })) as unknown as Movable;
    const dir = (await root.getDirectoryHandle("dir", { create: true })) as unknown as Movable &
      FileSystemDirectoryHandle;
    await file.move("b.txt");
    expect(file.name).toBe("b.txt");
    await file.move(dir);
    await file.move(dir, "c.txt");
    expect(await root.resolve(file)).toEqual(["dir", "c.txt"]);
    expect(await nameOf(dir.move(dir))).toBe("InvalidModificationError");
    expect(await nameOf((root as unknown as Movable).move("x"))).toBe("InvalidModificationError");
    await dir.getDirectoryHandle("sub", { create: true });
    const other = (await root.getDirectoryHandle("other", { create: true })) as unknown as Movable;
    expect(await nameOf(other.move(dir, "sub"))).toBe("InvalidModificationError");
  });

  it("can hide move()", async () => {
    const root = createFakeDirectoryHandle("r", { supportsMove: false });
    expect((root as unknown as { move?: unknown }).move).toBeUndefined();
  });

  it("implements FileSystemObserver", async () => {
    const fs = createFakeFileSystem();
    const records: FakeObserverRecord[] = [];
    const observer = new fs.Observer((batch) => records.push(...batch));
    await observer.observe(fs.root, { recursive: true });
    const dir = await fs.root.getDirectoryHandle("d", { create: true });
    const file = await dir.getFileHandle("f", { create: true });
    await write(file, "x");
    await (file as unknown as { move(n: string): Promise<void> }).move("g");
    await dir.removeEntry("g");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(records.map((r) => `${r.type}:${r.relativePathComponents.join("/")}`)).toEqual([
      "appeared:d",
      "appeared:d/f",
      "modified:d/f",
      "moved:d/g",
      "disappeared:d/g",
    ]);
    expect(records[3]?.relativePathMovedFrom).toEqual(["d", "f"]);

    records.length = 0;
    const shallow = new fs.Observer((batch) => records.push(...batch));
    observer.disconnect();
    await shallow.observe(fs.root);
    await dir.getFileHandle("deep", { create: true });
    await fs.root.getFileHandle("top", { create: true });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(records.map((r) => r.relativePathComponents.join("/"))).toEqual(["top"]);
    shallow.unobserve(fs.root);
    await expect(shallow.observe({} as FileSystemHandle)).rejects.toThrow(TypeError);
  });
});
