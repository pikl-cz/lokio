import {
  AdapterWrapper,
  definePlugin,
  isLokioError,
  joinPath,
  type LokioAdapter,
  LokioError,
  type LokioPlugin,
  type Workspace,
} from "@lokio/core";

/** Where the salt, KDF parameters and key-check value live. Never encrypted. */
export const ENCRYPTION_METADATA_PATH = ".lokio/encryption.json";

/** Every encrypted file starts with these 4 bytes ("LKE1"). */
export const MAGIC = new Uint8Array([0x4c, 0x4b, 0x45, 0x31]);
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
/** Bytes an encrypted file has on top of its plaintext. */
export const ENCRYPTION_OVERHEAD = MAGIC.length + IV_LENGTH + TAG_LENGTH;
const CHECK_PLAINTEXT = "lokio-encryption-key-check";

export type EncryptionSecret = { passphrase: string } | { key: CryptoKey };

export interface EncryptionOptions {
  /**
   * Return `false` for paths that should stay plaintext. The metadata file is
   * always excluded. Defaults to encrypting everything else - including other
   * `.lokio` data such as history snapshots, so they don't leak plaintext.
   */
  include?: (path: string) => boolean;
  /** PBKDF2 iterations used when the workspace is first encrypted. Defaults to 600 000. */
  iterations?: number;
  /**
   * Return files that lack the "LKE1" header as-is (useful while migrating an
   * existing workspace; see `encryptAll`). Defaults to `true`.
   */
  allowPlaintext?: boolean;
}

export interface EncryptionApi {
  /** Encrypts every included file that is still plaintext. Resolves to the number of files rewritten. */
  encryptAll(): Promise<number>;
}

interface Metadata {
  version: 1;
  kdf?: { name: "PBKDF2-SHA256"; iterations: number; salt: string };
  check: string;
}

/** Thrown when a file cannot be decrypted (tampered, truncated or encrypted with another key). */
export class DecryptionError extends LokioError {
  constructor(path: string, reason: string, options?: { cause?: unknown }) {
    super(`Cannot decrypt ${path}: ${reason}`, { ...options, code: "INTEGRITY", path });
    this.name = "DecryptionError";
  }
}

const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const fromBase64 = (text: string) => Uint8Array.from(atob(text), (char) => char.charCodeAt(0));
const hasMagic = (data: Uint8Array) =>
  data.byteLength >= MAGIC.length && MAGIC.every((byte, index) => data[index] === byte);

async function encrypt(key: CryptoKey, plaintext: Uint8Array): Promise<Uint8Array> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new Uint8Array(plaintext)),
  );
  const out = new Uint8Array(MAGIC.length + IV_LENGTH + ciphertext.byteLength);
  out.set(MAGIC, 0);
  out.set(iv, MAGIC.length);
  out.set(ciphertext, MAGIC.length + IV_LENGTH);
  return out;
}

async function decrypt(key: CryptoKey, data: Uint8Array, path: string): Promise<Uint8Array> {
  if (data.byteLength < ENCRYPTION_OVERHEAD) throw new DecryptionError(path, "file is truncated");
  const iv = data.slice(MAGIC.length, MAGIC.length + IV_LENGTH);
  try {
    return new Uint8Array(
      await crypto.subtle.decrypt(
        { name: "AES-GCM", iv },
        key,
        data.slice(MAGIC.length + IV_LENGTH),
      ),
    );
  } catch (cause) {
    throw new DecryptionError(path, "wrong key or the data was modified", { cause });
  }
}

