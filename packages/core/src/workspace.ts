import type {
  AdapterCapabilities,
  ChangeEvent,
  PermissionMode,
  PermissionState,
  Unsubscribe,
  WatchEvent,
} from "@lokio/types";
import { AdapterWrapper, getCapabilities, type LokioAdapter } from "./adapter.js";
import type { FsContext } from "./context.js";
import { LokioDirectory } from "./directory.js";
import { WorkspaceClosedError } from "./errors.js";
import { EventBus, type EventMap } from "./events.js";
import type { LokioFile } from "./file.js";
import { KeyedMutex } from "./lock.js";
import { copyEntry, moveEntry, removeEntry, type TransferOptions } from "./ops.js";
import { dirname, isInternalPath, isWithin, normalizePath } from "./path.js";
import type { LokioPlugin } from "./plugin.js";

export interface WorkspaceEvents extends EventMap {
  /** A file or directory changed - through this workspace (`local`) or outside of it (`external`). */
  change: [event: ChangeEvent];
  "plugin:setup": [name: string];
  "plugin:dispose": [name: string];
  close: [];
  /** Non-fatal background failures (e.g. the adapter watcher could not start). */
  error: [error: unknown];
}

export interface WorkspaceOptions {
  /** Plugins to install before the workspace is returned. */
  plugins?: LokioPlugin<unknown>[];
  /**
   * Watchers usually report this workspace's own writes back as external
   * changes. External events for a path written locally within this window
   * are dropped. Defaults to 500ms; set 0 to disable.
   */
  echoSuppressionMs?: number;
}

export interface WatchOptions {
  /** Only report changes at or below this path. Defaults to the whole workspace. */
  path?: string;
  /** Also report external changes via the adapter's watcher (if it has one). Defaults to `true`. */
  external?: boolean;
  /** Include changes inside the internal `.lokio` folder. Defaults to `false`. */
  includeInternal?: boolean;
}

interface LocalChangeHooks {
  /** Called before a mutation, so watcher echoes that fire synchronously are recognized. */
  expect(...paths: string[]): void;
  emit(event: Omit<ChangeEvent, "source">): void;
}

/** Emits a local `change` event for every mutation that passes through it. */
class EventingAdapter extends AdapterWrapper {
  constructor(
    inner: LokioAdapter,
    private readonly hooks: LocalChangeHooks,
  ) {
    super(inner);
    if (inner.move) {
      this.move = async (from, to) => {
        const { kind } = await inner.stat(from);
        this.hooks.expect(from, to);
        await inner.move!(from, to);
        this.hooks.emit({ type: "deleted", path: from, kind });
        this.hooks.emit({ type: "created", path: to, kind });
      };
    }
  }

  override async writeFile(path: string, data: Uint8Array): Promise<void> {
    const existed = await this.inner.exists(path);
    this.hooks.expect(path);
    await this.inner.writeFile(path, data);
    this.hooks.emit({ type: existed ? "modified" : "created", path, kind: "file" });
  }

  override async deleteFile(path: string): Promise<void> {
    this.hooks.expect(path);
    await this.inner.deleteFile(path);
    this.hooks.emit({ type: "deleted", path, kind: "file" });
  }

  override async mkdir(path: string): Promise<void> {
    const existed = await this.inner.exists(path);
    this.hooks.expect(path);
    await this.inner.mkdir(path);
    if (!existed) this.hooks.emit({ type: "created", path, kind: "directory" });
  }

  override async rmdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    this.hooks.expect(path);
    await this.inner.rmdir(path, options);
    this.hooks.emit({ type: "deleted", path, kind: "directory" });
  }
}

/** Stand-in adapter after `close()`: every operation rejects. */
const closedAdapter: LokioAdapter = new Proxy({ name: "closed" } as LokioAdapter, {
  get(target, property) {
    if (property === "name") return target.name;
    if (property === "capabilities") return undefined;
    if (
      ["move", "watch", "lock", "queryPermission", "requestPermission", "close"].includes(
        String(property),
      )
    ) {
      return undefined;
    }
    return () => Promise.reject(new WorkspaceClosedError());
  },
});

interface InstalledPlugin {
  plugin: LokioPlugin<unknown>;
  api: unknown;
}

/**
 * The application-facing entry point: a workspace is a rooted view over
 * whatever the adapter exposes (a browser directory handle, a node folder, ...).
 */
export class Workspace implements FsContext {
  readonly events = new EventBus<WorkspaceEvents>();
  /** The workspace root directory. */
  readonly root: LokioDirectory;

  private stack: LokioAdapter;
  private readonly installed = new Map<string, InstalledPlugin>();
  /** Plugins whose `wrapAdapter` is part of the stack, including ones still running `setup`. */
  private readonly wrappers: LokioPlugin<unknown>[] = [];
  private readonly pendingPlugins = new Map<string, Promise<unknown>>();
  private readonly mutex = new KeyedMutex();
  private readonly echoSuppressionMs: number;
  private readonly recentLocal = new Map<string, number>();
  private externalWatch: { stop: Promise<Unsubscribe | undefined>; refs: number } | undefined;
  private isClosed = false;

