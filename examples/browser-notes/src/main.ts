import { openWorkspace } from "@lokio/auto";
import { isLokioError, type LokioFile, type Workspace } from "@lokio/core";
import { type SearchApi, search } from "@lokio/plugin-search";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const openButton = $<HTMLButtonElement>("open");
const newButton = $<HTMLButtonElement>("new");
const searchInput = $<HTMLInputElement>("search");
const list = $<HTMLUListElement>("notes");
const editor = $<HTMLTextAreaElement>("editor");
const status = $<HTMLDivElement>("status");

let workspace: Workspace | undefined;
let index: SearchApi | undefined;
let current: LokioFile | undefined;
let saveTimer: ReturnType<typeof setTimeout> | undefined;

async function start(interactive: boolean) {
  try {
    // Reuses the folder from the last visit; prompts/picks only from a click (user gesture).
    workspace = await openWorkspace({
      requestPermission: interactive,
      pick: interactive,
      pickerId: "lokio-notes",
      fallback: interactive ? "opfs" : "none",
    });
  } catch (error) {
    if (!interactive && isLokioError(error)) return; // wait for the user to click "Open folder"
    throw error;
  }
  index = await workspace.use(search({ extensions: [".md"] }));
  workspace.watch(async (event) => {
    if (event.source === "external") status.textContent = `Changed outside: ${event.path}`;
    if (event.source === "external" && event.path === current?.path) {
      editor.value = await current.readText();
    }
    await render();
  });
  newButton.disabled = searchInput.disabled = false;
  status.textContent = `Adapter: ${workspace.adapterName}`;
  await render();
}

async function render() {
  if (!workspace) return;
  const query = searchInput.value.trim();
  const paths =
    query && index
      ? index.query(query).map((hit) => hit.path)
      : (await workspace.root.files()).filter((f) => f.extension === ".md").map((f) => f.path);

  list.replaceChildren(
    ...paths.map((path) => {
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.textContent = path;
      button.setAttribute("aria-current", String(path === current?.path));
      button.onclick = () => select(path);
      item.append(button);
      return item;
    }),
  );
}

async function select(path: string) {
  if (!workspace) return;
  current = workspace.file(path);
  editor.value = await current.readText();
  editor.disabled = false;
  editor.focus();
  await render();
}

openButton.onclick = () => start(true);
newButton.onclick = async () => {
  if (!workspace) return;
  const file = workspace.file(`note-${new Date().toISOString().replace(/[:.]/g, "-")}.md`);
  await file.write("# New note\n");
  await select(file.path);
};
searchInput.oninput = () => void render();
editor.oninput = () => {
  clearTimeout(saveTimer);
  const file = current;
  saveTimer = setTimeout(() => void file?.write(editor.value), 300);
};

void start(false);
