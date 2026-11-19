import { MemoryAdapter } from "@lokio/testing";
import { describe, expect, it, vi } from "vitest";
import { AdapterWrapper, getCapabilities, type LokioAdapter } from "./adapter.js";

const minimal = (): LokioAdapter => {
  const memory = new MemoryAdapter();
  return {
    name: "minimal",
    exists: (p) => memory.exists(p),
    stat: (p) => memory.stat(p),
    readFile: (p) => memory.readFile(p),
    writeFile: (p, d) => memory.writeFile(p, d),
    deleteFile: (p) => memory.deleteFile(p),
    readDir: (p) => memory.readDir(p),
    mkdir: (p) => memory.mkdir(p),
    rmdir: (p, o) => memory.rmdir(p, o),
  };
};

describe("getCapabilities", () => {
  it("infers capabilities from optional methods", () => {
    expect(getCapabilities(minimal())).toEqual({
      watch: false,
      move: false,
      atomicWrite: false,
      permissions: false,
      crossProcessLocks: false,
    });
    expect(getCapabilities(new MemoryAdapter())).toMatchObject({
      watch: true,
      move: true,
      atomicWrite: true,
    });
  });
});

describe("AdapterWrapper", () => {
  it("forwards only the optional methods the inner adapter has", () => {
    expect(new AdapterWrapper(minimal()).move).toBeUndefined();
    expect(new AdapterWrapper(minimal()).watch).toBeUndefined();
    expect(typeof new AdapterWrapper(new MemoryAdapter()).move).toBe("function");
    expect(getCapabilities(new AdapterWrapper(new MemoryAdapter())).atomicWrite).toBe(true);
  });

  it("forwards every call", async () => {
    const inner = new MemoryAdapter();
    const wrapper = new AdapterWrapper(inner);
    await wrapper.writeFile("a/b.txt", new Uint8Array([1]));
    await wrapper.mkdir("c");
    expect(await wrapper.exists("a/b.txt")).toBe(true);
    expect((await wrapper.stat("a/b.txt")).size).toBe(1);
    expect([...(await wrapper.readFile("a/b.txt"))]).toEqual([1]);
    expect((await wrapper.readDir("")).map((e) => e.name)).toEqual(["a", "c"]);
    await wrapper.move!("c", "d");
    const events: string[] = [];
    const stop = await wrapper.watch!("", (event) => events.push(event.path));
    await wrapper.deleteFile("a/b.txt");
    await wrapper.rmdir("a");
    (stop as () => void)();
    expect(events).toEqual(["a/b.txt", "a"]);
    await wrapper.close();
  });

  it("forwards locks, permissions and close when present", async () => {
    const inner: LokioAdapter = {
      ...minimal(),
      lock: vi.fn(async (_name, fn) => fn()),
      queryPermission: vi.fn(async () => "granted" as const),
      requestPermission: vi.fn(async () => "denied" as const),
      close: vi.fn(async () => {}),
    };
    const wrapper = new AdapterWrapper(inner);
    expect(await wrapper.lock!("l", async () => 42)).toBe(42);
    expect(await wrapper.queryPermission!("read")).toBe("granted");
    expect(await wrapper.requestPermission!("readwrite")).toBe("denied");
    await wrapper.close();
    expect(inner.close).toHaveBeenCalled();
  });

  it("lets subclasses override optional methods", async () => {
    class Custom extends AdapterWrapper {
      override async move(_from: string, _to: string): Promise<void> {
        throw new Error("custom move");
      }
    }
    await expect(new Custom(new MemoryAdapter()).move("a", "b")).rejects.toThrow("custom move");
  });
});
