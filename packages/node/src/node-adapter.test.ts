import { mkdir, mkdtemp, readdir, rm, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isLokioError, Lokio } from "@lokio/core";
import { describeAdapterConformance } from "@lokio/testing/conformance";
import type { ChangeEvent, WatchEvent } from "@lokio/types";
import { afterEach, describe, expect, it } from "vitest";
import { NodeAdapter } from "./index.js";

const roots: string[] = [];
const tempRoot = async () => {
  const root = await mkdtemp(join(tmpdir(), "lokio-node-"));
  roots.push(root);
  return root;
};
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

const encode = (text: string) => new TextEncoder().encode(text);
const codeOf = (promise: Promise<unknown>) =>
  promise.then(
    () => "resolved",
    (error: { code?: string }) => error.code,
  );

async function waitFor(condition: () => boolean, ms = 3000): Promise<void> {
  for (let waited = 0; waited < ms; waited += 20) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("timed out waiting for condition");
}

describeAdapterConformance("NodeAdapter", async () => new NodeAdapter({ root: await tempRoot() }));
describeAdapterConformance(
  "NodeAdapter (non-atomic writes)",
  async () => new NodeAdapter({ root: await tempRoot(), atomicWrites: false }),
);

describe("NodeAdapter sandboxing", () => {
  it("refuses paths that escape the root", async () => {
    const base = await tempRoot();
    await writeFile(join(base, "secret.txt"), "secret");
    const adapter = new NodeAdapter({ root: join(base, "ws") });
    expect(await codeOf(adapter.readFile("../secret.txt"))).toBe("INVALID_PATH");
    expect(await codeOf(adapter.move("../secret.txt", "x"))).toBe("INVALID_PATH");
  });

  it("refuses to delete or move the root", async () => {
    const adapter = new NodeAdapter({ root: await tempRoot() });
    expect(await codeOf(adapter.rmdir("", { recursive: true }))).toBe("INVALID_PATH");
    expect(await codeOf(adapter.move("", "x"))).toBe("INVALID_PATH");
    expect(await adapter.exists("")).toBe(true);
  });
});

describe("NodeAdapter details", () => {
  it("reports capabilities", async () => {
    const root = await tempRoot();
    expect(new NodeAdapter({ root }).capabilities).toEqual({ atomicWrite: true });
    expect(new NodeAdapter({ root, atomicWrites: false }).capabilities).toEqual({
      atomicWrite: false,
    });
  });

  it("hides temp files and resolves symlink kinds in listings", async () => {
    const root = await tempRoot();
    await mkdir(join(root, "real-dir"));
    await writeFile(join(root, "a.md.abc123.lokio-tmp"), "partial");
    await symlink(join(root, "real-dir"), join(root, "link-dir"));
    await symlink(join(root, "missing"), join(root, "broken-link"));
    const adapter = new NodeAdapter({ root });
    const entries = (await adapter.readDir("")).sort((a, b) => a.name.localeCompare(b.name));
    expect(entries).toEqual([
      { name: "broken-link", kind: "file" },
      { name: "link-dir", kind: "directory" },
      { name: "real-dir", kind: "directory" },
    ]);
  });

  it("leaves no temp files behind after atomic writes", async () => {
    const root = await tempRoot();
    const adapter = new NodeAdapter({ root });
    await adapter.writeFile("a.txt", encode("1"));
    await adapter.writeFile("a.txt", encode("2"));
    expect(await readdir(root)).toEqual(["a.txt"]);
  });

  it("maps generic filesystem errors to LokioError", async () => {
    const root = await tempRoot();
    const adapter = new NodeAdapter({ root });
    await adapter.writeFile("file", encode("x"));
    // ENOTDIR on a path below a file
    expect(await codeOf(adapter.readFile("file/child"))).toBe("TYPE_MISMATCH");
    expect(await adapter.exists("file/child")).toBe(false);
    expect(await codeOf(adapter.writeFile("file/child", encode("x")))).toBe("TYPE_MISMATCH");
  });

  it("closes active watchers", async () => {
    const adapter = new NodeAdapter({ root: await tempRoot() });
    adapter.watch("", () => {});
    adapter.watch("", () => {});
    await adapter.close();
    await adapter.close();
  });

  it("creates a missing root, unless create: false", async () => {
    const root = join(await tempRoot(), "not-yet-created");
    expect(() => new NodeAdapter({ root, create: false })).toThrow(/Not found/);
    const adapter = new NodeAdapter({ root });
    expect(await readdir(root)).toEqual([]);
    expect(await adapter.readDir("")).toEqual([]);
    adapter.watch("", () => {})();
    expect(() => new NodeAdapter({ root, create: false })).not.toThrow();
  });

  it("fails to watch a missing directory with NOT_FOUND", async () => {
    const adapter = new NodeAdapter({ root: await tempRoot() });
    expect(() => adapter.watch("missing", () => {})).toThrow(/Not found/);
  });
});

