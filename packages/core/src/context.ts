import type { LokioAdapter } from "./adapter.js";
import { KeyedMutex } from "./lock.js";

/**
 * What files and directories need from their owner. A `Workspace` provides
 * one whose `adapter` always points at the current adapter stack (so plugins
 * added later apply to handles created earlier).
 */
export interface FsContext {
  readonly adapter: LokioAdapter;
  lock?<T>(name: string, fn: () => Promise<T>): Promise<T>;
}

const fallbackMutex = new KeyedMutex();

export function withLock<T>(context: FsContext, name: string, fn: () => Promise<T>): Promise<T> {
  return context.lock ? context.lock(name, fn) : fallbackMutex.run(name, fn);
}

/** Wraps a bare adapter into a context, for using `LokioFile`/`LokioDirectory` without a workspace. */
export function toContext(adapterOrContext: LokioAdapter | FsContext): FsContext {
  return "adapter" in adapterOrContext && typeof adapterOrContext.adapter === "object"
    ? (adapterOrContext as FsContext)
    : { adapter: adapterOrContext as LokioAdapter };
}