  private constructor(
    /** The runtime adapter this workspace was opened with (without plugin wrappers). */
    readonly baseAdapter: LokioAdapter,
    options: WorkspaceOptions,
  ) {
    this.echoSuppressionMs = options.echoSuppressionMs ?? 500;
    this.stack = this.compose();
    this.root = new LokioDirectory(this, "");
  }

  static async create(adapter: LokioAdapter, options: WorkspaceOptions = {}): Promise<Workspace> {
    const workspace = new Workspace(adapter, options);
    for (const plugin of options.plugins ?? []) await workspace.use(plugin);
    return workspace;
  }

  /** The current adapter stack (base adapter + plugin wrappers + event layer). */
  get adapter(): LokioAdapter {
    return this.stack;
  }

  /** Name of the underlying adapter (e.g. "node", "browser"). */
  get adapterName(): string {
    return this.baseAdapter.name;
  }

  get capabilities(): AdapterCapabilities {
    return getCapabilities(this.stack);
  }

  get closed(): boolean {
    return this.isClosed;
  }

  // ---------------------------------------------------------------- files

  /** Returns a handle to a file. Does not touch the filesystem. */
  file(path: string): LokioFile {
    return this.root.file(path);
  }

  /** Alias of `file()` kept for the API shown in ARCHITECTURE.md. */
  async open(path: string): Promise<LokioFile> {
    return this.file(path);
  }

  directory(path = ""): LokioDirectory {
    return this.root.directory(path);
  }

  /** Moves/renames a file or directory. */
  move(from: string, to: string, options?: TransferOptions): Promise<void> {
    return moveEntry(this.stack, normalizePath(from), normalizePath(to), options);
  }

  /** Copies a file or directory tree. */
  copy(from: string, to: string, options?: TransferOptions): Promise<void> {
    return copyEntry(this.stack, normalizePath(from), normalizePath(to), options);
  }

  /** Deletes a file, or a directory with everything in it. */
  remove(path: string): Promise<void> {
    return removeEntry(this.stack, normalizePath(path));
  }

  // ---------------------------------------------------------------- locks

  /**
   * Runs `fn` exclusively for `name`. Always exclusive within this JS realm;
   * also across tabs/processes when `capabilities.crossProcessLocks` is true.
   */
  lock<T>(name: string, fn: () => Promise<T>, options?: { timeoutMs?: number }): Promise<T> {
    return this.mutex.run(name, () => {
      const adapter = this.stack;
      return adapter.lock ? adapter.lock(name, fn, options) : fn();
    });
  }

  // ---------------------------------------------------------- permissions

  async queryPermission(mode: PermissionMode = "readwrite"): Promise<PermissionState> {
    return this.stack.queryPermission ? this.stack.queryPermission(mode) : "granted";
  }

  /** Prompts only when needed. In browsers this must be called from a user gesture. */
  async requestPermission(mode: PermissionMode = "readwrite"): Promise<PermissionState> {
    return this.stack.requestPermission ? this.stack.requestPermission(mode) : "granted";
  }

  // --------------------------------------------------------------- events

