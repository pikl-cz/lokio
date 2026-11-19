export type * from "@lokio/types";
export * from "./adapter.js";
export * from "./context.js";
export * from "./directory.js";
export * from "./errors.js";
export * from "./events.js";
export * from "./file.js";
export * from "./lock.js";
export * from "./ops.js";
export * from "./path.js";
export * from "./plugin.js";
export * from "./workspace.js";

import type { LokioAdapter } from "./adapter.js";
import { Workspace, type WorkspaceOptions } from "./workspace.js";

export interface OpenWorkspaceOptions extends WorkspaceOptions {
  adapter: LokioAdapter;
}

/**
 * Convenience entry point:
 *
 * ```ts
 * const workspace = await Lokio.openWorkspace(new NodeAdapter({ root: "./data" }));
 * const workspace = await Lokio.openWorkspace({ adapter, plugins: [history()] });
 * ```
 *
 * For automatic runtime detection use `openWorkspace()` from `@lokio/auto`.
 */
export const Lokio = {
  openWorkspace(adapterOrOptions: LokioAdapter | OpenWorkspaceOptions): Promise<Workspace> {
    if ("adapter" in adapterOrOptions && !("readFile" in adapterOrOptions)) {
      const { adapter, ...options } = adapterOrOptions;
      return Workspace.create(adapter, options);
    }
    return Workspace.create(adapterOrOptions as LokioAdapter);
  },
};
