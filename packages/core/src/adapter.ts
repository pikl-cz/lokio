import type { EntryStat, PermissionMode, PermissionState } from "@lokio/types";

/**
 * The contract every runtime adapter (browser, node, ...) must implement.
 * Applications never talk to a runtime API directly - only through this interface.
 */
export interface LokioAdapter {
  readonly name: string;

  exists(path: string): Promise<boolean>;
  stat(path: string): Promise<EntryStat>;

  readFile(path: string): Promise<Uint8Array>;
  writeFile(path: string, data: Uint8Array | string): Promise<void>;
  deleteFile(path: string): Promise<void>;

  readDir(path: string): Promise<string[]>;
  mkdir(path: string): Promise<void>;
  rmdir(path: string, options?: { recursive?: boolean }): Promise<void>;

  /** Optional: not every runtime has a permission model (e.g. Node has none). */
  requestPermission?(mode: PermissionMode): Promise<PermissionState>;
}
