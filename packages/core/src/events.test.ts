import { afterEach, describe, expect, it, vi } from "vitest";
import { EventBus } from "./events.js";

type Events = { ping: [value: number]; done: [] };

describe("EventBus", () => {
  afterEach(() => vi.restoreAllMocks());

  it("delivers events with arguments and unsubscribes", () => {
    const bus = new EventBus<Events>();
    const seen: number[] = [];
    const off = bus.on("ping", (value) => seen.push(value));
    bus.emit("ping", 1);
    off();
    bus.emit("ping", 2);
    expect(seen).toEqual([1]);
  });

  it("supports once()", () => {
    const bus = new EventBus<Events>();
    const listener = vi.fn();
    bus.once("done", listener);
    bus.emit("done");
    bus.emit("done");
    expect(listener).toHaveBeenCalledOnce();
  });

  it("can unsubscribe a once() listener before it fires", () => {
    const bus = new EventBus<Events>();
    const listener = vi.fn();
    const off = bus.once("done", listener);
    off();
    bus.emit("done");
    expect(listener).not.toHaveBeenCalled();
  });

  it("does nothing when emitting without listeners or removing unknown ones", () => {
    const bus = new EventBus<Events>();
    expect(() => bus.emit("done")).not.toThrow();
    expect(() => bus.off("done", () => {})).not.toThrow();
  });

  it("keeps notifying listeners when one throws and reports the error asynchronously", () => {
    const bus = new EventBus<Events>();
    const reported: unknown[] = [];
    vi.spyOn(globalThis, "queueMicrotask").mockImplementation((callback) => {
      try {
        callback();
      } catch (error) {
        reported.push(error);
      }
    });
    const seen: number[] = [];
    bus.on("ping", () => {
      throw new Error("listener failed");
    });
    bus.on("ping", (value) => seen.push(value));

    expect(() => bus.emit("ping", 7)).not.toThrow();
    expect(seen).toEqual([7]);
    expect(reported).toHaveLength(1);
  });

  it("is safe against listeners that unsubscribe during emit", () => {
    const bus = new EventBus<Events>();
    const seen: string[] = [];
    const offA = bus.on("done", () => {
      seen.push("a");
      offA();
    });
    bus.on("done", () => seen.push("b"));
    bus.emit("done");
    bus.emit("done");
    expect(seen).toEqual(["a", "b", "b"]);
  });
});
