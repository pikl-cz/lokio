import type { PermissionMode, Workspace, WorkspaceOptions } from "@lokio/core";

export interface AutoOpenOptions extends WorkspaceOptions {
  /** Node: workspace root directory. Defaults to `process.cwd()`. */
  root?: string;
  /** Browser: IndexedDB key the picked folder is persisted under. Defaults to `"default"`. */
  persistKey?: string;
  /** Browser: permission mode to check/request. Defaults to `"readwrite"`. */
  mode?: PermissionMode;
  /**
   * Browser: if the saved folder needs permission again, ask for it.
   * Must be called from a user gesture (e.g. a click handler).
   */
  requestPermission?: boolean;
  /** Browser: if no usable folder is saved, show the directory picker. Requires a user gesture. */
  pick?: boolean;
  /** Browser: `id` passed to `showDirectoryPicker` so it remembers the last location. */
  pickerId?: string;
  /**
   * Browser: what to use when no folder is available (nothing saved, permission
   * not granted, File System Access API unsupported). `"opfs"` uses the
   * Origin Private File System. Defaults to `"none"` (throw).
   */
  fallback?: "opfs" | "none";
}

export type OpenWorkspace = (options?: AutoOpenOptions) => Promise<Workspace>;
