import type { LokioAdapter } from "./adapter.js";
import { LokioDirectory } from "./directory.js";
import type { LokioFile } from "./file.js";
import { EventBus, type EventMap } from "./events.js";
import type { LokioPlugin } from "./plugin.js";

export interface WorkspaceEvents extends EventMap {
  "plugin:setup": [name: string];
}

/**
 * The application-facing entry point: a workspace is a rooted view over
 * whatever the adapter exposes (a browser directory handle, a node folder, ...).
 */
export class Workspace {
  readonly events = new EventBus<WorkspaceEvents>();

  private readonly plugins = new Map<string, LokioPlugin>();
  private readonly root: LokioDirectory;

  private constructor(private readonly adapter: LokioAdapter) {
    this.root = new LokioDirectory(adapter, "");
  }

  static async create(adapter: LokioAdapter): Promise<Workspace> {
    return new Workspace(adapter);
  }

  get name(): string {
    return this.adapter.name;
  }

  open(path: string): Promise<LokioFile> {
    return Promise.resolve(this.root.file(path));
  }

  directory(path = ""): LokioDirectory {
    return this.root.directory(path);
  }

  async use(plugin: LokioPlugin): Promise<this> {
    if (this.plugins.has(plugin.name)) {
      return this;
    }
    this.plugins.set(plugin.name, plugin);
    await plugin.setup(this);
    this.events.emit("plugin:setup", plugin.name);
    return this;
  }

  plugin(name: string): LokioPlugin | undefined {
    return this.plugins.get(name);
  }
}
