import {
  AdapterWrapper,
  definePlugin,
  isInternalPath,
  isLokioError,
  isWithin,
  joinPath,
  type LokioAdapter,
  type LokioPlugin,
  NotFoundError,
  normalizePath,
  type Workspace,
} from "@lokio/core";

export interface HistoryOptions {
  /** Folder that stores the snapshots. Defaults to `.lokio/history`. */
  dir?: string;
  /** Versions kept per file; older ones are pruned. Defaults to 20. */
  maxVersions?: number;
  /** Return `false` for paths that should not be versioned. Defaults to all user files. */
  include?: (path: string) => boolean;
}

export interface FileVersion {
  /** Sortable id; pass it to `read` / `restore`. */
  id: string;
  /** When the snapshot was taken (ms since epoch). */
  timestamp: number;
  /** Size of the snapshot in bytes (as stored). */
  size: number;
}

export interface HistoryApi {
  /** Snapshots of `path`, newest first. */
  versions(path: string): Promise<FileVersion[]>;
  read(path: string, id: string): Promise<Uint8Array>;
  readText(path: string, id: string): Promise<string>;
  /** Writes the version back to `path`. The current content is snapshotted first. */
  restore(path: string, id: string): Promise<void>;
  /** Removes the history of one file, or all history. */
  clear(path?: string): Promise<void>;
}

const ID_PATTERN = /^(\d{15})-(\d{6})$/;

class HistoryAdapter extends AdapterWrapper {
  private counter = 0;

  constructor(
    inner: LokioAdapter,
    private readonly config: Required<HistoryOptions>,
  ) {
    super(inner);
    if (inner.move) {
      this.move = async (from, to) => {
        await this.snapshot(from);
        await inner.move!(from, to);
      };
    }
  }

  override async writeFile(path: string, data: Uint8Array): Promise<void> {
    await this.snapshot(path);
    await this.inner.writeFile(path, data);
  }

  override async deleteFile(path: string): Promise<void> {
    await this.snapshot(path);
    await this.inner.deleteFile(path);
  }

  override async rmdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    if (options?.recursive && this.tracks(path)) await this.snapshotTree(path);
    await this.inner.rmdir(path, options);
  }

  private tracks(path: string): boolean {
    return !isInternalPath(path) && !isWithin(this.config.dir, path) && this.config.include(path);
  }

  private async snapshotTree(path: string): Promise<void> {
    for (const entry of await this.inner.readDir(path)) {
      const child = joinPath(path, entry.name);
      if (entry.kind === "directory") await this.snapshotTree(child);
      else await this.snapshot(child);
    }
  }

  /** Copies the current bytes of `path` (if it is an existing, tracked file) into the history folder. */
  private async snapshot(path: string): Promise<void> {
    if (!this.tracks(path) || !(await this.inner.exists(path))) return;
    if ((await this.inner.stat(path)).kind !== "file") return;

    const data = await this.inner.readFile(path);
    const folder = historyFolder(this.config.dir, path);
    let target: string;
    do {
      target = `${folder}/${String(Date.now()).padStart(15, "0")}-${String(this.counter++ % 1_000_000).padStart(6, "0")}`;
    } while (await this.inner.exists(target));
    await this.inner.writeFile(target, data);
    await this.prune(folder);
  }

  private async prune(folder: string): Promise<void> {
    const ids = (await this.inner.readDir(folder))
      .filter((entry) => entry.kind === "file" && ID_PATTERN.test(entry.name))
      .map((entry) => entry.name)
      .sort();
    for (const id of ids.slice(0, Math.max(0, ids.length - this.config.maxVersions))) {
      await this.inner.deleteFile(`${folder}/${id}`);
    }
  }
}

function historyFolder(dir: string, path: string): string {
  return joinPath(dir, `${path}.history`);
}

/**
 * Keeps previous versions of files. Every overwrite, delete or move of a file
 * first copies the old bytes to `<dir>/<path>.history/<id>`.
 *
 * ```ts
 * const versions = await workspace.use(history({ maxVersions: 50 }));
 * const [latest] = await versions.versions("notes/today.md");
 * await versions.restore("notes/today.md", latest.id);
 * ```
 */
export function history(options: HistoryOptions = {}): LokioPlugin<HistoryApi> {
  const config: Required<HistoryOptions> = {
    dir: normalizePath(options.dir ?? ".lokio/history"),
    maxVersions: Math.max(1, options.maxVersions ?? 20),
    include: options.include ?? (() => true),
  };
  let workspace: Workspace | undefined;

  const active = (): Workspace => {
    if (!workspace) throw new Error("The history plugin is not installed");
    return workspace;
  };

  const read = async (path: string, id: string): Promise<Uint8Array> => {
    if (!ID_PATTERN.test(id)) throw new NotFoundError(`${path}@${id}`);
    return active().adapter.readFile(`${historyFolder(config.dir, normalizePath(path))}/${id}`);
  };

  return definePlugin<HistoryApi>({
    name: "history",
    wrapAdapter: (adapter) => new HistoryAdapter(adapter, config),
    setup(ws) {
      workspace = ws;
      return {
        async versions(path) {
          const folder = historyFolder(config.dir, normalizePath(path));
          const adapter = active().adapter;
          let entries: Awaited<ReturnType<typeof adapter.readDir>>;
          try {
            entries = await adapter.readDir(folder);
          } catch (error) {
            if (isLokioError(error, "NOT_FOUND")) return [];
            throw error;
          }
          const versions: FileVersion[] = [];
          for (const entry of entries) {
            const match = ID_PATTERN.exec(entry.name);
            if (entry.kind !== "file" || !match) continue;
            const { size } = await adapter.stat(`${folder}/${entry.name}`);
            versions.push({ id: entry.name, timestamp: Number(match[1]), size });
          }
          return versions.sort((a, b) => (a.id < b.id ? 1 : -1));
        },
        read,
        async readText(path, id) {
          return new TextDecoder().decode(await read(path, id));
        },
        async restore(path, id) {
          await active()
            .file(path)
            .write(await read(path, id));
        },
        async clear(path) {
          const target =
            path === undefined ? config.dir : historyFolder(config.dir, normalizePath(path));
          const adapter = active().adapter;
          if (await adapter.exists(target)) await adapter.rmdir(target, { recursive: true });
        },
      };
    },
    dispose() {
      workspace = undefined;
    },
  });
}
