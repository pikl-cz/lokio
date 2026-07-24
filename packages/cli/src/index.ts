#!/usr/bin/env node

type Command = () => void;

const commands: Record<string, Command> = {
  init() {
    console.log("Lokio: scaffolding a new workspace configuration (coming soon).");
  },
  doctor() {
    console.log("Lokio: environment looks OK. (Adapter diagnostics coming soon.)");
  },
  info() {
    console.log("Lokio CLI - local-first workspace tooling.");
  },
  build() {
    console.log("Lokio: nothing to build yet for this project.");
  },
};

function printHelp(): void {
  console.log(
    [
      "Usage: lokio <command>",
      "",
      "Commands:",
      "  init    Initialize a new Lokio-backed project",
      "  doctor  Check environment and adapter compatibility",
      "  info    Print Lokio CLI information",
      "  build   Run project build tasks",
    ].join("\n"),
  );
}

const [, , command] = process.argv;
const handler = command ? commands[command] : undefined;

if (handler) {
  handler();
} else {
  printHelp();
  if (command) process.exitCode = 1;
}
