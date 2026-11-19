import { describe, expect, it } from "vitest";
import { KeyedMutex } from "./lock.js";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("KeyedMutex", () => {
  it("runs calls with the same key one at a time, in order", async () => {
    const mutex = new KeyedMutex();
    const log: string[] = [];
    const task = (id: string, ms: number) =>
      mutex.run("k", async () => {
        log.push(`${id}+`);
        await sleep(ms);
        log.push(`${id}-`);
        return id;
      });

    const results = await Promise.all([task("a", 20), task("b", 1), task("c", 5)]);
    expect(results).toEqual(["a", "b", "c"]);
    expect(log).toEqual(["a+", "a-", "b+", "b-", "c+", "c-"]);
    expect(mutex.isLocked("k")).toBe(false);
  });

  it("does not block different keys", async () => {
    const mutex = new KeyedMutex();
    const log: string[] = [];
    await Promise.all([
      mutex.run("a", async () => {
        log.push("a+");
        await sleep(20);
        log.push("a-");
      }),
      mutex.run("b", async () => {
        log.push("b+");
        log.push("b-");
      }),
    ]);
    expect(log).toEqual(["a+", "b+", "b-", "a-"]);
  });

  it("releases the lock when the task fails", async () => {
    const mutex = new KeyedMutex();
    await expect(
      mutex.run("k", () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    await expect(mutex.run("k", () => "ok")).resolves.toBe("ok");
  });
});
