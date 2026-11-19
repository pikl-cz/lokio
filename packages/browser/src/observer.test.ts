import { describe, expect, it, vi } from "vitest";
import { getObserverConstructor, type ObserverRecord, toWatchEvents } from "./observer.js";

const record = (overrides: Partial<ObserverRecord>): ObserverRecord => ({
  type: "modified",
  relativePathComponents: ["a", "b.md"],
  changedHandle: { kind: "file" } as FileSystemHandle,
  ...overrides,
});

describe("toWatchEvents", () => {
  it.each([
    ["appeared", "created"],
    ["disappeared", "deleted"],
    ["modified", "modified"],
  ] as const)("maps %s to %s", (type, expected) => {
    expect(toWatchEvents(record({ type }), "base")).toEqual([
      { type: expected, path: "base/a/b.md", kind: "file" },
    ]);
  });

  it("maps moves to delete + create", () => {
    expect(toWatchEvents(record({ type: "moved", relativePathMovedFrom: ["old.md"] }), "")).toEqual(
      [
        { type: "deleted", path: "old.md", kind: "file" },
        { type: "created", path: "a/b.md", kind: "file" },
      ],
    );
    expect(toWatchEvents(record({ type: "moved", relativePathMovedFrom: null }), "")).toEqual([
      { type: "created", path: "a/b.md", kind: "file" },
    ]);
  });

  it("maps unknown and errored records to an unknown change of the base path", () => {
    expect(toWatchEvents(record({ type: "unknown" }), "notes")).toEqual([
      { type: "unknown", path: "notes" },
    ]);
    expect(toWatchEvents(record({ type: "errored", changedHandle: null }), "")).toEqual([
      { type: "unknown", path: "" },
    ]);
  });

  it("omits kind when the handle is unknown", () => {
    expect(toWatchEvents(record({ type: "disappeared", changedHandle: null }), "")).toEqual([
      { type: "deleted", path: "a/b.md" },
    ]);
  });
});

describe("getObserverConstructor", () => {
  it("detects FileSystemObserver", () => {
    expect(getObserverConstructor()).toBeUndefined();
    class Fake {}
    vi.stubGlobal("FileSystemObserver", Fake);
    expect(getObserverConstructor()).toBe(Fake);
    vi.unstubAllGlobals();
  });
});
