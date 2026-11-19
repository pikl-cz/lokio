import { chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type CliIO, cliVersion, formatBytes, run } from "./cli.js";

const dirs: string[] = [];
const tempDir = async () => {
  const dir = await mkdtemp(join(tmpdir(), "lokio-cli-"));
  dirs.push(dir);
  return dir;
};
afterEach(async () => {
  vi.restoreAllMocks();
  for (const dir of dirs.splice(0)) {
    await chmod(dir, 0o755).catch(() => {});
    await rm(dir, { recursive: true, force: true });
  }
});

function capture(cwd = process.cwd()) {
  const out: string[] = [];
  const err: string[] = [];
  const io: CliIO = { stdout: (line) => out.push(line), stderr: (line) => err.push(line), cwd };
  return { io, out: () => out.join("\n"), err: () => err.join("\n") };
}

describe("lokio CLI", () => {
  it("prints help without a command or with --help", async () => {
    for (const argv of [[], ["--help"], ["-h"], ["init", "--help"]]) {
      const { io, out } = capture();
      expect(await run(argv, io)).toBe(0);
      expect(out()).toContain("Usage: lokio <command>");
    }
  });

  it("prints the version", async () => {
    const { io, out } = capture();
    expect(await run(["-v"], io)).toBe(0);
    expect(out()).toBe(await cliVersion());
    expect(out()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("rejects unknown commands, prototype keys and unknown options", async () => {
    for (const argv of [
      ["nope"],
      ["toString"],
      ["__proto__"],
      ["info", "--bogus"],
      ["info", "a", "b"],
    ]) {
      const { io, err } = capture();
      expect(await run(argv, io)).toBe(1);
      expect(err()).not.toBe("");
    }
  });

  describe("init", () => {
    it("creates the workspace marker relative to cwd", async () => {
      const cwd = await tempDir();
      const { io, out } = capture(cwd);
      expect(await run(["init", "my-notes"], io)).toBe(0);
      const config = JSON.parse(
        await readFile(join(cwd, "my-notes", ".lokio", "workspace.json"), "utf8"),
      );
      expect(config.version).toBe(1);
      expect(Date.parse(config.createdAt)).not.toBeNaN();
      expect(out()).toContain("Next steps");
    });

    it("refuses to overwrite without --force", async () => {
      const dir = await tempDir();
      expect(await run(["init", dir], capture().io)).toBe(0);
      const second = capture();
      expect(await run(["init", dir], second.io)).toBe(1);
      expect(second.err()).toContain("--force");
      expect(await run(["init", dir, "--force"], capture().io)).toBe(0);
    });
  });

  describe("doctor", () => {
    it("passes on a writable folder and cleans up after itself", async () => {
      const dir = await tempDir();
      const { io, out } = capture();
      expect(await run(["doctor", dir], io)).toBe(0);
      expect(out()).toContain(`Node ${process.version}`);
      expect(out()).toContain("✓ round-trips bytes");
      expect(out()).toContain("All checks passed.");
      expect(await readdir(dir)).toEqual([]);
    });

    it("keeps an existing .lokio folder", async () => {
      const dir = await tempDir();
      await mkdir(join(dir, ".lokio"));
      await writeFile(join(dir, ".lokio", "workspace.json"), "{}");
      expect(await run(["doctor", dir], capture().io)).toBe(0);
      expect(await readdir(join(dir, ".lokio"))).toEqual(["workspace.json"]);
    });

    it("fails for a missing folder or a file", async () => {
      const dir = await tempDir();
      await writeFile(join(dir, "file.txt"), "x");
      for (const target of [join(dir, "missing"), join(dir, "file.txt")]) {
        const { io, err } = capture();
        expect(await run(["doctor", target], io)).toBe(1);
        expect(err()).toContain("not a readable and writable directory");
      }
    });

    it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
      "fails for a read-only folder",
      async () => {
        const dir = await tempDir();
        await chmod(dir, 0o555);
        expect(await run(["doctor", dir], capture().io)).toBe(1);
      },
    );

    it("reports failing checks", async () => {
      const testing = await import("@lokio/testing");
      vi.spyOn(testing, "runAdapterChecks").mockResolvedValue([
        { name: "good", status: "passed" },
        { name: "bad", status: "failed", error: new Error("broken") },
        { name: "optional", status: "skipped" },
      ]);
      const dir = await tempDir();
      const { io, out, err } = capture();
      expect(await run(["doctor", dir], io)).toBe(1);
      expect(out()).toContain("✗ bad");
      expect(out()).toContain("broken");
      expect(out()).toContain("– optional");
      expect(err()).toContain("1 check(s) failed.");
    });
  });

  describe("info", () => {
    it("summarizes the workspace and skips .lokio", async () => {
      const dir = await tempDir();
      await run(["init", dir], capture().io);
      await mkdir(join(dir, "notes"));
      await writeFile(join(dir, "notes", "a.md"), "12345");
      await writeFile(join(dir, "b.md"), "x".repeat(2048));
      const { io, out } = capture();
      expect(await run(["info", dir], io)).toBe(0);
      expect(out()).toContain("Adapter:     node");
      expect(out()).toContain("crossProcessLocks=yes");
      expect(out()).toContain("2 file(s), 1 folder(s), 2.0 KB");
      expect(out()).not.toContain("not initialized");
    });

    it("hints at init and fails for missing folders", async () => {
      const dir = await tempDir();
      const { io, out } = capture();
      expect(await run(["info", dir], io)).toBe(0);
      expect(out()).toContain("not initialized");
      expect(await run(["info", join(dir, "missing")], capture().io)).toBe(1);
    });
  });

  it("reports unexpected command failures", async () => {
    const dir = await tempDir();
    await writeFile(join(dir, "file"), "x");
    const { io, err } = capture();
    // init below a file cannot create .lokio
    expect(await run(["init", join(dir, "file")], io)).toBe(1);
    expect(err()).toContain("lokio init failed");
  });
});

describe("formatBytes", () => {
  it.each([
    [0, "0 B"],
    [1023, "1023 B"],
    [1024, "1.0 KB"],
    [5 * 1024 * 1024, "5.0 MB"],
    [1024 ** 5 * 3, "3072.0 TB"],
  ])("%d -> %s", (bytes, expected) => {
    expect(formatBytes(bytes)).toBe(expected);
  });
});
