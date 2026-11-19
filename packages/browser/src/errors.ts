import {
  AlreadyExistsError,
  LokioError,
  NotEmptyError,
  NotFoundError,
  PermissionDeniedError,
  TypeMismatchError,
} from "@lokio/core";

/** Translates File System Access API `DOMException`s into Lokio errors. */
export function toLokioError(error: unknown, path: string, expected: "file" | "directory"): Error {
  if (error instanceof LokioError) return error;
  const name = error instanceof Error || error instanceof DOMException ? error.name : undefined;
  switch (name) {
    case "NotFoundError":
      return new NotFoundError(path, { cause: error });
    case "TypeMismatchError":
      return new TypeMismatchError(path, expected, { cause: error });
    case "NotAllowedError":
    case "SecurityError":
      return new PermissionDeniedError(path, { cause: error });
    case "InvalidModificationError":
      return expected === "directory"
        ? new NotEmptyError(path, { cause: error })
        : new AlreadyExistsError(path, { cause: error });
    default:
      return new LokioError(`Filesystem error at ${path}`, { cause: error, path });
  }
}

/** True for errors that `exists()` should treat as "not there". */
export function isMissing(error: unknown): boolean {
  return (
    error instanceof LokioError && (error.code === "NOT_FOUND" || error.code === "TYPE_MISMATCH")
  );
}