async function deriveKey(
  passphrase: string,
  salt: Uint8Array,
  iterations: number,
): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt: new Uint8Array(salt), iterations },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/** Loads (or, on first use, creates) the metadata file and returns a verified key. */
async function initKey(
  adapter: LokioAdapter,
  secret: EncryptionSecret,
  iterations: number,
): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  let metadata: Metadata | undefined;
  try {
    metadata = JSON.parse(
      new TextDecoder().decode(await adapter.readFile(ENCRYPTION_METADATA_PATH)),
    );
  } catch (error) {
    if (!isLokioError(error, "NOT_FOUND")) throw error;
  }

  if (!metadata) {
    let key: CryptoKey;
    let kdf: Metadata["kdf"];
    if ("key" in secret) {
      key = secret.key;
    } else {
      const salt = crypto.getRandomValues(new Uint8Array(16));
      key = await deriveKey(secret.passphrase, salt, iterations);
      kdf = { name: "PBKDF2-SHA256", iterations, salt: toBase64(salt) };
    }
    const check = toBase64(await encrypt(key, encoder.encode(CHECK_PLAINTEXT)));
    const created: Metadata = { version: 1, ...(kdf ? { kdf } : {}), check };
    await adapter.writeFile(
      ENCRYPTION_METADATA_PATH,
      encoder.encode(`${JSON.stringify(created, null, 2)}\n`),
    );
    return key;
  }

  let key: CryptoKey;
  if ("key" in secret) {
    key = secret.key;
  } else {
    if (!metadata.kdf) {
      throw new LokioError("This workspace was encrypted with a CryptoKey, not a passphrase", {
        code: "PERMISSION_DENIED",
        path: ENCRYPTION_METADATA_PATH,
      });
    }
    key = await deriveKey(
      secret.passphrase,
      fromBase64(metadata.kdf.salt),
      metadata.kdf.iterations,
    );
  }
  try {
    await decrypt(key, fromBase64(metadata.check), ENCRYPTION_METADATA_PATH);
  } catch (cause) {
    throw new LokioError("Wrong passphrase or key for this workspace", {
      code: "PERMISSION_DENIED",
      path: ENCRYPTION_METADATA_PATH,
      cause,
    });
  }
  return key;
}

class EncryptingAdapter extends AdapterWrapper {
  constructor(
    inner: LokioAdapter,
    private readonly key: () => Promise<CryptoKey>,
    private readonly included: (path: string) => boolean,
    private readonly allowPlaintext: boolean,
  ) {
    super(inner);
    if (inner.move) {
      this.move = async (from, to) => {
        // Moving between an encrypted and a plaintext area must re-encode the bytes.
        if ((await inner.stat(from)).kind === "file" && this.included(from) !== this.included(to)) {
          await this.writeFile(to, await this.readFile(from));
          await inner.deleteFile(from);
          return;
        }
        await inner.move!(from, to);
      };
    }
  }

  /** The adapter below this layer (raw bytes). */
  get raw(): LokioAdapter {
    return this.inner;
  }

  override async readFile(path: string): Promise<Uint8Array> {
    const data = await this.inner.readFile(path);
    if (!this.included(path)) return data;
    if (hasMagic(data)) return decrypt(await this.key(), data, path);
    if (this.allowPlaintext) return data;
    throw new DecryptionError(path, "file is not encrypted");
  }

  override async writeFile(path: string, data: Uint8Array): Promise<void> {
    if (!this.included(path)) return this.inner.writeFile(path, data);
    return this.inner.writeFile(path, await encrypt(await this.key(), data));
  }
}

/**
 * Transparently encrypts file contents with AES-GCM-256 (WebCrypto).
 *
 * ```ts
 * await workspace.use(encryption({ passphrase }));
 * ```
 *
 * File names, folder structure, sizes and timestamps are NOT hidden.
 * `stat().size` reports the on-disk (ciphertext) size: plaintext + 32 bytes.
 */
export function encryption(
  secret: EncryptionSecret,
  options: EncryptionOptions = {},
): LokioPlugin<EncryptionApi> {
  const include = options.include ?? (() => true);
  const included = (path: string) => path !== ENCRYPTION_METADATA_PATH && include(path);
  let keyPromise: Promise<CryptoKey> | undefined;
  let current: EncryptingAdapter | undefined;
  let workspace: Workspace | undefined;

  const key = () => {
    if (!keyPromise) {
      return Promise.reject(new LokioError("The encryption plugin is not installed"));
    }
    return keyPromise;
  };

  return definePlugin<EncryptionApi>({
    name: "encryption",
    wrapAdapter(adapter) {
      current = new EncryptingAdapter(adapter, key, included, options.allowPlaintext ?? true);
      return current;
    },
    async setup(ws) {
      keyPromise = initKey(ws.adapter, secret, options.iterations ?? 600_000);
      try {
        await keyPromise;
      } catch (error) {
        keyPromise = undefined;
        throw error;
      }
      workspace = ws;
      return {
        async encryptAll() {
          if (!workspace || !current)
            throw new LokioError("The encryption plugin is not installed");
          const raw = current.raw;
          let count = 0;
          const visit = async (dir: string): Promise<void> => {
            for (const entry of await raw.readDir(dir)) {
              const path = joinPath(dir, entry.name);
              if (entry.kind === "directory") {
                await visit(path);
              } else if (included(path) && !hasMagic(await raw.readFile(path))) {
                // Write through the whole stack so events and other plugins see it.
                await workspace!.file(path).write(await raw.readFile(path));
                count++;
              }
            }
          };
          await visit("");
          return count;
        },
      };
    },
    dispose() {
      keyPromise = undefined;
      workspace = undefined;
      current = undefined;
    },
  });
}
