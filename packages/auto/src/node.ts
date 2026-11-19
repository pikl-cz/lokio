import { Workspace } from "@lokio/core";
import { NodeAdapter } from "@lokio/node";
import type { AutoOpenOptions } from "./options.js";

export type { AutoOpenOptions } from "./options.js";

/** Node build of `openWorkspace`: a `NodeAdapter` rooted at `options.root` or the current directory. */
export async function openWorkspace(options: AutoOpenOptions = {}): Promise<Workspace> {
  const { root, plugins, echoSuppressionMs } = options;
  const adapter = new NodeAdapter({ root: root ?? process.cwd() });
  await adapter.mkdir("");
  return Workspace.create(adapter, { plugins, echoSuppressionMs });
}
