import { BrowserAdapter, saveHandle } from "@lokio/browser";
import { LokioError, NotSupportedError, PermissionDeniedError, Workspace } from "@lokio/core";
import type { AutoOpenOptions } from "./options.js";

export type { AutoOpenOptions } from "./options.js";

async function resolveAdapter(options: AutoOpenOptions): Promise<BrowserAdapter> {
  const key = options.persistKey ?? "default";
  const mode = options.mode ?? "readwrite";
  const supported = BrowserAdapter.isSupported();

  const restored = supported ? await BrowserAdapter.restore(key, { mode }).catch(() => null) : null;
  if (restored) {
    let state = await restored.queryPermission(mode);
    if (state === "prompt" && options.requestPermission)
      state = await restored.requestPermission(mode);
    if (state === "granted") return restored;
  }

  if (options.pick && supported) {
    const picked = await BrowserAdapter.pick({
      mode,
      ...(options.pickerId ? { id: options.pickerId } : {}),
    });
    // Best effort: failing to remember the folder (e.g. IndexedDB blocked in a
    // private window) must not throw away the folder the user just picked.
    await saveHandle(key, picked.root).catch(() => undefined);
    return picked;
  }

  if (options.fallback === "opfs") return BrowserAdapter.opfs();

  if (restored) {
    throw new PermissionDeniedError(
      `${restored.root.name} (permission must be granted again: call openWorkspace({ requestPermission: true }) from a user gesture)`,
    );
  }
  if (!supported) {
    throw new NotSupportedError(
      'File System Access API - pass { fallback: "opfs" } to use the Origin Private File System instead',
    );
  }
  throw new LokioError(
    "No folder has been chosen yet - call openWorkspace({ pick: true }) from a user gesture",
    { code: "NOT_FOUND" },
  );
}

/**
 * Browser build of `openWorkspace`. Tries, in order: the folder persisted under
 * `persistKey` (if permission is granted, or granted after `requestPermission`),
 * the directory picker (`pick: true`), the OPFS (`fallback: "opfs"`).
 */
export async function openWorkspace(options: AutoOpenOptions = {}): Promise<Workspace> {
  const adapter = await resolveAdapter(options);
  const { plugins, echoSuppressionMs } = options;
  return Workspace.create(adapter, { plugins, echoSuppressionMs });
}
