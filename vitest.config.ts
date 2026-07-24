import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const src = (pkg: string) =>
  fileURLToPath(new URL(`./packages/${pkg}/src/index.ts`, import.meta.url));

export default defineConfig({
  test: {
    include: ["packages/*/src/**/*.{test,spec}.ts"],
    environment: "node",
  },
  resolve: {
    alias: {
      "@lokio/types": src("types"),
      "@lokio/core": src("core"),
      "@lokio/testing": src("testing"),
    },
  },
});
