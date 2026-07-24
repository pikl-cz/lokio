export * from "./adapter.js";
export * from "./errors.js";
export * from "./events.js";
export * from "./file.js";
export * from "./directory.js";
export * from "./plugin.js";
export * from "./workspace.js";

import type { LokioAdapter } from "./adapter.js";
import { Workspace } from "./workspace.js";

/**
 * Convenience entry point:
 *
 * ```ts
 * const workspace = await Lokio.openWorkspace(new NodeAdapter({ root: "./data" }));
 * ```
 */
export const Lokio = {
  openWorkspace(adapter: LokioAdapter): Promise<Workspace> {
    return Workspace.create(adapter);
  },
};
