import type { Awaitable } from "@lokio/types";
import type { LokioAdapter } from "./adapter.js";
import type { Workspace } from "./workspace.js";

/**
 * Every feature beyond the core file/directory API should be a plugin.
 *
 * A plugin can:
 * - decorate the adapter (`wrapAdapter`) to transform or observe I/O - e.g.
 *   encryption, history snapshots. Wrappers are applied in `use()` order;
 *   the last one used is the outermost.
 * - run `setup` and return a typed API, which `workspace.use()` resolves to.
 * - clean up in `dispose` (called by `workspace.unuse()` / `workspace.close()`).
 */
export interface LokioPlugin<Api = void> {
  readonly name: string;
  wrapAdapter?(adapter: LokioAdapter): LokioAdapter;
  setup?(workspace: Workspace): Awaitable<Api>;
  dispose?(): Awaitable<void>;
}

/** Extracts the API type a plugin's `setup` resolves to. */
export type PluginApi<P> = P extends LokioPlugin<infer Api> ? Api : never;

/** Identity helper that gives plugin authors type inference for the API. */
export function definePlugin<Api = void>(plugin: LokioPlugin<Api>): LokioPlugin<Api> {
  return plugin;
}
