import type { LokioAdapter } from "@lokio/core";
import { afterEach, beforeEach, describe, it } from "vitest";
import { adapterChecks } from "./checks.js";

export interface AdapterConformanceOptions {
  /** Called after each test, e.g. to remove a temp directory. */
  cleanup?: (adapter: LokioAdapter) => void | Promise<void>;
}

/**
 * Runs the shared adapter contract as a Vitest suite. Every adapter must pass
 * it - including third-party ones (Tauri, Electron, S3, ...):
 *
 * ```ts
 * describeAdapterConformance("MyAdapter", () => new MyAdapter());
 * ```
 *
 * Checks for optional methods (`move`, `watch`, `lock`) are skipped when the
 * adapter doesn't implement them.
 */
export function describeAdapterConformance(
  name: string,
  factory: () => LokioAdapter | Promise<LokioAdapter>,
  options: AdapterConformanceOptions = {},
): void {
  describe(`${name} conformance`, () => {
    let adapter: LokioAdapter;

    beforeEach(async () => {
      adapter = await factory();
    });

    afterEach(async () => {
      await options.cleanup?.(adapter);
    });

    for (const check of adapterChecks) {
      it(check.name, async (context) => {
        if (check.requires && typeof adapter[check.requires] !== "function") {
          context.skip();
          return;
        }
        await check.run(adapter);
      });
    }
  });
}
