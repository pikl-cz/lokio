import type { Workspace } from "./workspace.js";

/**
 * Every feature beyond the core file/directory API should be a plugin.
 */
export interface LokioPlugin {
  readonly name: string;
  setup(workspace: Workspace): void | Promise<void>;
}
