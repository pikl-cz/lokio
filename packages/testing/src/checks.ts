import { isLokioError, type LokioAdapter, type LokioErrorCode, type WatchEvent } from "@lokio/core";

/**
 * Framework-free adapter conformance checks. Used by the Vitest suite
 * (`@lokio/testing/conformance`) and by `lokio doctor`.
 */
export interface AdapterCheck {
  name: string;
  /** Optional adapter method the check needs; the check is skipped without it. */
  requires?: "move" | "watch" | "lock";
  run(adapter: LokioAdapter): Promise<void>;
}

export class CheckFailedError extends Error {
  override name = "CheckFailedError";
}

const encode = (text: string) => new TextEncoder().encode(text);
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new CheckFailedError(message);
}

function assertEqual<T>(actual: T, expected: T, message: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  assert(a === e, `${message}: expected ${e}, got ${a}`);
}

async function assertRejects(promise: Promise<unknown>, code: LokioErrorCode, what: string) {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e ?? new Error("rejected with nothing"),
  );
  assert(error !== undefined, `${what}: expected rejection with ${code}, but it resolved`);
  assert(isLokioError(error, code), `${what}: expected ${code}, got ${String(error)}`);
}

const names = async (adapter: LokioAdapter, path: string) =>
  (await adapter.readDir(path)).map((entry) => `${entry.name}:${entry.kind}`).sort();

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const adapterChecks: AdapterCheck[] = [
  {
    name: "round-trips bytes and creates parent directories",
    async run(adapter) {
      await adapter.writeFile("a/b/c.txt", encode("hello"));
      assertEqual(decode(await adapter.readFile("a/b/c.txt")), "hello", "content");
      assertEqual((await adapter.stat("a/b")).kind, "directory", "parent kind");
      const stat = await adapter.stat("a/b/c.txt");
      assertEqual(stat.kind, "file", "file kind");
      assertEqual(stat.size, 5, "file size");
    },
  },
  {
    name: "round-trips binary and empty files",
    async run(adapter) {
      const bytes = new Uint8Array(256).map((_, i) => i);
      await adapter.writeFile("bin.dat", bytes);
      assertEqual([...(await adapter.readFile("bin.dat"))], [...bytes], "binary content");
      await adapter.writeFile("empty.txt", new Uint8Array());
      assertEqual((await adapter.readFile("empty.txt")).byteLength, 0, "empty file length");
    },
  },
  {
    name: "round-trips unicode file names",
    async run(adapter) {
      await adapter.writeFile("poznámky/žluťoučký kůň.md", encode("ok"));
      assertEqual(await names(adapter, "poznámky"), ["žluťoučký kůň.md:file"], "listing");
      assertEqual(decode(await adapter.readFile("poznámky/žluťoučký kůň.md")), "ok", "content");
    },
  },
  {
    name: "overwrites existing files",
    async run(adapter) {
      await adapter.writeFile("f.txt", encode("long content"));
      await adapter.writeFile("f.txt", encode("short"));
      assertEqual(decode(await adapter.readFile("f.txt")), "short", "content");
    },
  },
  {
    name: "reports existence of files, directories and the root",
    async run(adapter) {
      assert(await adapter.exists(""), "root should exist");
      assert(!(await adapter.exists("missing")), "missing entry should not exist");
      assert(!(await adapter.exists("missing/deeper")), "missing nested entry should not exist");
      await adapter.mkdir("empty");
      assert(await adapter.exists("empty"), "empty directory should exist");
      assertEqual((await adapter.stat("empty")).kind, "directory", "kind");
      assertEqual((await adapter.stat("")).kind, "directory", "root kind");
    },
  },
  {
    name: "mkdir is idempotent and creates parents",
    async run(adapter) {
      await adapter.mkdir("x/y/z");
      await adapter.mkdir("x/y/z");
      assertEqual(await names(adapter, "x/y"), ["z:directory"], "listing");
    },
  },
  {
    name: "lists direct children with their kind",
    async run(adapter) {
      await adapter.writeFile("dir/a.md", encode("a"));
      await adapter.writeFile("dir/sub/b.md", encode("b"));
      await adapter.mkdir("dir/empty");
      assertEqual(
        await names(adapter, "dir"),
        ["a.md:file", "empty:directory", "sub:directory"],
        "listing",
      );
    },
  },
  {
    name: "throws NOT_FOUND for missing entries",
    async run(adapter) {
      await assertRejects(adapter.readFile("missing.txt"), "NOT_FOUND", "readFile");
      await assertRejects(adapter.stat("missing.txt"), "NOT_FOUND", "stat");
      await assertRejects(adapter.readDir("missing"), "NOT_FOUND", "readDir");
      await assertRejects(adapter.deleteFile("missing.txt"), "NOT_FOUND", "deleteFile");
      await assertRejects(adapter.rmdir("missing"), "NOT_FOUND", "rmdir");
    },
  },
  {
    name: "throws TYPE_MISMATCH when files and directories are confused",
    async run(adapter) {
      await adapter.writeFile("file.txt", encode("x"));
      await adapter.mkdir("dir");
      await assertRejects(adapter.readFile("dir"), "TYPE_MISMATCH", "readFile on a directory");
      await assertRejects(adapter.readDir("file.txt"), "TYPE_MISMATCH", "readDir on a file");
      await assertRejects(adapter.deleteFile("dir"), "TYPE_MISMATCH", "deleteFile on a directory");
      await assertRejects(adapter.rmdir("file.txt"), "TYPE_MISMATCH", "rmdir on a file");
      await assertRejects(
        adapter.writeFile("dir", encode("x")),
        "TYPE_MISMATCH",
        "writeFile onto a directory",
      );
      await assertRejects(adapter.mkdir("file.txt/sub"), "TYPE_MISMATCH", "mkdir below a file");
      assert(await adapter.exists("file.txt"), "file must survive");
      assert(await adapter.exists("dir"), "directory must survive");
    },
  },
  {
    name: "refuses to remove non-empty directories unless recursive",
    async run(adapter) {
      await adapter.writeFile("dir/a.md", encode("a"));
      await assertRejects(adapter.rmdir("dir"), "NOT_EMPTY", "rmdir");
      await adapter.rmdir("dir", { recursive: true });
      assert(!(await adapter.exists("dir")), "directory should be gone");
      assert(!(await adapter.exists("dir/a.md")), "children should be gone");
    },
  },
  {
    name: "removes empty directories without recursive",
    async run(adapter) {
      await adapter.mkdir("empty");
      await adapter.rmdir("empty");
      assert(!(await adapter.exists("empty")), "directory should be gone");
    },
  },
  {
    name: "deletes files",
    async run(adapter) {
      await adapter.writeFile("f.txt", encode("x"));
      await adapter.deleteFile("f.txt");
      assert(!(await adapter.exists("f.txt")), "file should be gone");
    },
  },
  {
    name: "does not alias written or read buffers",
    async run(adapter) {
      const buffer = encode("abc");
      await adapter.writeFile("f.bin", buffer);
      buffer[0] = 0;
      const read = await adapter.readFile("f.bin");
      read[1] = 0;
      assertEqual(decode(await adapter.readFile("f.bin")), "abc", "content");
    },
  },
  {
    name: "moves files and directories natively",
    requires: "move",
    async run(adapter) {
      await adapter.writeFile("src/a.md", encode("a"));
      await adapter.writeFile("src/nested/b.md", encode("b"));
      await adapter.move!("src/a.md", "renamed.md");
      assertEqual(decode(await adapter.readFile("renamed.md")), "a", "moved file");
      assert(!(await adapter.exists("src/a.md")), "source file should be gone");

      await adapter.move!("src", "deep/target");
      assertEqual(decode(await adapter.readFile("deep/target/nested/b.md")), "b", "moved tree");
      assert(!(await adapter.exists("src")), "source directory should be gone");
    },
  },
  {
    name: "reports external changes to watchers",
    requires: "watch",
    async run(adapter) {
      const events: WatchEvent[] = [];
      const stop = await adapter.watch!("", (event) => events.push(event));
      try {
        await sleep(50); // some native watchers need a moment to arm
        await adapter.writeFile("watched/file.txt", encode("x"));
        for (let waited = 0; waited < 3000; waited += 25) {
          if (events.some((event) => event.path === "watched/file.txt")) break;
          await sleep(25);
        }
        assert(
          events.some((event) => event.path === "watched/file.txt"),
          `expected an event for watched/file.txt, got ${JSON.stringify(events)}`,
        );
      } finally {
        stop();
      }
    },
  },
  {
    name: "serializes work holding the same lock",
    requires: "lock",
    async run(adapter) {
      const log: string[] = [];
      const task = (id: string) =>
        adapter.lock!("conformance", async () => {
          log.push(`${id}:start`);
          await sleep(20);
          log.push(`${id}:end`);
        });
      await Promise.all([task("a"), task("b")]);
      assert(
        log.join() === "a:start,a:end,b:start,b:end" ||
          log.join() === "b:start,b:end,a:start,a:end",
        `lock did not serialize: ${log.join()}`,
      );
    },
  },
];

export interface CheckResult {
  name: string;
  status: "passed" | "failed" | "skipped";
  error?: unknown;
}

/** Runs every check on a fresh adapter from `factory`. Never throws; inspect the results. */
export async function runAdapterChecks(
  factory: () => LokioAdapter | Promise<LokioAdapter>,
  options: { cleanup?: (adapter: LokioAdapter) => void | Promise<void> } = {},
): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  for (const check of adapterChecks) {
    const adapter = await factory();
    try {
      if (check.requires && typeof adapter[check.requires] !== "function") {
        results.push({ name: check.name, status: "skipped" });
        continue;
      }
      await check.run(adapter);
      results.push({ name: check.name, status: "passed" });
    } catch (error) {
      results.push({ name: check.name, status: "failed", error });
    } finally {
      await options.cleanup?.(adapter);
    }
  }
  return results;
}