describe("NodeAdapter watch", () => {
  it("maps created, modified and deleted events and ignores temp and lock files", async () => {
    const root = await tempRoot();
    const adapter = new NodeAdapter({ root });
    await adapter.mkdir("notes");
    const events: WatchEvent[] = [];
    const stop = adapter.watch("", (event) => events.push(event));
    try {
      await new Promise((resolve) => setTimeout(resolve, 50));
      await writeFile(join(root, "notes", "a.md"), "1");
      await waitFor(() => events.some((e) => e.path === "notes/a.md" && e.type === "created"));

      await adapter.lock("x", async () => {});
      await writeFile(join(root, "notes", "b.md.zz.lokio-tmp"), "tmp");
      await writeFile(join(root, "notes", "a.md"), "22");
      await waitFor(() => events.some((e) => e.path === "notes/a.md" && e.type === "modified"));

      await rm(join(root, "notes", "a.md"));
      await waitFor(() => events.some((e) => e.path === "notes/a.md" && e.type === "deleted"));

      expect(events.some((e) => e.path.endsWith(".lokio-tmp"))).toBe(false);
      expect(events.some((e) => e.path.startsWith(".lokio/locks"))).toBe(false);
      expect(events.find((e) => e.type === "created" && e.path === "notes/a.md")?.kind).toBe(
        "file",
      );
    } finally {
      stop();
      stop();
    }
  });

  it("reports paths relative to the root when watching a subdirectory", async () => {
    const root = await tempRoot();
    const adapter = new NodeAdapter({ root });
    await adapter.mkdir("sub/inner");
    const events: WatchEvent[] = [];
    const stop = adapter.watch("sub", (event) => events.push(event));
    try {
      await new Promise((resolve) => setTimeout(resolve, 50));
      await mkdir(join(root, "sub", "inner", "dir"));
      await waitFor(() => events.some((e) => e.path === "sub/inner/dir"));
      expect(events.find((e) => e.path === "sub/inner/dir")?.kind).toBe("directory");
    } finally {
      stop();
    }
  });
});

