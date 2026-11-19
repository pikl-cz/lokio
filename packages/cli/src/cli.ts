import { randomBytes } from "node:crypto";
import { watch } from "node:fs";
import { access, constants, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { getCapabilities, LOKIO_DIR, Lokio } from "@lokio/core";
import { NodeAdapter } from "@lokio/node";
import { runAdapterChecks } from "@lokio/testing";

declare const __LOKIO_CLI_VERSION__: string | undefined;

export interface CliIO {
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  cwd: string;
}

const defaultIO = (): CliIO => ({
  stdout: (line) => process.stdout.write(`${line}\n`),
  stderr: (line) => process.stderr.write(`${line}\n`),
  cwd: process.cwd(),
});

/** Version injected at build time by tsup; falls back to package.json when run from source. */
export async function cliVersion(): Promise<string> {
  if (typeof __LOKIO_CLI_VERSION__ === "string") return __LOKIO_CLI_VERSION__;
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")) as {
    version: string;
  };
  return pkg.version;
}

const HELP = `Usage: lokio <command> [dir] [options]

Commands:
  init [dir]     Mark a folder as a Lokio workspace (.lokio/workspace.json)
  doctor [dir]   Check that this machine can run Lokio on the folder
  info [dir]     Show adapter capabilities and workspace statistics

Options:
  -f, --force    init: overwrite an existing workspace.json
  -h, --help     Show this help
  -v, --version  Show the CLI version

[dir] defaults to the current directory.`;

type Command = (dir: string, flags: { force: boolean }, io: CliIO) => Promise<number>;

const commands: Record<string, Command> = {
  async init(dir, flags, io) {
    const configPath = join(dir, LOKIO_DIR, "workspace.json");
    const exists = await stat(configPath).then(
      () => true,
      () => false,
    );
    if (exists && !flags.force) {
      io.stderr(`${configPath} already exists. Use --force to overwrite it.`);
      return 1;
    }
    await mkdir(join(dir, LOKIO_DIR), { recursive: true });
    const config = { version: 1, createdAt: new Date().toISOString() };
    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
    io.stdout(`Initialized Lokio workspace in ${dir}`);
    io.stdout("");
    io.stdout("Next steps:");
    io.stdout("  npm install @lokio/core @lokio/node");
    io.stdout("");
    io.stdout('  import { Lokio } from "@lokio/core";');
    io.stdout('  import { NodeAdapter } from "@lokio/node";');
    io.stdout(
      `  const workspace = await Lokio.openWorkspace(new NodeAdapter({ root: ${JSON.stringify(dir)} }));`,
    );
    return 0;
  },

  async doctor(dir, _flags, io) {
    io.stdout(`Node ${process.version} on ${process.platform}/${process.arch}`);
    try {
      const info = await stat(dir);
      if (!info.isDirectory()) throw new Error("not a directory");
      await access(dir, constants.R_OK | constants.W_OK);
    } catch (error) {
      io.stderr(`✗ ${dir} is not a readable and writable directory (${(error as Error).message})`);
      return 1;
    }
    io.stdout(`✓ ${dir} is readable and writable`);

    io.stdout(
      (await supportsRecursiveWatch())
        ? "✓ recursive fs.watch works (external changes will be reported)"
        : "– recursive fs.watch is unavailable (external changes will not be reported)",
    );

    const lokioDir = join(dir, LOKIO_DIR);
    const hadLokioDir = await stat(lokioDir).then(
      () => true,
      () => false,
    );
    const scratch = join(lokioDir, `doctor-${randomBytes(4).toString("hex")}`);
    let failed = 0;
    let counter = 0;
    try {
      const results = await runAdapterChecks(
        async () => {
          const root = join(scratch, String(counter++));
          await mkdir(root, { recursive: true });
          return new NodeAdapter({ root });
        },
        { cleanup: (adapter) => adapter.close?.() },
      );
      io.stdout("");
      io.stdout("Adapter conformance:");
      for (const result of results) {
        const mark = result.status === "passed" ? "✓" : result.status === "failed" ? "✗" : "–";
        io.stdout(`  ${mark} ${result.name}`);
        if (result.status === "failed") {
          failed += 1;
          io.stdout(`      ${String((result.error as Error)?.message ?? result.error)}`);
        }
      }
    } finally {
      await rm(hadLokioDir ? scratch : lokioDir, { recursive: true, force: true });
    }
    io.stdout("");
    if (failed > 0) {
      io.stderr(`${failed} check(s) failed.`);
      return 1;
    }
    io.stdout("All checks passed.");
    return 0;
  },

  async info(dir, _flags, io) {
    const isDir = await stat(dir).then(
      (info) => info.isDirectory(),
      () => false,
    );
    if (!isDir) {
      io.stderr(`${dir} is not a directory`);
      return 1;
    }
    const adapter = new NodeAdapter({ root: dir });
    const workspace = await Lokio.openWorkspace(adapter);
    let files = 0;
    let directories = 0;
    let bytes = 0;
    for await (const entry of workspace.root.walk({ filter: (e) => e.path !== LOKIO_DIR })) {
      if (entry.kind === "directory") {
        directories += 1;
      } else {
        files += 1;
        bytes += (await adapter.stat(entry.path)).size;
      }
    }
    const initialized = await adapter.exists(`${LOKIO_DIR}/workspace.json`);
    await workspace.close();

    io.stdout(`Lokio CLI ${await cliVersion()}`);
    io.stdout(`Workspace:   ${dir}${initialized ? "" : " (not initialized - run `lokio init`)"}`);
    io.stdout(`Adapter:     ${adapter.name}`);
    const capabilities = getCapabilities(adapter);
    io.stdout(
      `Capabilities: ${Object.entries(capabilities)
        .map(([name, enabled]) => `${name}=${enabled ? "yes" : "no"}`)
        .join(", ")}`,
    );
    io.stdout(`Contents:    ${files} file(s), ${directories} folder(s), ${formatBytes(bytes)}`);
    return 0;
  },
};