  /**
   * Subscribes to changes. Local changes are always reported; external ones
   * too when the adapter can watch (see `capabilities.watch`).
   */
  watch(listener: (event: ChangeEvent) => void, options: WatchOptions = {}): Unsubscribe {
    const scope = normalizePath(options.path ?? "");
    const off = this.events.on("change", (event) => {
      if (!isWithin(scope, event.path)) return;
      if (event.source === "external" && options.external === false) return;
      if (!options.includeInternal && isInternalPath(event.path)) return;
      listener(event);
    });
    const release = options.external === false ? () => {} : this.retainExternalWatch();
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      off();
      release();
    };
  }

  /**
   * Remembers paths about to be changed locally - plus their ancestors, which
   * writes create implicitly - so the watcher's echo can be dropped.
   */
  private expectLocal(...paths: string[]): void {
    if (this.echoSuppressionMs <= 0) return;
    const now = Date.now();
    for (const path of paths) {
      for (let p = path; p !== ""; p = dirname(p)) this.recentLocal.set(p, now);
    }
    if (this.recentLocal.size > 1000) this.pruneRecentLocal(now);
  }

  private pruneRecentLocal(now: number): void {
    for (const [path, time] of this.recentLocal) {
      if (now - time >= this.echoSuppressionMs) this.recentLocal.delete(path);
    }
  }

  private emitLocal(event: Omit<ChangeEvent, "source">): void {
    if (this.echoSuppressionMs > 0) this.recentLocal.set(event.path, Date.now());
    this.events.emit("change", { ...event, source: "local" });
  }

  private emitExternal(event: WatchEvent): void {
    const path = normalizePath(event.path);
    const local = this.recentLocal.get(path);
    if (local !== undefined) {
      if (Date.now() - local < this.echoSuppressionMs) return;
      this.recentLocal.delete(path);
    }
    this.events.emit("change", { ...event, path, source: "external" });
  }

  /** Starts the adapter watcher on first use and stops it when the last watcher unsubscribes. */
  private retainExternalWatch(): () => void {
    const watchFn = this.baseAdapter.watch?.bind(this.baseAdapter);
    if (!watchFn) return () => {};
    if (!this.externalWatch) {
      // .then() also captures a synchronous throw from watchFn.
      const stop = Promise.resolve()
        .then(() => watchFn("", (event) => this.emitExternal(event)))
        .catch((error: unknown) => {
          this.reportError(error);
          return undefined;
        });
      this.externalWatch = { stop, refs: 0 };
    }
    const current = this.externalWatch;
    current.refs += 1;
    return () => {
      current.refs -= 1;
      if (current.refs === 0 && this.externalWatch === current) {
        this.externalWatch = undefined;
        void current.stop.then((stop) => stop?.());
      }
    };
  }

  // -------------------------------------------------------------- plugins

  /**
   * Installs a plugin once and resolves to its API. Concurrent calls share one
   * setup; if setup fails the plugin is removed again and can be retried.
   */
  async use<Api>(plugin: LokioPlugin<Api>): Promise<Api> {
    this.assertOpen();
    const existing = this.installed.get(plugin.name);
    if (existing) return existing.api as Api;

    let pending = this.pendingPlugins.get(plugin.name);
    if (!pending) {
      // Settle bookkeeping via .finally() so it also runs after the promise is
      // stored - a synchronously throwing setup() must not leave a stale entry.
      pending = Promise.resolve()
        .then(async () => {
          if (plugin.wrapAdapter) {
            this.wrappers.push(plugin as LokioPlugin<unknown>);
            this.stack = this.compose();
          }
          try {
            const api = await plugin.setup?.(this);
            this.installed.set(plugin.name, { plugin: plugin as LokioPlugin<unknown>, api });
            this.events.emit("plugin:setup", plugin.name);
            return api;
          } catch (error) {
            this.removeWrapper(plugin as LokioPlugin<unknown>);
            throw error;
          }
        })
        .finally(() => this.pendingPlugins.delete(plugin.name));
      this.pendingPlugins.set(plugin.name, pending);
    }
    return (await pending) as Api;
  }

  /** Disposes and removes a plugin (including its adapter wrapper). */
  async unuse(name: string): Promise<boolean> {
    const entry = this.installed.get(name);
    if (!entry) return false;
    this.installed.delete(name);
    this.removeWrapper(entry.plugin);
    await entry.plugin.dispose?.();
    this.events.emit("plugin:dispose", name);
    return true;
  }

  plugin(name: string): LokioPlugin<unknown> | undefined {
    return this.installed.get(name)?.plugin;
  }

  /** The API returned by an installed plugin's `setup`. */
  pluginApi<Api>(plugin: LokioPlugin<Api> | string): Api | undefined {
    const name = typeof plugin === "string" ? plugin : plugin.name;
    return this.installed.get(name)?.api as Api | undefined;
  }

  // ------------------------------------------------------------ lifecycle

  /** Disposes plugins (in reverse order), stops watchers and closes the adapter. Idempotent. */
  async close(): Promise<void> {
    if (this.isClosed) return;
    this.isClosed = true;
    if (this.externalWatch) {
      const { stop } = this.externalWatch;
      this.externalWatch = undefined;
      (await stop)?.();
    }
    for (const name of [...this.installed.keys()].reverse()) await this.unuse(name);
    await this.baseAdapter.close?.();
    this.stack = closedAdapter;
    this.events.emit("close");
  }

  /** Background errors must not crash the app: emit them, or warn if nobody listens. */
  private reportError(error: unknown): void {
    if (this.events.listenerCount("error") > 0) this.events.emit("error", error);
    else console.warn("[lokio] background error:", error);
  }

  private assertOpen(): void {
    if (this.isClosed) throw new WorkspaceClosedError();
  }

  private removeWrapper(plugin: LokioPlugin<unknown>): void {
    const index = this.wrappers.indexOf(plugin);
    if (index === -1) return;
    this.wrappers.splice(index, 1);
    if (!this.isClosed) this.stack = this.compose();
  }

  private compose(): LokioAdapter {
    const wrapped = this.wrappers.reduce<LokioAdapter>(
      (adapter, plugin) => plugin.wrapAdapter!(adapter),
      this.baseAdapter,
    );
    return new EventingAdapter(wrapped, {
      expect: (...paths) => this.expectLocal(...paths),
      emit: (event) => this.emitLocal(event),
    });
  }
}
