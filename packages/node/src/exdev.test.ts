import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const failures = vi.hoisted(() => ({ code: "" as string }));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    rename: async (from: string, to: string) => {
      // Only fail renames that aren't atomic-write temp files.
      if (failures.code && !from.endsWith(".lokio-tmp")) {
        throw Object.assign(new Error(failures.code), { code: failures.code });
      }
      return actual.rename(from, to);
    },
  };
});

const { NodeAdapter } = await import("./index.js");
const encode = (text: string) => new TextEncoder().encode(text);

describe("NodeAdapter.move fallbacks", () => {
  let root = "";
  afterEach(async () => {
    failures.code = "";
    await rm(root, { recursive: true, force: true });
  });

  it("falls back to copy + delete across devices (EXDEV)", async () => {
    root = await mkdtemp(join(tmpdir(), "lokio-exdev-"));
    const adapter = new NodeAdapter({ root });
    await adapter.writeFile("src/a.md", encode("A"));
    failures.code = "EXDEV";
    await adapter.move("src", "dst/moved");
    expect(new TextDecoder().decode(await adapter.readFile("dst/moved/a.md"))).toBe("A");
    expect(await adapter.exists("src")).toBe(false);
  });

  it("maps other rename errors", async () => {
    root = await mkdtemp(join(tmpdir(), "lokio-exdev-"));
    const adapter = new NodeAdapter({ root });
    await adapter.writeFile("a.md", encode("A"));
    failures.code = "EACCES";
    const error = await adapter.move("a.md", "b.md").catch((e: { code?: string }) => e.code);
    expect(error).toBe("PERMISSION_DENIED");
  });

  it("maps errors of the fallback copy", async () => {
    root = await mkdtemp(join(tmpdir(), "lokio-exdev-"));
    const adapter = new NodeAdapter({ root });
    await adapter.writeFile("a.md", encode("A"));
    await adapter.writeFile("b.md", encode("B"));
    failures.code = "EXDEV";
    // Core never moves onto an existing target, but the adapter must still fail cleanly.
    const error = await adapter.move("a.md", "b.md").catch((e: { code?: string }) => e.code);
    expect(typeof error).toBe("string");
  });
});
