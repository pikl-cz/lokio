import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const packagesDir = fileURLToPath(new URL("./packages/", import.meta.url));

/**
 * Resolve every `@lokio/*` import (including subpath exports such as
 * `@lokio/testing/conformance`) to TypeScript sources, so tests never run
 * against stale dist/ builds. Derived from each package.json `exports`.
 */
function sourceAliases() {
  const aliases: { find: RegExp; replacement: string }[] = [];
  for (const dir of readdirSync(packagesDir)) {
    if (!existsSync(`${packagesDir}${dir}/package.json`)) continue;
    const pkg = JSON.parse(readFileSync(`${packagesDir}${dir}/package.json`, "utf8")) as {
      name: string;
      exports?: Record<string, { import?: string; node?: string } | string>;
    };
    for (const [subpath, target] of Object.entries(pkg.exports ?? {})) {
      // Tests run in Node, so prefer the "node" condition (used by @lokio/auto).
      const entry = typeof target === "string" ? undefined : (target.node ?? target.import);
      if (!entry) continue;
      const source = entry.replace("./dist/", "src/").replace(/\.js$/, ".ts");
      const specifier = subpath === "." ? pkg.name : `${pkg.name}/${subpath.slice(2)}`;
      aliases.push({
        find: new RegExp(`^${specifier.replace(/[/.]/g, "\\$&")}$`),
        replacement: `${packagesDir}${dir}/${source}`,
      });
    }
  }
  return aliases;
}

export default defineConfig({
  test: {
    include: ["packages/*/src/**/*.test.ts"],
    exclude: ["**/*.browser.test.ts", "**/node_modules/**"],
    environment: "node",
    coverage: {
      provider: "v8",
      include: ["packages/*/src/**/*.ts"],
      exclude: ["**/*.test.ts", "packages/cli/src/index.ts", "packages/types/**"],
      reporter: ["text", "html", "lcov"],
      thresholds: { lines: 85, functions: 85, branches: 80, statements: 85 },
    },
  },
  resolve: { alias: sourceAliases() },
});
