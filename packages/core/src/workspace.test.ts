import { MemoryAdapter } from "@lokio/testing";
import type { ChangeEvent } from "@lokio/types";
import { describe, expect, it, vi } from "vitest";
import { AdapterWrapper, type LokioAdapter } from "./adapter.js";
import { isLokioError } from "./errors.js";
import { Lokio } from "./index.js";
import { definePlugin } from "./plugin.js";
import { Workspace } from "./workspace.js";

const open = (files: Record<string, string> = {}, echoSuppressionMs?: number) => {
  const adapter = new MemoryAdapter({ files });
  return Lokio.openWorkspace({ adapter, echoSuppressionMs }).then((workspace) => ({
    workspace,
    adapter,
  }));
};

const describeEvent = (event: ChangeEvent) => `${event.source}:${event.type}:${event.path}`;

describe("Workspace basics", () => {
  it("writes and reads a file through the adapter", async () => {
    const { workspace } = await open();
    const file = await workspace.open("dreams/today.dream");
    await file.write("hello lokio");
    expect(await file.readText()).toBe("hello lokio");
    expect(workspace.adapterName).toBe("memory");
  });

  it("accepts a bare adapter", async () => {
    const workspace = await Lokio.openWorkspace(new MemoryAdapter());
    expect(workspace.capabilities.move).toBe(true);
    expect(workspace.root.isRoot).toBe(true);
  });

  it("normalizes paths and never escapes the root", async () => {
    const { workspace } = await open();
    expect(workspace.file("/a//b/./c.md").path).toBe("a/b/c.md");
    expect(() => workspace.file("../outside.md")).toThrow(/escapes/);
  });

  it("moves, copies and removes", async () => {
    const { workspace } = await open({ "a/x.md": "X" });
    await workspace.copy("a", "b");
    await workspace.move("a/x.md", "c.md");
    await workspace.remove("b");
    expect(await workspace.directory().list()).toEqual([
      { name: "a", kind: "directory" },
      { name: "c.md", kind: "file" },
    ]);
  });

  it("reports permissions as granted when the adapter has no permission model", async () => {
    const { workspace } = await open();
    expect(await workspace.queryPermission()).toBe("granted");
    expect(await workspace.requestPermission("read")).toBe("granted");
  });

  it("delegates permissions to the adapter", async () => {
    class Prompting extends AdapterWrapper {
      override async queryPermission() {
        return "prompt" as const;
      }
      override async requestPermission() {
        return "denied" as const;
      }
    }
    const workspace = await Workspace.create(new Prompting(new MemoryAdapter()));
    expect(workspace.capabilities.permissions).toBe(true);
    expect(await workspace.queryPermission()).toBe("prompt");
    expect(await workspace.requestPermission()).toBe("denied");
  });
});

