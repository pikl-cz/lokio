/**
 * An in-memory fake of the File System Access API, for testing browser code
 * (e.g. `BrowserAdapter`) in Node or jsdom.
 *
 * ```ts
 * import { createFakeFileSystem } from "@lokio/testing/fs-access";
 *
 * const fs = createFakeFileSystem();
 * const adapter = BrowserAdapter.fromHandle(fs.root);
 * fs.setPermission("readwrite", "prompt"); // simulate a revoked permission
 * ```
 *
 * Mirrors browser behaviour where it matters: DOMException names
 * (`NotFoundError`, `TypeMismatchError`, `InvalidModificationError`,
 * `NotAllowedError`), swap-file writes (content is replaced only on
 * `close()`, `abort()` discards it), permission checks, `move()` and a
 * `FileSystemObserver` implementation.
 */

type Mode = "read" | "readwrite";
type State = "granted" | "denied" | "prompt";

export interface FakeFileSystemOptions {
  /** Name of the root directory handle. Defaults to `"root"`. */
  name?: string;
  /** Initial permission state for both modes. Defaults to `"granted"`. */
  permission?: State;
  /** What `requestPermission()` resolves to. Defaults to `"granted"` (the user clicks "Allow"). */
  requestResult?: State;
  /** Expose `handle.move()`. Defaults to `true`. */
  supportsMove?: boolean;
  /** Clock used for `lastModified`. */
  now?: () => number;
}

export type FakeObserverRecordType =
  | "appeared"
  | "disappeared"
  | "modified"
  | "moved"
  | "unknown"
  | "errored";

export interface FakeObserverRecord {
  type: FakeObserverRecordType;
  root: FileSystemHandle;
  changedHandle: FileSystemHandle;
  relativePathComponents: string[];
  relativePathMovedFrom?: string[];
}

export interface FakeFileSystem {
  root: FileSystemDirectoryHandle;
  /** Changes the permission state, as if the user revoked/granted access. */
  setPermission(mode: Mode, state: State): void;
  /** Sets what the next `requestPermission()` calls resolve to. */
  setRequestResult(state: State): void;
  /** Makes the next `write()` on a writable stream reject with a DOMException of this name. */
  failNextWrite(name?: string): void;
  /** A `FileSystemObserver` implementation bound to this file system. */
  Observer: new (
    callback: (records: FakeObserverRecord[], observer: unknown) => void,
  ) => {
    observe(handle: FileSystemHandle, options?: { recursive?: boolean }): Promise<void>;
    unobserve(handle: FileSystemHandle): void;
    disconnect(): void;
  };
  /** Number of currently open (not yet closed/aborted) writable streams. */
  readonly openWritables: number;
}

const domError = (name: string, message: string) => new DOMException(message, name);

interface FileNode {
  kind: "file";
  name: string;
  parent: DirNode | null;
  data: Uint8Array;
  lastModified: number;
}

interface DirNode {
  kind: "directory";
  name: string;
  parent: DirNode | null;
  children: Map<string, Node>;
}

type Node = FileNode | DirNode;

/** Ancestor chain of a moved entry before the move, with the names at that time. */
interface MovedFrom {
  nodes: Node[];
  names: string[];
}

function assertValidName(name: string): void {
  if (name === "" || name === "." || name === ".." || /[/\\]/.test(name)) {
    throw new TypeError(`Name is not allowed: ${JSON.stringify(name)}`);
  }
}

function pathOf(node: Node): Node[] {
  const chain: Node[] = [];
  for (let current: Node | null = node; current; current = current.parent) chain.unshift(current);
  return chain;
}

function toBytes(data: unknown): Promise<Uint8Array> | Uint8Array {
  if (typeof data === "string") return new TextEncoder().encode(data);
  if (data instanceof Uint8Array) return data.slice();
  if (data instanceof ArrayBuffer) return new Uint8Array(data.slice(0));
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
  }
  if (data instanceof Blob) return data.arrayBuffer().then((buffer) => new Uint8Array(buffer));
  throw new TypeError("Unsupported data type for write()");
}

