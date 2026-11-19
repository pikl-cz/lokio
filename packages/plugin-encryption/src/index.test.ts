import { isLokioError, Lokio, type Workspace } from "@lokio/core";
import { MemoryAdapter } from "@lokio/testing";
import { describe, expect, it } from "vitest";
import {
  DecryptionError,
  ENCRYPTION_METADATA_PATH,
  ENCRYPTION_OVERHEAD,
  type EncryptionOptions,
  type EncryptionSecret,
  encryption,
} from "./index.js";

const ITERATIONS = 1_000;
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

async function open(
  adapter: MemoryAdapter,
  secret: EncryptionSecret = { passphrase: "correct horse" },
  options: EncryptionOptions = {},
) {
  const workspace: Workspace = await Lokio.openWorkspace(adapter);
  const api = await workspace.use(encryption(secret, { iterations: ITERATIONS, ...options }));
  return { workspace, api };
}

const codeOf = (promise: Promise<unknown>) =>
  promise.then(
    () => "resolved",
    (error: unknown) => (isLokioError(error) ? error.code : String(error)),
  );

describe("encryption plugin", () => {
  it("round-trips content and stores ciphertext with the LKE1 header", async () => {
    const adapter = new MemoryAdapter();
    const { workspace } = await open(adapter);
    await workspace.file("diary/secret.md").write("my secret dream");

    expect(await workspace.file("diary/secret.md").readText()).toBe("my secret dream");
    const raw = await adapter.readFile("diary/secret.md");
    expect(decode(raw.slice(0, 4))).toBe("LKE1");
    expect(decode(raw)).not.toContain("secret dream");
    // File names are not encrypted.
    expect(await adapter.exists("diary/secret.md")).toBe(true);
    // stat reports the on-disk size.
    expect((await workspace.file("diary/secret.md").stat()).size).toBe(15 + ENCRYPTION_OVERHEAD);
  });

  it("uses a fresh IV for every write", async () => {
    const adapter = new MemoryAdapter();
    const { workspace } = await open(adapter);
    await workspace.file("a.md").write("same");
    const first = await adapter.readFile("a.md");
    await workspace.file("a.md").write("same");
    expect(await adapter.readFile("a.md")).not.toEqual(first);
  });

  it("stores salt and KDF parameters in plaintext metadata", async () => {
    const adapter = new MemoryAdapter();
    await open(adapter);
    const metadata = JSON.parse(decode(await adapter.readFile(ENCRYPTION_METADATA_PATH)));
    expect(metadata).toMatchObject({
      version: 1,
      kdf: { name: "PBKDF2-SHA256", iterations: ITERATIONS },
    });
    expect(typeof metadata.kdf.salt).toBe("string");
    expect(typeof metadata.check).toBe("string");
  });

  it("reopens with the same passphrase and fails fast with a wrong one", async () => {
    const adapter = new MemoryAdapter();
    const first = await open(adapter);
    await first.workspace.file("a.md").write("hello");

    const again = await open(adapter);
    expect(await again.workspace.file("a.md").readText()).toBe("hello");

    const workspace = await Lokio.openWorkspace(adapter);
    const plugin = encryption({ passphrase: "wrong" }, { iterations: ITERATIONS });
    expect(await codeOf(workspace.use(plugin))).toBe("PERMISSION_DENIED");
    expect(workspace.plugin("encryption")).toBeUndefined();
    // The failed plugin left no wrapper behind: raw bytes are returned.
    expect(decode((await workspace.file("a.md").read()).slice(0, 4))).toBe("LKE1");
  });

  it("supports a CryptoKey instead of a passphrase", async () => {
    const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
      "encrypt",
      "decrypt",
    ]);
    const adapter = new MemoryAdapter();
    const { workspace } = await open(adapter, { key });
    await workspace.file("a.md").write("keyed");
    expect(await (await open(adapter, { key })).workspace.file("a.md").readText()).toBe("keyed");

    const otherKey = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
      "encrypt",
      "decrypt",
    ]);
    const other = await Lokio.openWorkspace(adapter);
    expect(await codeOf(other.use(encryption({ key: otherKey })))).toBe("PERMISSION_DENIED");
    expect(await codeOf(other.use(encryption({ passphrase: "x" })))).toBe("PERMISSION_DENIED");
  });

  it("detects tampered and truncated files", async () => {
    const adapter = new MemoryAdapter();
    const { workspace } = await open(adapter);
    await workspace.file("a.md").write("integrity");
    const raw = await adapter.readFile("a.md");
    raw[raw.length - 1]! ^= 0xff;
    await adapter.writeFile("a.md", raw);
    const error = await workspace
      .file("a.md")
      .read()
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DecryptionError);
    expect(isLokioError(error, "INTEGRITY")).toBe(true);

    await adapter.writeFile("short.md", raw.slice(0, 10));
    await expect(workspace.file("short.md").read()).rejects.toThrow(/truncated/);
  });

  it("passes plaintext files through by default and rejects them when disallowed", async () => {
    const adapter = new MemoryAdapter({ files: { "legacy.md": "plain" } });
    const { workspace } = await open(adapter);
    expect(await workspace.file("legacy.md").readText()).toBe("plain");

    const strict = await open(adapter, undefined, { allowPlaintext: false });
    await expect(strict.workspace.file("legacy.md").read()).rejects.toThrow(/not encrypted/);
  });

  it("encryptAll migrates remaining plaintext files", async () => {
    const adapter = new MemoryAdapter({ files: { "a.md": "A", "dir/b.md": "B", "skip.txt": "S" } });
    const { workspace, api } = await open(adapter, undefined, {
      include: (p) => p.endsWith(".md"),
    });
    await workspace.file("new.md").write("N");

    expect(await api.encryptAll()).toBe(2);
    expect(await api.encryptAll()).toBe(0);
    expect(decode((await adapter.readFile("dir/b.md")).slice(0, 4))).toBe("LKE1");
    expect(decode(await adapter.readFile("skip.txt"))).toBe("S");
    expect(await workspace.file("dir/b.md").readText()).toBe("B");
  });

  it("re-encodes files moved between encrypted and plaintext areas", async () => {
    const adapter = new MemoryAdapter();
    const { workspace } = await open(adapter, undefined, {
      include: (p) => !p.startsWith("public/"),
    });
    await workspace.file("private.md").write("x");
    await workspace.move("private.md", "public/x.md");
    expect(decode(await adapter.readFile("public/x.md"))).toBe("x");
    await workspace.move("public/x.md", "back.md");
    expect(decode((await adapter.readFile("back.md")).slice(0, 4))).toBe("LKE1");
    await workspace.move("back.md", "again.md");
    expect(await workspace.file("again.md").readText()).toBe("x");
    await workspace.directory("public").create();
    await workspace.move("public", "pub2");
  });

  it("refuses I/O after unuse and when metadata is unreadable", async () => {
    const adapter = new MemoryAdapter();
    const { workspace, api } = await open(adapter);
    await workspace.unuse("encryption");
    await expect(api.encryptAll()).rejects.toThrow(/not installed/);

    const broken = new MemoryAdapter();
    await broken.mkdir(ENCRYPTION_METADATA_PATH);
    const other = await Lokio.openWorkspace(broken);
    expect(await codeOf(other.use(encryption({ passphrase: "x" })))).toBe("TYPE_MISMATCH");
  });
});
