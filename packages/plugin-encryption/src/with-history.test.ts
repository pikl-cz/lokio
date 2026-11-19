import { Lokio } from "@lokio/core";
import { history } from "@lokio/plugin-history";
import { MemoryAdapter } from "@lokio/testing";
import { describe, expect, it } from "vitest";
import { encryption } from "./index.js";

const plugins = {
  "encryption first": () => [encryption({ passphrase: "p" }, { iterations: 1000 }), history()],
  "history first": () => [history(), encryption({ passphrase: "p" }, { iterations: 1000 })],
};

describe.each(Object.entries(plugins))("with plugin-history (%s)", (_, make) => {
  it("stores snapshots encrypted and reads them back decrypted", async () => {
    const adapter = new MemoryAdapter();
    const workspace = await Lokio.openWorkspace({ adapter, plugins: make() });
    const versions = workspace.pluginApi(history())!;
    await workspace.file("a.md").write("first secret");
    await workspace.file("a.md").write("second");

    const [version] = await versions.versions("a.md");
    expect(await versions.readText("a.md", version!.id)).toBe("first secret");
    const raw = await adapter.readFile(`.lokio/history/a.md.history/${version!.id}`);
    expect(new TextDecoder().decode(raw.slice(0, 4))).toBe("LKE1");
    expect(new TextDecoder().decode(raw)).not.toContain("first secret");

    await versions.restore("a.md", version!.id);
    expect(await workspace.file("a.md").readText()).toBe("first secret");
  });
});
