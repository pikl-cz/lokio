import { describe, expect, it } from "vitest";
import {
  AlreadyExistsError,
  IntegrityError,
  InvalidPathError,
  isLokioError,
  LockTimeoutError,
  LokioError,
  NotEmptyError,
  NotFoundError,
  NotSupportedError,
  PermissionDeniedError,
  TypeMismatchError,
  WorkspaceClosedError,
} from "./errors.js";

describe("errors", () => {
  it.each([
    [new NotFoundError("a"), "NOT_FOUND", "NotFoundError"],
    [new PermissionDeniedError("a"), "PERMISSION_DENIED", "PermissionDeniedError"],
    [new NotSupportedError("x"), "NOT_SUPPORTED", "NotSupportedError"],
    [new InvalidPathError("a", "why"), "INVALID_PATH", "InvalidPathError"],
    [new NotEmptyError("a"), "NOT_EMPTY", "NotEmptyError"],
    [new TypeMismatchError("a", "file"), "TYPE_MISMATCH", "TypeMismatchError"],
    [new AlreadyExistsError("a"), "ALREADY_EXISTS", "AlreadyExistsError"],
    [new WorkspaceClosedError(), "WORKSPACE_CLOSED", "WorkspaceClosedError"],
    [new LockTimeoutError("l", 10), "LOCK_TIMEOUT", "LockTimeoutError"],
    [new IntegrityError("a", "bad tag"), "INTEGRITY", "IntegrityError"],
  ] as const)("%s has code %s", (error, code, name) => {
    expect(error).toBeInstanceOf(LokioError);
    expect(error.code).toBe(code);
    expect(error.name).toBe(name);
    expect(isLokioError(error, code)).toBe(true);
    expect(isLokioError(error)).toBe(true);
  });

  it("keeps the path and cause", () => {
    const cause = new Error("root cause");
    const error = new NotFoundError("notes/a.md", { cause });
    expect(error.path).toBe("notes/a.md");
    expect(error.cause).toBe(cause);
  });

  it("recognizes errors from another copy of the library by code", () => {
    const foreign = Object.assign(new Error("x"), { code: "NOT_FOUND" });
    expect(isLokioError(foreign, "NOT_FOUND")).toBe(true);
    expect(isLokioError(foreign, "NOT_EMPTY")).toBe(false);
    expect(isLokioError({ code: "NOT_FOUND" })).toBe(false);
    expect(isLokioError(null)).toBe(false);
    expect(isLokioError(new LokioError("generic")).valueOf()).toBe(true);
    expect(new LokioError("generic").code).toBe("UNKNOWN");
  });
});
