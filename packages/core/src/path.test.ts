import { describe, expect, it } from "vitest";
import { isLokioError } from "./errors.js";
import {
  basename,
  dirname,
  extname,
  isInternalPath,
  isWithin,
  joinPath,
  normalizePath,
} from "./path.js";

describe("normalizePath", () => {
  it.each([
    ["", ""],
    ["/", ""],
    [".", ""],
    ["a", "a"],
    ["/a/b/", "a/b"],
    ["a//b///c", "a/b/c"],
    ["./a/./b", "a/b"],
    ["a/b/../c", "a/c"],
    ["a\\b\\c.md", "a/b/c.md"],
    ["a/..", ""],
    ["žluťoučký/kůň.md", "žluťoučký/kůň.md"],
  ])("%j -> %j", (input, expected) => {
    expect(normalizePath(input)).toBe(expected);
  });

  it.each(["..", "../a", "a/../../b", "..\\x"])("rejects %j escaping the root", (input) => {
    expect(() => normalizePath(input)).toThrow(/escapes the workspace root/);
    try {
      normalizePath(input);
    } catch (error) {
      expect(isLokioError(error, "INVALID_PATH")).toBe(true);
    }
  });

  it("rejects NUL bytes", () => {
    expect(() => normalizePath("a\0b")).toThrow(/NUL/);
  });
});

describe("path helpers", () => {
  it("joins and normalizes", () => {
    expect(joinPath("a", "b", "c.md")).toBe("a/b/c.md");
    expect(joinPath("", "x")).toBe("x");
    expect(joinPath("a/b", "../c")).toBe("a/c");
  });

  it("splits into dirname and basename", () => {
    expect(dirname("a/b/c.md")).toBe("a/b");
    expect(dirname("c.md")).toBe("");
    expect(basename("a/b/c.md")).toBe("c.md");
    expect(basename("")).toBe("");
  });

  it("extracts extensions", () => {
    expect(extname("a/b.tar.gz")).toBe(".gz");
    expect(extname("README")).toBe("");
    expect(extname(".gitignore")).toBe("");
  });

  it("checks containment without prefix false positives", () => {
    expect(isWithin("", "anything")).toBe(true);
    expect(isWithin("a", "a")).toBe(true);
    expect(isWithin("a", "a/b")).toBe(true);
    expect(isWithin("a", "ab")).toBe(false);
  });

  it("recognizes the internal .lokio folder", () => {
    expect(isInternalPath(".lokio")).toBe(true);
    expect(isInternalPath(".lokio/history/x")).toBe(true);
    expect(isInternalPath(".lokiox")).toBe(false);
  });
});
