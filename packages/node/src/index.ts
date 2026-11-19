import { createHash, randomBytes } from "node:crypto";
import { existsSync, type FSWatcher, watch as fsWatch, mkdirSync } from "node:fs";
import {
  cp,
  mkdir,
  open,
  readdir,
  readFile,
  rename,
  rm,
  rmdir,
  stat,
  unlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  InvalidPathError,
  LockTimeoutError,
  type LokioAdapter,
  LokioError,
  NotEmptyError,
  NotFoundError,
  PermissionDeniedError,
  TypeMismatchError,
} from "@lokio/core";
import type { DirEntry, EntryStat, Unsubscribe, WatchEvent } from "@lokio/types";

export interface NodeAdapterOptions {
  /** Directory that becomes the workspace root. All paths are resolved relative to it. */
  root: string;
  /**
   * Write to a temp file and rename it into place, so a crash mid-write never
   * leaves a truncated file behind. Defaults to `true`.
   */
  atomicWrites?: boolean;
  /**
   * Create the root directory if it doesn't exist (the adapter contract says the
   * root always exists). With `false`, a missing root throws `NotFoundError`.
   * Defaults to `true`.
   */
  create?: boolean;
  /**
   * A lock file older than this is considered abandoned (its owner crashed)
   * and may be taken over. Held locks are refreshed while running. Defaults to 30s.
   */
  lockStaleMs?: number;
}

/** Suffix of temp files used by atomic writes. Hidden from listings and watchers. */
const TEMP_SUFFIX = ".lokio-tmp";
/** Workspace-relative folder holding cross-process lock files. */
const LOCK_DIR = ".lokio/locks";

function errnoCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { code: unknown }).code)
    : undefined;
}

/** Translates Node errno errors into Lokio errors. */
function toLokioError(error: unknown, path: string, expected?: "file" | "directory"): Error {
  if (error instanceof LokioError) return error;
  switch (errnoCode(error)) {
    case "ENOENT":
      return new NotFoundError(path, { cause: error });
    case "EACCES":
    case "EPERM":
      return new PermissionDeniedError(path, { cause: error });
    case "ENOTEMPTY":
      return new NotEmptyError(path, { cause: error });
    case "EISDIR":
      return new TypeMismatchError(path, "file", { cause: error });
    case "ENOTDIR":
      return new TypeMismatchError(path, expected ?? "directory", { cause: error });
    default:
      return new LokioError(`Filesystem error at ${path}`, { cause: error, path });
  }
}

async function writeAtomic(target: string, data: Uint8Array): Promise<void> {
  const temp = `${target}.${randomBytes(6).toString("hex")}${TEMP_SUFFIX}`;
  try {
    await writeFile(temp, data);
    await rename(temp, target);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
}

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

/** File-system-safe, collision-free name for a lock. */
function lockFileName(name: string): string {
  const readable = name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 64);
  const hash = createHash("sha256").update(name).digest("hex").slice(0, 12);
  return `${readable}-${hash}.lock`;
}

/** Adapter for Node, CLI tools, Electron and Tauri backends. */
export class NodeAdapter implements LokioAdapter {
  readonly name = "node";
  readonly root: string;
  readonly capabilities: { atomicWrite: boolean };
  private readonly atomicWrites: boolean;
  private readonly lockStaleMs: number;
  private readonly watchers = new Set<FSWatcher>();

  constructor(options: NodeAdapterOptions) {
    this.root = resolve(options.root);
    this.atomicWrites = options.atomicWrites ?? true;
    this.lockStaleMs = options.lockStaleMs ?? 30_000;
    this.capabilities = { atomicWrite: this.atomicWrites };
    if (options.create === false) {
      if (!existsSync(this.root)) throw new NotFoundError(options.root);
    } else {
      mkdirSync(this.root, { recursive: true });
    }
  }

  /**
   * Core already normalizes paths, but the adapter is a public class that can
   * be called directly, so it re-checks that nothing escapes the root.
   */
  private resolvePath(path: string): string {
    const target = resolve(this.root, path);
    const rel = relative(this.root, target);
    if (rel.startsWith("..") || isAbsolute(rel)) {
      throw new InvalidPathError(path, "escapes the workspace root");
    }
    return target;
  }

  /** Absolute path -> workspace-relative path with `/` separators. */
  private toWorkspacePath(absolute: string): string {
    return relative(this.root, absolute).split(sep).join("/");
  }

  private async kindOf(path: string): Promise<"file" | "directory"> {
    return (await this.stat(path)).kind;
  }

