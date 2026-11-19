// Usage (after `pnpm build` in the repo root):
//   node journal.js write "Dreamed about a red horse"
//   node journal.js search horse
//   node journal.js history
import { Lokio } from "@lokio/core";
import { NodeAdapter } from "@lokio/node";
import { history } from "@lokio/plugin-history";
import { search } from "@lokio/plugin-search";

const workspace = await Lokio.openWorkspace(new NodeAdapter({ root: "./journal-data" }));
const versions = await workspace.use(history({ maxVersions: 10 }));
const index = await workspace.use(search());

const today = workspace.file(`${new Date().toISOString().slice(0, 10)}.md`);
const [command, ...rest] = process.argv.slice(2);

switch (command) {
  case "write": {
    // updateText runs under a lock, so two concurrent `write`s never lose an entry.
    await today.updateText((current) => `${current ?? `# ${today.name}\n`}\n- ${rest.join(" ")}\n`);
    console.log(`Saved to ${today.path}`);
    break;
  }
  case "search": {
    await index.ready;
    for (const hit of index.query(rest.join(" "))) {
      console.log(`${hit.path}  (${hit.score.toFixed(2)})\n  ${hit.snippet}`);
    }
    break;
  }
  case "history": {
    for (const version of await versions.versions(today.path)) {
      console.log(
        new Date(version.timestamp).toLocaleTimeString(),
        `${version.size} B`,
        version.id,
      );
    }
    break;
  }
  default:
    console.log("Commands: write <text> | search <query> | history");
}

await workspace.close();