describe("NodeAdapter lock", () => {
  it("serializes across adapter instances (separate processes share only the disk)", async () => {
    const root = await tempRoot();
    const a = new NodeAdapter({ root });
    const b = new NodeAdapter({ root });
    const log: string[] = [];
    const task = (adapter: NodeAdapter, id: string) =>
      adapter.lock("shared", async () => {
        log.push(`${id}+`);
        await new Promise((resolve) => setTimeout(resolve, 30));
        log.push(`${id}-`);
      });
    await Promise.all([task(a, "a"), task(b, "b")]);
    expect([log.slice(0, 2), log.slice(2)].map((pair) => pair[0]?.[0] === pair[1]?.[0])).toEqual([
      true,
      true,
    ]);
    expect(await readdir(join(root, ".lokio", "locks"))).toEqual([]);
  });

  it("times out while another holder keeps the lock", async () => {
    const root = await tempRoot();
    const a = new NodeAdapter({ root });
    const b = new NodeAdapter({ root });
    let release!: () => void;
    const held = a.lock("busy", () => new Promise<void>((resolve) => (release = resolve)));
    await waitFor(() => release !== undefined);
    const error = await b
      .lock("busy", async () => "never", { timeoutMs: 60 })
      .catch((e: unknown) => e);
    expect(isLokioError(error, "LOCK_TIMEOUT")).toBe(true);
    release();
    await held;
    expect(await b.lock("busy", async () => "free")).toBe("free");
  });

  it("takes over stale lock files left by crashed processes", async () => {
    const root = await tempRoot();
    const adapter = new NodeAdapter({ root, lockStaleMs: 1000 });
    await adapter.lock("stale", async () => {
      // Simulate a crash: copy our lock file and leave it behind, backdated.
    });
    const lockDir = join(root, ".lokio", "locks");
    const fakeName = (await readdir(lockDir).catch(() => []))[0];
    expect(fakeName).toBeUndefined();

    // Create the lock file the adapter would use and backdate it.
    let lockFile = "";
    await adapter.lock("stale", async () => {
      lockFile = join(lockDir, (await readdir(lockDir))[0]!);
    });
    await writeFile(lockFile, JSON.stringify({ pid: 999999, token: "crashed" }));
    const old = new Date(Date.now() - 60_000);
    await utimes(lockFile, old, old);

    expect(await adapter.lock("stale", async () => "taken over", { timeoutMs: 200 })).toBe(
      "taken over",
    );
  });

  it("does not delete a lock file that was taken over by someone else", async () => {
    const root = await tempRoot();
    const adapter = new NodeAdapter({ root });
    const lockDir = join(root, ".lokio", "locks");
    await adapter.lock("mine", async () => {
      const file = join(lockDir, (await readdir(lockDir))[0]!);
      await writeFile(file, JSON.stringify({ token: "someone-else" }));
    });
    expect((await readdir(lockDir)).length).toBe(1);
  });

  it("keeps long-running locks fresh", async () => {
    const root = await tempRoot();
    const holder = new NodeAdapter({ root, lockStaleMs: 60 });
    const contender = new NodeAdapter({ root, lockStaleMs: 60 });
    const log: string[] = [];
    const long = holder.lock("long", async () => {
      log.push("holder+");
      await new Promise((resolve) => setTimeout(resolve, 250));
      log.push("holder-");
    });
    await waitFor(() => log.length > 0);
    await contender.lock("long", async () => void log.push("contender"), { timeoutMs: 2000 });
    await long;
    expect(log).toEqual(["holder+", "holder-", "contender"]);
  });
});

describe("NodeAdapter with Workspace", () => {
  it("reports a raw external write once and suppresses echoes of local writes", async () => {
    const root = await tempRoot();
    const workspace = await Lokio.openWorkspace(new NodeAdapter({ root }));
    const events: ChangeEvent[] = [];
    const stop = workspace.watch((event) => events.push(event));
    try {
      await new Promise((resolve) => setTimeout(resolve, 50));
      await workspace.file("mine.md").write("local");
      await writeFile(join(root, "theirs.md"), "external");
      await waitFor(() => events.some((e) => e.path === "theirs.md"));
      await new Promise((resolve) => setTimeout(resolve, 150));

      const mine = events.filter((e) => e.path === "mine.md");
      expect(mine.map((e) => e.source)).toEqual(["local"]);
      const theirs = events.filter((e) => e.path === "theirs.md");
      expect(theirs.length).toBeGreaterThanOrEqual(1);
      expect(theirs.every((e) => e.source === "external")).toBe(true);
    } finally {
      stop();
      await workspace.close();
    }
  });
});