  private async statOrNull(path: string): Promise<EntryStat | null> {
    return (await this.exists(path)) ? this.stat(path) : null;
  }

  async exists(path: string): Promise<boolean> {
    try {
      await stat(this.resolvePath(path));
      return true;
    } catch (error) {
      if (errnoCode(error) === "ENOENT" || errnoCode(error) === "ENOTDIR") return false;
      throw toLokioError(error, path);
    }
  }

  async stat(path: string): Promise<EntryStat> {
    try {
      const info = await stat(this.resolvePath(path));
      const isDirectory = info.isDirectory();
      return {
        kind: isDirectory ? "directory" : "file",
        size: isDirectory ? 0 : info.size,
        lastModified: info.mtimeMs,
      };
    } catch (error) {
      throw toLokioError(error, path);
    }
  }

  async readFile(path: string): Promise<Uint8Array> {
    try {
      const buffer = await readFile(this.resolvePath(path));
      return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    } catch (error) {
      throw toLokioError(error, path, "file");
    }
  }

  async writeFile(path: string, data: Uint8Array): Promise<void> {
    const target = this.resolvePath(path);
    await this.mkdir(this.toWorkspacePath(dirname(target)));
    try {
      if (this.atomicWrites) await writeAtomic(target, data);
      else await writeFile(target, data);
    } catch (error) {
      // Writing onto a directory reports EISDIR or EPERM depending on the OS.
      if ((await this.statOrNull(path))?.kind === "directory") {
        throw new TypeMismatchError(path, "file", { cause: error });
      }
      throw toLokioError(error, path, "file");
    }
  }

  async deleteFile(path: string): Promise<void> {
    // unlink() on a directory yields EPERM on macOS and EISDIR on Linux - check explicitly.
    if ((await this.kindOf(path)) !== "file") throw new TypeMismatchError(path, "file");
    try {
      await unlink(this.resolvePath(path));
    } catch (error) {
      throw toLokioError(error, path, "file");
    }
  }

  async readDir(path: string): Promise<DirEntry[]> {
    const target = this.resolvePath(path);
    try {
      const dirents = await readdir(target, { withFileTypes: true });
      const entries: DirEntry[] = [];
      for (const dirent of dirents) {
        if (dirent.name.endsWith(TEMP_SUFFIX)) continue;
        if (dirent.isDirectory()) {
          entries.push({ name: dirent.name, kind: "directory" });
        } else if (dirent.isSymbolicLink()) {
          // Report what the link points to; broken links are reported as files.
          const info = await stat(join(target, dirent.name)).catch(() => undefined);
          entries.push({ name: dirent.name, kind: info?.isDirectory() ? "directory" : "file" });
        } else {
          entries.push({ name: dirent.name, kind: "file" });
        }
      }
      return entries;
    } catch (error) {
      throw toLokioError(error, path, "directory");
    }
  }

  async mkdir(path: string): Promise<void> {
    try {
      await mkdir(this.resolvePath(path), { recursive: true });
    } catch (error) {
      if (errnoCode(error) === "EEXIST" || errnoCode(error) === "ENOTDIR") {
        throw new TypeMismatchError(path, "directory", { cause: error });
      }
      throw toLokioError(error, path, "directory");
    }
  }

