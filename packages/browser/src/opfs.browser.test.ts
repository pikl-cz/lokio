import { describeAdapterConformance } from "@lokio/testing/conformance";
import { describe, expect, it } from "vitest";
import { BrowserAdapter } from "./adapter.js";

/** Each test gets its own folder inside the (shared) Origin Private File System. */
async function freshAdapter(): Promise<BrowserAdapter> {
  const opfs = await navigator.storage.getDirectory();
  const dir = await opfs.getDirectoryHandle(`lokio-test-${crypto.randomUUID()}`, { create: true });
  return BrowserAdapter.fromHandle(dir);
}

async function cleanup(adapter: BrowserAdapter): Promise<void> {
  await adapter.close();
  const opfs = await navigator.storage.getDirectory();
  await opfs.removeEntry(adapter.root.name, { recursive: true });
}

describeAdapterConformance("BrowserAdapter (real OPFS)", freshAdapter, {
  cleanup: (adapter) => cleanup(adapter as BrowserAdapter),
});

describe("BrowserAdapter in a real browser", () => {
  it("opens the OPFS root and reports capabilities", async () => {
    const adapter = await BrowserAdapter.opfs();
    expect(adapter.root.kind).toBe("directory");
    expect(await adapter.queryPermission()).toBe("granted");
    expect(adapter.lock).toBeTypeOf("function");
  });
});
