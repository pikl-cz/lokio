# @lokio/plugin-encryption

Transparently encrypts file contents with **AES-GCM-256** using WebCrypto. It works in browsers and in Node ≥ 20 and has no dependencies.

```sh
pnpm add @lokio/core @lokio/plugin-encryption
```

```ts
import { encryption } from "@lokio/plugin-encryption";

const crypt = await workspace.use(encryption({ passphrase }));
await workspace.file("diary.md").write("secret"); // ciphertext on disk
await workspace.file("diary.md").readText(); // "secret"

await crypt.encryptAll(); // migrate files that are still plaintext
```

A wrong passphrase fails right away in `use()` with a `LokioError` whose code is `PERMISSION_DENIED`.

## Keys

- `{ passphrase }`: on first use, a random 16-byte salt is created. The key is derived with PBKDF2-SHA256 (600 000 iterations by default). The salt, the KDF parameters and an encrypted key-check value are stored in `.lokio/encryption.json`. This file is not secret, but **don't delete it**: without the salt, the data cannot be recovered.
- `{ key: CryptoKey }`: bring your own AES-GCM key, for example one wrapped by a server or stored as a non-extractable key in IndexedDB.

Lokio never stores the passphrase or the key. If you lose them, the data is gone.

## Options

| Option           | Default   | Description                                                                                     |
| ---------------- | --------- | ----------------------------------------------------------------------------------------------- |
| `include`        | all files | `(path) => boolean`. `.lokio/encryption.json` is always excluded.                               |
| `iterations`     | `600_000` | PBKDF2 iterations, used only when the workspace is first encrypted.                             |
| `allowPlaintext` | `true`    | Return files without the encryption header as-is. Set it to `false` once the migration is done. |

## File format

`"LKE1"` (4 bytes) + random IV (12 bytes) + AES-GCM ciphertext + tag (16 bytes). Every write uses a fresh IV. A modified or truncated file fails to read with a `DecryptionError` (code `INTEGRITY`).

## Threat model and caveats

- **Not hidden:** file and folder names, directory structure, file sizes (plaintext + 32 bytes) and timestamps.
- `stat().size` reports the **on-disk** size, which is the plaintext size + 32 bytes.
- The plugin protects data at rest, such as synced folders, backups and stolen disks. It does not protect against code running inside your app.
- Other `.lokio` data, such as history snapshots, is encrypted as well, so it doesn't leak plaintext.
- Moving a file between an included and an excluded path re-encodes it, so it is no longer a cheap rename.
