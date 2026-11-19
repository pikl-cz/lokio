/**
 * Type entry point shared by the runtime-specific builds. Bundlers and Node
 * pick `browser.js` or `node.js` through conditional exports.
 */
import type { Workspace } from "@lokio/core";
import type { AutoOpenOptions } from "./options.js";

export type { AutoOpenOptions } from "./options.js";

/**
 * Opens a workspace with the adapter that fits the current runtime:
 * - Node: `NodeAdapter` rooted at `options.root` (default `process.cwd()`).
 * - Browser: the folder persisted under `options.persistKey`, the directory
 *   picker (`pick: true`) or the OPFS (`fallback: "opfs"`).
 */
export declare function openWorkspace(options?: AutoOpenOptions): Promise<Workspace>;