  async rmdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    const target = this.resolvePath(path);
    if (target === this.root) {
      throw new InvalidPathError(path, "refusing to delete the workspace root");
    }
    if ((await this.kindOf(path)) !== "directory") throw new TypeMismatchError(path, "directory");
    try {
      if (options?.recursive) await rm(target, { recursive: true });
      else await rmdir(target);
    } catch (error) {
      throw toLokioError(error, path, "directory");
    }
  }

  /** Native rename. Falls back to copy + delete across devices (EXDEV). */
  async move(from: string, to: string): Promise<void> {
    const source = this.resolvePath(from);
    const target = this.resolvePath(to);
    if (source === this.root || target === this.root) {
      throw new InvalidPathError(from, "cannot move the workspace root");
    }
    await this.mkdir(this.toWorkspacePath(dirname(target)));
    try {
      await rename(source, target);
    } catch (error) {
      if (errnoCode(error) !== "EXDEV") throw toLokioError(error, from);
      try {
        await cp(source, target, { recursive: true, errorOnExist: true, force: false });
        await rm(source, { recursive: true });
      } catch (fallbackError) {
        throw toLokioError(fallbackError, from);
      }
    }
  }

  /**
   * Reports changes below `path` using recursive `fs.watch`.
   *
   * Event types are derived from the disk state rather than trusted from
   * `fs.watch`, which differs per platform. Caveats: events may be coalesced or
   * duplicated, a file replaced atomically by another app (write temp + rename)
   * can be reported as `created`, and on platforms without birth times files
   * that existed before watching started are reported as `created` on their first change.
   * Temp files of atomic writes and lock files are never reported.
   */
  watch(path: string, listener: (event: WatchEvent) => void): Unsubscribe {
    const base = this.resolvePath(path);
    let watcher: FSWatcher;
    try {
      watcher = fsWatch(base, { recursive: true });
    } catch (error) {
      throw toLokioError(error, path, "directory");
    }
    this.watchers.add(watcher);

    // Platforms disagree on event types (macOS reports in-place writes as "rename"),
    // so classify by looking at the disk: paths seen before, or born before we
    // started watching, are "modified"; new ones are "created"; missing ones "deleted".
    const startedAt = Date.now();
    const known = new Set<string>();

    watcher.on("change", (_eventType, filename) => {
      if (filename == null) {
        listener({ type: "unknown", path });
        return;
      }
      const absolute = join(base, filename.toString());
      const workspacePath = this.toWorkspacePath(absolute);
      if (workspacePath.endsWith(TEMP_SUFFIX)) return;
      if (workspacePath === LOCK_DIR || workspacePath.startsWith(`${LOCK_DIR}/`)) return;

      void stat(absolute).then(
        (info) => {
          const kind = info.isDirectory() ? "directory" : "file";
          const existedBefore = info.birthtimeMs > 0 && info.birthtimeMs < startedAt;
          const seen = known.has(workspacePath) || existedBefore;
          known.add(workspacePath);
          // Directory "modifications" are just their children changing - those are reported separately.
          if (seen && kind === "directory") return;
          listener({ type: seen ? "modified" : "created", path: workspacePath, kind });
        },
        () => {
          known.delete(workspacePath);
          listener({ type: "deleted", path: workspacePath });
        },
      );
    });
    // E.g. the watched directory was deleted. Stop quietly instead of crashing the process.
    watcher.on("error", () => stop());

    const stop = () => {
      if (!this.watchers.delete(watcher)) return;
      watcher.close();
    };
    return stop;
  }

  /**
   * Cross-process lock backed by an exclusive lock file in `.lokio/locks`.
   * Waits up to `timeoutMs` (default 10s), then throws `LockTimeoutError`.
   * Lock files left by crashed processes are taken over once older than `lockStaleMs`.
   */
  async lock<T>(name: string, fn: () => Promise<T>, options?: { timeoutMs?: number }): Promise<T> {
    const timeoutMs = options?.timeoutMs ?? 10_000;
    const lockDir = this.resolvePath(LOCK_DIR);
    const file = join(lockDir, lockFileName(name));
    const token = randomBytes(12).toString("hex");
    const deadline = Date.now() + timeoutMs;
    let delay = 5;

    await mkdir(lockDir, { recursive: true });
    for (;;) {
      try {
        const handle = await open(file, "wx");
        try {
          await handle.writeFile(
            JSON.stringify({ pid: process.pid, token, createdAt: Date.now() }),
          );
        } finally {
          await handle.close();
        }
        break;
      } catch (error) {
        if (errnoCode(error) !== "EEXIST") throw toLokioError(error, LOCK_DIR);
      }
      const info = await stat(file).catch(() => undefined);
      if (info && Date.now() - info.mtimeMs > this.lockStaleMs) {
        await rm(file, { force: true });
        continue;
      }
      if (!info) continue; // released between our attempts
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new LockTimeoutError(name, timeoutMs);
      await sleep(Math.min(delay, remaining));
      delay = Math.min(delay * 2, 100);
    }

    // Keep the lock fresh so long-running work isn't mistaken for a crash.
    const heartbeat = setInterval(
      () => {
        const now = new Date();
        void utimes(file, now, now).catch(() => {});
      },
      Math.max(this.lockStaleMs / 3, 10),
    );
    heartbeat.unref?.();

    try {
      return await fn();
    } finally {
      clearInterval(heartbeat);
      // Only remove the file if it is still ours (it may have been taken over as stale).
      const content = await readFile(file, "utf8").catch(() => "");
      if (content.includes(token)) await rm(file, { force: true });
    }
  }

  /** Stops all active watchers. */
  async close(): Promise<void> {
    for (const watcher of this.watchers) watcher.close();
    this.watchers.clear();
  }
}