export function formatBytes(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${unit === 0 ? value : value.toFixed(1)} ${units[unit]}`;
}

async function supportsRecursiveWatch(): Promise<boolean> {
  const dir = await mkdtemp(join(tmpdir(), "lokio-watch-"));
  try {
    const watcher = watch(dir, { recursive: true });
    watcher.on("error", () => {});
    watcher.close();
    return true;
  } catch {
    return false;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Runs the CLI and resolves to the process exit code. */
export async function run(argv: string[], io: CliIO = defaultIO()): Promise<number> {
  let parsed: ReturnType<typeof parse>;
  try {
    parsed = parse(argv);
  } catch (error) {
    io.stderr((error as Error).message);
    io.stderr("");
    io.stderr(HELP);
    return 1;
  }
  const { values, positionals } = parsed;

  if (values.version) {
    io.stdout(await cliVersion());
    return 0;
  }
  const [command, target, ...rest] = positionals;
  if (values.help || command === undefined) {
    io.stdout(HELP);
    return 0;
  }
  if (!Object.hasOwn(commands, command)) {
    io.stderr(`Unknown command: ${command}`);
    io.stderr("");
    io.stderr(HELP);
    return 1;
  }
  if (rest.length > 0) {
    io.stderr(`Unexpected arguments: ${rest.join(" ")}`);
    return 1;
  }
  const dir = resolve(io.cwd, target ?? ".");
  try {
    return await commands[command]!(dir, { force: Boolean(values.force) }, io);
  } catch (error) {
    io.stderr(`lokio ${command} failed: ${(error as Error).message}`);
    return 1;
  }
}

function parse(argv: string[]) {
  return parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
      force: { type: "boolean", short: "f" },
    },
  });
}