export function createFakeFileSystem(options: FakeFileSystemOptions = {}): FakeFileSystem {
  const now = options.now ?? Date.now;
  const permissions: Record<Mode, State> = {
    read: options.permission ?? "granted",
    readwrite: options.permission ?? "granted",
  };
  let requestResult: State = options.requestResult ?? "granted";
  let failWrite: string | undefined;
  let openWritables = 0;
  const rootNode: DirNode = {
    kind: "directory",
    name: options.name ?? "root",
    parent: null,
    children: new Map(),
  };
  const observers = new Set<FakeObserver>();

  const isAttached = (node: Node) => pathOf(node)[0] === rootNode;

  const requireAttached = (node: Node) => {
    if (!isAttached(node)) throw domError("NotFoundError", `"${node.name}" no longer exists`);
  };

  const requirePermission = (mode: Mode) => {
    const granted =
      permissions.readwrite === "granted" || (mode === "read" && permissions.read === "granted");
    if (!granted) throw domError("NotAllowedError", `Permission "${mode}" not granted`);
  };

  const notify = (type: FakeObserverRecordType, node: Node, movedFrom?: MovedFrom) => {
    const chain = pathOf(node);
    for (const observer of observers) observer.deliver(type, node, chain, movedFrom);
  };

  // ------------------------------------------------------------- handles

  class FakeHandle {
    constructor(readonly node: Node) {}

    get kind(): Node["kind"] {
      return this.node.kind;
    }

    get name(): string {
      return this.node.name;
    }

    async isSameEntry(other: FileSystemHandle): Promise<boolean> {
      return other instanceof FakeHandle && other.node === this.node;
    }

    async queryPermission(descriptor?: { mode?: Mode }): Promise<State> {
      const mode = descriptor?.mode ?? "read";
      if (mode === "read" && permissions.readwrite === "granted") return "granted";
      return permissions[mode];
    }

    async requestPermission(descriptor?: { mode?: Mode }): Promise<State> {
      const mode = descriptor?.mode ?? "read";
      const current = await this.queryPermission({ mode });
      if (current !== "prompt") return current;
      permissions[mode] = requestResult;
      if (mode === "readwrite" && requestResult === "granted") permissions.read = "granted";
      return requestResult;
    }

    async move(
      destinationOrName: FileSystemDirectoryHandle | string,
      maybeName?: string,
    ): Promise<void> {
      requirePermission("readwrite");
      requireAttached(this.node);
      const destination =
        typeof destinationOrName === "string"
          ? this.node.parent
          : (destinationOrName as unknown as FakeHandle).node;
      const name =
        typeof destinationOrName === "string" ? destinationOrName : (maybeName ?? this.node.name);
      assertValidName(name);
      if (destination?.kind !== "directory") {
        throw domError("InvalidModificationError", "Cannot move the root");
      }
      requireAttached(destination);
      if (pathOf(destination).includes(this.node)) {
        throw domError("InvalidModificationError", "Cannot move an entry into itself");
      }
      const existing = destination.children.get(name);
      if (existing && existing !== this.node) {
        if (existing.kind === "directory" || this.node.kind === "directory") {
          throw domError("InvalidModificationError", `"${name}" already exists`);
        }
      }
      const fromNodes = pathOf(this.node);
      const from: MovedFrom = { nodes: fromNodes, names: fromNodes.map((n) => n.name) };
      this.node.parent!.children.delete(this.node.name);
      this.node.name = name;
      this.node.parent = destination;
      destination.children.set(name, this.node);
      notify("moved", this.node, from);
    }
  }

  class FakeWritable {
    private buffer: Uint8Array;
    private position = 0;
    private state: "open" | "closed" = "open";

    constructor(
      private readonly node: FileNode,
      keepExistingData: boolean,
    ) {
      this.buffer = keepExistingData ? node.data.slice() : new Uint8Array();
      openWritables += 1;
    }

    private assertOpen() {
      if (this.state !== "open") throw new TypeError("The stream is closed");
    }

    async write(chunk: unknown): Promise<void> {
      this.assertOpen();
      if (failWrite) {
        const name = failWrite;
        failWrite = undefined;
        throw domError(name, "Simulated write failure");
      }
      if (
        typeof chunk === "object" &&
        chunk !== null &&
        "type" in chunk &&
        !(chunk instanceof Blob)
      ) {
        const params = chunk as { type: string; position?: number; size?: number; data?: unknown };
        if (params.type === "seek") {
          this.position = params.position ?? 0;
          return;
        }
        if (params.type === "truncate") {
          this.resize(params.size ?? 0);
          this.buffer = this.buffer.slice(0, params.size ?? 0);
          this.position = Math.min(this.position, this.buffer.length);
          return;
        }
        if (params.position !== undefined) this.position = params.position;
        chunk = params.data;
      }
      const bytes = await toBytes(chunk);
      this.resize(this.position + bytes.length);
      this.buffer.set(bytes, this.position);
      this.position += bytes.length;
    }

    async seek(position: number): Promise<void> {
      await this.write({ type: "seek", position });
    }

    async truncate(size: number): Promise<void> {
      await this.write({ type: "truncate", size });
    }

    async close(): Promise<void> {
      this.assertOpen();
      this.state = "closed";
      openWritables -= 1;
      requireAttached(this.node);
      this.node.data = this.buffer;
      this.node.lastModified = now();
      notify("modified", this.node);
    }

    async abort(): Promise<void> {
      if (this.state !== "open") return;
      this.state = "closed";
      openWritables -= 1;
    }

    private resize(size: number) {
      if (size <= this.buffer.length) return;
      const next = new Uint8Array(size);
      next.set(this.buffer);
      this.buffer = next;
    }
  }

  class FakeFileHandle extends FakeHandle {
    declare readonly node: FileNode;

    async getFile(): Promise<File> {
      requirePermission("read");
      requireAttached(this.node);
      return new File([this.node.data.slice()], this.node.name, {
        lastModified: this.node.lastModified,
      });
    }

    async createWritable(options?: { keepExistingData?: boolean }): Promise<FakeWritable> {
      requirePermission("readwrite");
      requireAttached(this.node);
      return new FakeWritable(this.node, Boolean(options?.keepExistingData));
    }
  }

  class FakeDirectoryHandle extends FakeHandle {
    declare readonly node: DirNode;

    async getFileHandle(name: string, options?: { create?: boolean }): Promise<FakeFileHandle> {
      return this.getChild(name, "file", options?.create) as Promise<FakeFileHandle>;
    }

    async getDirectoryHandle(
      name: string,
      options?: { create?: boolean },
    ): Promise<FakeDirectoryHandle> {
      return this.getChild(name, "directory", options?.create) as Promise<FakeDirectoryHandle>;
    }

    async removeEntry(name: string, options?: { recursive?: boolean }): Promise<void> {
      assertValidName(name);
      requirePermission("readwrite");
      requireAttached(this.node);
      const child = this.node.children.get(name);
      if (!child) throw domError("NotFoundError", `"${name}" not found`);
      if (child.kind === "directory" && child.children.size > 0 && !options?.recursive) {
        throw domError("InvalidModificationError", `"${name}" is not empty`);
      }
      this.node.children.delete(name);
      notify("disappeared", { ...child, parent: this.node } as Node);
      child.parent = null;
    }

    async resolve(possibleDescendant: FileSystemHandle): Promise<string[] | null> {
      if (!(possibleDescendant instanceof FakeHandle)) return null;
      const chain = pathOf(possibleDescendant.node);
      const index = chain.indexOf(this.node);
      return index === -1 ? null : chain.slice(index + 1).map((node) => node.name);
    }

    async *entries(): AsyncGenerator<[string, FakeHandle]> {
      requirePermission("read");
      requireAttached(this.node);
      for (const [name, child] of [...this.node.children]) yield [name, wrap(child)];
    }

    async *keys(): AsyncGenerator<string> {
      for await (const [name] of this.entries()) yield name;
    }

    async *values(): AsyncGenerator<FakeHandle> {
      for await (const [, handle] of this.entries()) yield handle;
    }

    [Symbol.asyncIterator]() {
      return this.entries();
    }

    private async getChild(name: string, kind: Node["kind"], create = false): Promise<FakeHandle> {
      assertValidName(name);
      requirePermission(create ? "readwrite" : "read");
      requireAttached(this.node);
      const existing = this.node.children.get(name);
      if (existing) {
        if (existing.kind !== kind) {
          throw domError("TypeMismatchError", `"${name}" is a ${existing.kind}, not a ${kind}`);
        }
        return wrap(existing);
      }
      if (!create) throw domError("NotFoundError", `"${name}" not found`);
      const node: Node =
        kind === "file"
          ? { kind, name, parent: this.node, data: new Uint8Array(), lastModified: now() }
          : { kind, name, parent: this.node, children: new Map() };
      this.node.children.set(name, node);
      notify("appeared", node);
      return wrap(node);
    }
  }

  function wrap(node: Node): FakeHandle {
    return node.kind === "file" ? new FakeFileHandle(node) : new FakeDirectoryHandle(node);
  }

  if (options.supportsMove === false) {
    Object.defineProperty(FakeHandle.prototype, "move", { value: undefined });
  }

  // ------------------------------------------------------------ observer

  class FakeObserver {
    private readonly roots = new Map<
      DirNode | FileNode,
      { handle: FakeHandle; recursive: boolean }
    >();

    constructor(
      private readonly callback: (records: FakeObserverRecord[], observer: unknown) => void,
    ) {}

    async observe(handle: FileSystemHandle, opts?: { recursive?: boolean }): Promise<void> {
      if (!(handle instanceof FakeHandle)) throw new TypeError("Not a fake handle");
      this.roots.set(handle.node, { handle, recursive: Boolean(opts?.recursive) });
      observers.add(this);
    }

    unobserve(handle: FileSystemHandle): void {
      if (handle instanceof FakeHandle) this.roots.delete(handle.node);
      if (this.roots.size === 0) observers.delete(this);
    }

    disconnect(): void {
      this.roots.clear();
      observers.delete(this);
    }

    deliver(type: FakeObserverRecordType, node: Node, chain: Node[], movedFrom?: MovedFrom): void {
      for (const [rootNodeObserved, { handle, recursive }] of this.roots) {
        const index = chain.indexOf(rootNodeObserved);
        if (index === -1) continue;
        const relative = chain.slice(index + 1).map((n) => n.name);
        if (!recursive && relative.length > 1) continue;
        const fromIndex = movedFrom?.nodes.indexOf(rootNodeObserved) ?? -1;
        const record: FakeObserverRecord = {
          type,
          root: handle as unknown as FileSystemHandle,
          changedHandle: wrap(node) as unknown as FileSystemHandle,
          relativePathComponents: relative,
          ...(movedFrom && fromIndex !== -1
            ? { relativePathMovedFrom: movedFrom.names.slice(fromIndex + 1) }
            : {}),
        };
        queueMicrotask(() => this.callback([record], this));
      }
    }
  }

  return {
    root: wrap(rootNode) as unknown as FileSystemDirectoryHandle,
    setPermission(mode, state) {
      permissions[mode] = state;
    },
    setRequestResult(state) {
      requestResult = state;
    },
    failNextWrite(name = "QuotaExceededError") {
      failWrite = name;
    },
    Observer: FakeObserver,
    get openWritables() {
      return openWritables;
    },
  };
}

/** Shorthand for `createFakeFileSystem(options).root`. */
export function createFakeDirectoryHandle(
  name = "root",
  options: Omit<FakeFileSystemOptions, "name"> = {},
): FileSystemDirectoryHandle {
  return createFakeFileSystem({ ...options, name }).root;
}
