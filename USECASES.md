# Use cases

Lokio fits apps whose data should live in **plain files the user owns** - files they can open in other tools,
sync with Dropbox/iCloud/Syncthing/git, back up, and keep after your app is gone. Each recipe below shows the
file layout, the packages involved and the core of the implementation.

- [Dream journal](#1-dream-journal) - one file per day, encrypted
- [Markdown notes vault](#2-markdown-notes-vault-obsidian-style) - live sync with other editors, search, backlinks
- [Recipe manager](#3-recipe-manager-json-documents) - JSON documents with safe concurrent edits
- [Personal wiki](#4-personal-wiki) - renames that keep links working, page history
- [Image catalog](#5-image-catalog) - binary files plus a metadata sidecar
- [Project manager](#6-project-manager--kanban) - a board as a folder tree
- [Desktop apps (Electron / Tauri)](#7-desktop-apps-electron--tauri)
- [Multi-tab and multi-process apps](#8-multi-tab-and-multi-process-apps)
- [CLI tools and static site generators](#9-cli-tools-and-static-site-generators)
- [Offline-first PWA without a visible folder](#10-offline-first-pwa-on-opfs)
- [Testing apps that use files](#11-testing-apps-that-use-files)
- [When Lokio is _not_ the right tool](#when-lokio-is-not-the-right-tool)

---

## 1. Dream journal

> Write down dreams every morning. Private, encrypted, readable in 20 years.

```
dreams/
  2026/
    2026-11-19.dream      ← encrypted Markdown
  .lokio/encryption.json  ← salt + KDF params (not secret, don't delete)
```

**Packages:** `@lokio/auto`, `@lokio/plugin-encryption`, `@lokio/plugin-history`

```ts
import { openWorkspace } from "@lokio/auto";
import { encryption } from "@lokio/plugin-encryption";
import { history } from "@lokio/plugin-history";

const journal = await openWorkspace({ root: "./dreams", plugins: [history({ maxVersions: 5 })] });
await journal.use(encryption({ passphrase })); // a wrong passphrase rejects here with PERMISSION_DENIED

const today = new Date().toISOString().slice(0, 10);
const entry = journal.file(`${today.slice(0, 4)}/${today}.dream`);

await entry.updateText((current) => `${current ?? `# ${today}\n`}\n${dreamText}\n`);
```

**Why Lokio:** encryption and history are plugins, so the journal code stays plain read/write. Files stay
encrypted at rest in synced folders and backups (names and sizes are visible, contents are not). History
snapshots are encrypted too.

---

## 2. Markdown notes vault (Obsidian-style)

> A folder of `.md` files. The app edits them, while VS Code, git or a sync client may change them too.

```
vault/
  inbox.md
  projects/lokio.md
  daily/2026-11-19.md
  .lokio/history/…        ← previous versions
```

**Packages:** `@lokio/browser` or `@lokio/node`, `@lokio/plugin-search`, `@lokio/plugin-history`

```ts
const vault = await Lokio.openWorkspace({ adapter, plugins: [history()] });
const index = await vault.use(search({ extensions: [".md"] }));

// React to edits from other apps (sync clients, editors, other tabs).
vault.watch(async (change) => {
  if (change.source === "external" && change.path === openNote?.path) {
    editor.setValue(await openNote.readText()); // or show a "file changed on disk" banner
  }
  sidebar.refresh();
});

// Full-text search, insensitive to case and diacritics ("kun" finds "kůň").
const hits = index.query("lokio plugin", { limit: 10 });

// Backlinks: which notes link to [[lokio]]?
const backlinks: string[] = [];
for await (const entry of vault.root.walk({ directories: false })) {
  if (!entry.path.endsWith(".md")) continue;
  if ((await vault.file(entry.path).readText()).includes("[[lokio]]")) backlinks.push(entry.path);
}
```

**Why Lokio:** `watch()` reports external edits and drops the echoes of your own writes. Search stays up to
date by itself. The vault stays a plain folder of Markdown.

---

## 3. Recipe manager (JSON documents)

> One JSON file per recipe, plus an index of favourites that several parts of the UI update.

```
recipes/
  pancakes.json
  svickova.json
  favourites.json
```

```ts
interface Recipe {
  title: string;
  servings: number;
  ingredients: { name: string; amount: string }[];
  tags: string[];
}

const recipes = workspace.directory("recipes");

async function saveRecipe(slug: string, recipe: Recipe) {
  await recipes.file(`${slug}.json`).writeJSON(recipe);
}

async function loadAll(): Promise<Recipe[]> {
  const files = (await recipes.files()).filter(
    (f) => f.extension === ".json" && f.name !== "favourites.json",
  );
  return Promise.all(files.map((f) => f.readJSON<Recipe>()));
}

// Two buttons clicked quickly, or two tabs: updateJSON holds a lock, so neither update is lost.
async function toggleFavourite(slug: string) {
  await recipes
    .file("favourites.json")
    .updateJSON<string[]>((current = []) =>
      current.includes(slug) ? current.filter((s) => s !== slug) : [...current, slug],
    );
}
```

**Why Lokio:** `readJSON`/`writeJSON`/`updateJSON` cover document-style storage without a database. The
user can still edit a recipe in a text editor.

---

## 4. Personal wiki

> Pages link to each other. Renaming a page must not break links. Mistakes must be undoable.

```ts
const pages = await workspace.use(history());

async function renamePage(from: string, to: string) {
  await workspace.move(`wiki/${from}.md`, `wiki/${to}.md`); // native rename when possible

  // Rewrite links - only in pages that contain them, so untouched pages get no new history version.
  for await (const entry of workspace.directory("wiki").walk({ directories: false })) {
    const page = workspace.file(entry.path);
    const text = await page.readText();
    if (text.includes(`[[${from}]]`)) await page.write(text.replaceAll(`[[${from}]]`, `[[${to}]]`));
  }
}

// Undo: list versions and restore one (the current content is snapshotted first, so restore is undoable too).
const [previous] = await pages.versions("wiki/home.md");
if (previous) await pages.restore("wiki/home.md", previous.id);
```

**Why Lokio:** `move` works for files and whole folders, and falls back to copy + delete where the runtime
can't rename. The history plugin gives you undo without your own versioning code.

---

## 5. Image catalog

> Photos stay as normal `.jpg`/`.png`. Tags and ratings live in a sidecar JSON next to them.

```
photos/
  2026-summer/
    IMG_0001.jpg
    IMG_0002.jpg
    metadata.json   ← { "IMG_0001.jpg": { "rating": 5, "tags": ["sea"] } }
```

```ts
type Metadata = Record<string, { rating?: number; tags?: string[] }>;

async function* listPhotos(albumPath: string) {
  const album = workspace.directory(albumPath);
  const meta = (await album.file("metadata.json").exists())
    ? await album.file("metadata.json").readJSON<Metadata>()
    : {};
  for (const file of await album.files()) {
    if (![".jpg", ".jpeg", ".png", ".webp"].includes(file.extension.toLowerCase())) continue;
    const bytes = await file.read(); // Uint8Array
    yield { file, url: URL.createObjectURL(new Blob([bytes])), ...meta[file.name] };
  }
}

async function rate(albumPath: string, name: string, rating: number) {
  await workspace.file(`${albumPath}/metadata.json`).updateJSON<Metadata>((meta = {}) => ({
    ...meta,
    [name]: { ...meta[name], rating },
  }));
}
```

**Why Lokio:** binary and text go through the same API. Lightroom, the OS photo viewer or a backup tool
still see an ordinary folder. Use `history({ include: (p) => p.endsWith(".json") })` so large images
aren't snapshotted.

---

## 6. Project manager / kanban

> A board is a folder, columns are subfolders, cards are Markdown files. Moving a card is a file move.

```
board/
  todo/       write-docs.md
  doing/      publish-npm.md
  done/       pnpm-migration.md
```

```ts
const columns = await workspace.directory("board").directories();
const board = await Promise.all(
  columns.map(async (column) => ({ name: column.name, cards: await column.files() })),
);

// Drag & drop between columns.
await workspace.file("board/todo/write-docs.md").moveTo("board/doing/write-docs.md");

// Keep the UI in sync with changes made in git or by teammates via a synced folder.
workspace.watch(() => renderBoard(), { path: "board" });
```

**Why Lokio:** you get a state model that works with git: diffs are readable, merges are per card, and there
is no proprietary format.

---

## 7. Desktop apps (Electron / Tauri)

Use `@lokio/node` in the main/backend process. The same application code also runs in a browser build with
`@lokio/browser`, or with `@lokio/auto`, which picks the adapter for you.

```ts
// Electron main process
import { app } from "electron";
import { Lokio } from "@lokio/core";
import { NodeAdapter } from "@lokio/node";

const workspace = await Lokio.openWorkspace(
  new NodeAdapter({ root: `${app.getPath("documents")}/MyApp` }),
);
app.on("before-quit", () => void workspace.close()); // stops watchers, disposes plugins
```

**Why Lokio:** atomic writes (temp file + rename) mean a crash or a power cut mid-save never leaves a
half-written file. Paths from the renderer can't escape the root (`..` throws `INVALID_PATH`).

---

## 8. Multi-tab and multi-process apps

Two browser tabs, or a CLI and a desktop app, working on the same folder:

```ts
// Exclusive section across tabs (Web Locks) or processes (lock files in .lokio/locks).
await workspace.lock("sync", async () => {
  const state = await workspace.file(".lokio/sync-state.json").readJSON();
  // ... push/pull changes ...
});

// Other tabs/processes see the result as external change events.
workspace.watch((change) => {
  if (change.source === "external") reload(change.path);
});
```

Check `workspace.capabilities.crossProcessLocks`. When it is `false`, locks only protect within the
current JS realm.

---

## 9. CLI tools and static site generators

```ts
import { Lokio } from "@lokio/core";
import { NodeAdapter } from "@lokio/node";

const site = await Lokio.openWorkspace(new NodeAdapter({ root: process.cwd() }));

for await (const entry of site.directory("content").walk({ directories: false })) {
  if (!entry.path.endsWith(".md")) continue;
  const html = render(await site.file(entry.path).readText());
  await site
    .file(entry.path.replace(/^content\//, "public/").replace(/\.md$/, ".html"))
    .write(html);
}

// Watch mode
site.watch((change) => rebuild(change.path), { path: "content" });
```

`npx lokio doctor` checks that the filesystem behaves as Lokio expects (atomic rename, watch support, locks)
before you blame your code.

---

## 10. Offline-first PWA on OPFS

When the app doesn't need a user-visible folder (or the browser has no directory picker, e.g. Firefox and
Safari), use the Origin Private File System. It has the same API, needs no permission prompt and works offline.

```ts
import { openWorkspace } from "@lokio/auto";

// Remembered folder if there is one, otherwise OPFS.
const workspace = await openWorkspace({ fallback: "opfs" });
```

Later you can let the user "export to a folder" by copying from the OPFS workspace into a picked one, since
both are just workspaces.

---

## 11. Testing apps that use files

```ts
import { Lokio } from "@lokio/core";
import { MemoryAdapter } from "@lokio/testing";

it("adds a recipe to favourites", async () => {
  const workspace = await Lokio.openWorkspace(
    new MemoryAdapter({ files: { "recipes/favourites.json": "[]" } }),
  );
  await toggleFavourite(workspace, "pancakes");
  expect(await workspace.file("recipes/favourites.json").readJSON()).toEqual(["pancakes"]);
});

// Simulate an edit from another app: write through the adapter directly, not the workspace.
await adapter.writeFile("notes/a.md", new TextEncoder().encode("changed elsewhere"));
```

Browser-specific code can run against `createFakeDirectoryHandle()` from `@lokio/testing/fs-access`, with no
real browser needed. Adapter authors run `describeAdapterConformance()` to prove their adapter behaves like
the official ones.

---

## When Lokio is _not_ the right tool

- **Large, query-heavy datasets** (millions of records, joins, aggregations): use SQLite (e.g. via OPFS/wasm)
  or a real database. Lokio can store the database file, but it won't query it.
- **Real-time collaboration on the same document**: you need CRDTs (Yjs, Automerge). Lokio can persist their
  updates as files, but it doesn't merge concurrent edits.
- **Server-side multi-tenant storage**: use object storage or a database. Lokio is designed for one user's files.
- **Hiding metadata**: the encryption plugin hides contents, not file names, sizes or timestamps.