describe("Workspace change events", () => {
  it("emits local events for mutations", async () => {
    const { workspace } = await open({ "old.md": "o" });
    const events: string[] = [];
    workspace.watch((event) => events.push(describeEvent(event)), { external: false });

    await workspace.file("notes/a.md").write("1");
    await workspace.file("notes/a.md").write("2");
    await workspace.directory("empty").create();
    await workspace.directory("empty").create();
    await workspace.move("old.md", "new.md");
    await workspace.file("notes/a.md").delete();
    await workspace.directory("empty").delete();

    expect(events).toEqual([
      "local:created:notes/a.md",
      "local:modified:notes/a.md",
      "local:created:empty",
      "local:deleted:old.md",
      "local:created:new.md",
      "local:deleted:notes/a.md",
      "local:deleted:empty",
    ]);
  });

  it("reports external changes and suppresses echoes of local writes", async () => {
    const { workspace, adapter } = await open();
    const events: string[] = [];
    workspace.watch((event) => events.push(describeEvent(event)));

    await workspace.file("mine.md").write("local"); // echoed by the memory watcher -> suppressed
    await adapter.writeFile("theirs.md", new TextEncoder().encode("external"));

    expect(events).toEqual(["local:created:mine.md", "external:created:theirs.md"]);
  });

  it("reports external changes to a recently written path once the echo window has passed", async () => {
    vi.useFakeTimers();
    try {
      const { workspace, adapter } = await open({}, 100);
      const events: string[] = [];
      workspace.watch((event) => events.push(describeEvent(event)));
      await workspace.file("a.md").write("local");
      vi.advanceTimersByTime(150);
      await adapter.writeFile("a.md", new Uint8Array([1]));
      expect(events).toEqual(["local:created:a.md", "external:modified:a.md"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("filters by path and hides the internal .lokio folder by default", async () => {
    const { workspace } = await open();
    const scoped: string[] = [];
    const all: string[] = [];
    workspace.watch((event) => scoped.push(event.path), { path: "notes" });
    workspace.watch((event) => all.push(event.path), { includeInternal: true });

    await workspace.file("notes/a.md").write("");
    await workspace.file("other.md").write("");
    await workspace.file(".lokio/state.json").write("");

    expect(scoped).toEqual(["notes/a.md"]);
    expect(all).toContain(".lokio/state.json");
  });

  it("starts the adapter watcher lazily and stops it with the last subscriber", async () => {
    const adapter = new MemoryAdapter();
    const stop = vi.fn();
    const watch = vi.spyOn(adapter, "watch").mockReturnValue(stop);
    const workspace = await Lokio.openWorkspace(adapter);

    expect(watch).not.toHaveBeenCalled();
    const offA = workspace.watch(() => {});
    const offB = workspace.watch(() => {});
    await vi.waitFor(() => expect(watch).toHaveBeenCalledOnce());
    offA();
    offA();
    await Promise.resolve();
    expect(stop).not.toHaveBeenCalled();
    offB();
    await vi.waitFor(() => expect(stop).toHaveBeenCalledOnce());
  });

  it("does not start a watcher for local-only subscriptions or adapters without watch", async () => {
    const adapter = new MemoryAdapter();
    const watch = vi.spyOn(adapter, "watch");
    const workspace = await Lokio.openWorkspace(adapter);
    workspace.watch(() => {}, { external: false })();
    expect(watch).not.toHaveBeenCalled();

    const noWatch = new AdapterWrapper(new MemoryAdapter());
    noWatch.watch = undefined;
    const other = await Lokio.openWorkspace(noWatch);
    expect(other.capabilities.watch).toBe(false);
    other.watch(() => {})();
  });
});

describe("Workspace background errors", () => {
  it("reports a failing adapter watcher as an error event instead of crashing", async () => {
    const adapter = new MemoryAdapter();
    vi.spyOn(adapter, "watch").mockImplementation(() => {
      throw new Error("cannot watch");
    });
    const workspace = await Lokio.openWorkspace(adapter);
    const errors: unknown[] = [];
    workspace.events.on("error", (error) => errors.push(error));
    expect(() => workspace.watch(() => {})).not.toThrow();
    await vi.waitFor(() => expect(errors).toHaveLength(1));
    expect(String(errors[0])).toContain("cannot watch");
  });

  it("falls back to console.warn when nobody listens for errors", async () => {
    const adapter = new MemoryAdapter();
    vi.spyOn(adapter, "watch").mockRejectedValue(new Error("async failure"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const workspace = await Lokio.openWorkspace(adapter);
    const stop = workspace.watch(() => {});
    await vi.waitFor(() => expect(warn).toHaveBeenCalledOnce());
    stop();
    warn.mockRestore();
  });
});

describe("Workspace locks", () => {
  it("serializes work in-process and delegates to adapter locks", async () => {
    const adapter = new MemoryAdapter();
    const adapterLock = vi.fn((_name: string, fn: () => Promise<unknown>) => fn());
    (adapter as LokioAdapter).lock = adapterLock as LokioAdapter["lock"];
    const workspace = await Lokio.openWorkspace(adapter);
    expect(workspace.capabilities.crossProcessLocks).toBe(true);

    const log: string[] = [];
    const task = (id: string) =>
      workspace.lock("k", async () => {
        log.push(`${id}+`);
        await new Promise((resolve) => setTimeout(resolve, 5));
        log.push(`${id}-`);
      });
    await Promise.all([task("a"), task("b")]);
    expect(log).toEqual(["a+", "a-", "b+", "b-"]);
    expect(adapterLock).toHaveBeenCalledTimes(2);
  });
});

describe("Workspace plugins", () => {
  it("returns the plugin API, runs setup exactly once and emits an event", async () => {
    const { workspace } = await open();
    const calls: string[] = [];
    workspace.events.on("plugin:setup", (name) => calls.push(name));
    const plugin = definePlugin({
      name: "example",
      setup: () => {
        calls.push("setup");
        return { greet: () => "hi" };
      },
    });

    const [a, b] = await Promise.all([workspace.use(plugin), workspace.use(plugin)]);
    const c = await workspace.use(plugin);
    expect(a.greet()).toBe("hi");
    expect(a).toBe(b);
    expect(a).toBe(c);
    expect(calls).toEqual(["setup", "example"]);
    expect(workspace.plugin("example")).toBe(plugin);
    expect(workspace.pluginApi(plugin)).toBe(a);
    expect(workspace.pluginApi("missing")).toBeUndefined();
  });

  it("installs plugins passed at open time", async () => {
    const setup = vi.fn();
    const workspace = await Lokio.openWorkspace({
      adapter: new MemoryAdapter(),
      plugins: [{ name: "p", setup }],
    });
    expect(setup).toHaveBeenCalledWith(workspace);
  });

  it("does not register a plugin whose setup failed, so it can be retried", async () => {
    const { workspace } = await open();
    let attempts = 0;
    const plugin = {
      name: "flaky",
      wrapAdapter: (adapter: LokioAdapter) => new AdapterWrapper(adapter),
      setup: () => {
        attempts += 1;
        if (attempts === 1) throw new Error("boom");
      },
    };
    await expect(workspace.use(plugin)).rejects.toThrow("boom");
    expect(workspace.plugin("flaky")).toBeUndefined();
    await workspace.use(plugin);
    expect(workspace.plugin("flaky")).toBe(plugin);
  });

  it("applies adapter wrappers to existing handles and removes them on unuse", async () => {
    const { workspace } = await open();
    const file = workspace.file("a.txt");

    class Upper extends AdapterWrapper {
      override async readFile(path: string): Promise<Uint8Array> {
        const text = new TextDecoder().decode(await this.inner.readFile(path));
        return new TextEncoder().encode(text.toUpperCase());
      }
    }
    const dispose = vi.fn();
    const upper = { name: "upper", wrapAdapter: (a: LokioAdapter) => new Upper(a), dispose };

    await file.write("hello");
    await workspace.use(upper);
    expect(await file.readText()).toBe("HELLO");

    const disposed: string[] = [];
    workspace.events.on("plugin:dispose", (name) => disposed.push(name));
    expect(await workspace.unuse("upper")).toBe(true);
    expect(await workspace.unuse("upper")).toBe(false);
    expect(dispose).toHaveBeenCalledOnce();
    expect(disposed).toEqual(["upper"]);
    expect(await file.readText()).toBe("hello");
  });

  it("stacks wrappers in use() order (last used is outermost)", async () => {
    const { workspace } = await open({ "a.txt": "x" });
    const order: string[] = [];
    const tagging = (tag: string) => ({
      name: tag,
      wrapAdapter: (inner: LokioAdapter) =>
        new (class extends AdapterWrapper {
          override readFile(path: string) {
            order.push(tag);
            return this.inner.readFile(path);
          }
        })(inner),
    });
    await workspace.use(tagging("first"));
    await workspace.use(tagging("second"));
    await workspace.file("a.txt").read();
    expect(order).toEqual(["second", "first"]);
  });
});

describe("Workspace close", () => {
  it("disposes plugins in reverse order, stops watchers and rejects further use", async () => {
    const adapter = new MemoryAdapter();
    const stop = vi.fn();
    vi.spyOn(adapter, "watch").mockReturnValue(stop);
    const closeAdapter = vi.fn(async () => {});
    (adapter as LokioAdapter).close = closeAdapter;
    const workspace = await Lokio.openWorkspace(adapter);
    const disposed: string[] = [];
    await workspace.use({ name: "a", dispose: () => void disposed.push("a") });
    await workspace.use({ name: "b", dispose: () => void disposed.push("b") });
    workspace.watch(() => {});
    const onClose = vi.fn();
    workspace.events.on("close", onClose);

    await workspace.close();
    await workspace.close();

    expect(disposed).toEqual(["b", "a"]);
    expect(stop).toHaveBeenCalledOnce();
    expect(closeAdapter).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
    expect(workspace.closed).toBe(true);

    const error = await workspace
      .file("x.md")
      .read()
      .catch((e: unknown) => e);
    expect(isLokioError(error, "WORKSPACE_CLOSED")).toBe(true);
    await expect(workspace.use({ name: "late" })).rejects.toThrow(/closed/);
    expect(workspace.adapter.move).toBeUndefined();
    expect(workspace.adapter.name).toBe("closed");
  });
});
