import { defineConfig } from "vitest/config";
import base from "./vitest.config.js";

/**
 * Runs `*.browser.test.ts` in real Chromium (Playwright) - e.g. the adapter
 * conformance suite against the Origin Private File System.
 *
 *   pnpm exec playwright install chromium   # once
 *   pnpm test:browser
 */
// Spread instead of mergeConfig(): mergeConfig would concatenate `include`
// and run the Node test files in the browser too.
export default defineConfig({
  ...base,
  test: {
    ...base.test,
    include: ["packages/*/src/**/*.browser.test.ts"],
    exclude: ["**/node_modules/**"],
    coverage: { enabled: false },
    browser: {
      enabled: true,
      provider: "playwright",
      headless: true,
      name: "chromium",
    },
  },
});
