/**
 * Error hierarchy shared by all Lokio adapters and packages.
 *
 * Prefer checking `error.code` (or `isLokioError(error, code)`) over
 * `instanceof`: if an app ends up with two copies of @lokio/core in its
 * bundle, `instanceof` silently fails while `code` keeps working.
 */

export type LokioErrorCode =
  | "UNKNOWN"
  | "NOT_FOUND"
  | "PERMISSION_DENIED"
  | "NOT_SUPPORTED"
  | "INVALID_PATH"
  | "NOT_EMPTY"
  | "TYPE_MISMATCH"
  | "ALREADY_EXISTS"
  | "WORKSPACE_CLOSED"
  | "LOCK_TIMEOUT"
  | "INTEGRITY";

export class LokioError extends Error {
  readonly code: LokioErrorCode;
  readonly path?: string;

  constructor(
    message: string,
    options?: { cause?: unknown; code?: LokioErrorCode; path?: string },
  ) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = "LokioError";
    this.code = options?.code ?? "UNKNOWN";
    this.path = options?.path;
  }
}

export class NotFoundError extends LokioError {
  constructor(path: string, options?: { cause?: unknown }) {
    super(`Not found: ${path}`, { ...options, code: "NOT_FOUND", path });
    this.name = "NotFoundError";
  }
}

export class PermissionDeniedError extends LokioError {
  constructor(path: string, options?: { cause?: unknown }) {
    super(`Permission denied: ${path}`, { ...options, code: "PERMISSION_DENIED", path });
    this.name = "PermissionDeniedError";
  }
}

export class NotSupportedError extends LokioError {
  constructor(feature: string, options?: { cause?: unknown }) {
    super(`Not supported by this adapter: ${feature}`, { ...options, code: "NOT_SUPPORTED" });
    this.name = "NotSupportedError";
  }
}

export class InvalidPathError extends LokioError {
  constructor(path: string, reason: string) {
    super(`Invalid path "${path}": ${reason}`, { code: "INVALID_PATH", path });
    this.name = "InvalidPathError";
  }
}

export class NotEmptyError extends LokioError {
  constructor(path: string, options?: { cause?: unknown }) {
    super(`Directory not empty: ${path}`, { ...options, code: "NOT_EMPTY", path });
    this.name = "NotEmptyError";
  }
}

/** A file was found where a directory was expected, or vice versa. */
export class TypeMismatchError extends LokioError {
  constructor(path: string, expected: "file" | "directory", options?: { cause?: unknown }) {
    super(`Expected a ${expected}: ${path}`, { ...options, code: "TYPE_MISMATCH", path });
    this.name = "TypeMismatchError";
  }
}

export class AlreadyExistsError extends LokioError {
  constructor(path: string, options?: { cause?: unknown }) {
    super(`Already exists: ${path}`, { ...options, code: "ALREADY_EXISTS", path });
    this.name = "AlreadyExistsError";
  }
}

export class WorkspaceClosedError extends LokioError {
  constructor() {
    super("The workspace has been closed", { code: "WORKSPACE_CLOSED" });
    this.name = "WorkspaceClosedError";
  }
}

export class LockTimeoutError extends LokioError {
  constructor(name: string, timeoutMs: number) {
    super(`Timed out after ${timeoutMs}ms waiting for lock "${name}"`, { code: "LOCK_TIMEOUT" });
    this.name = "LockTimeoutError";
  }
}

/** Stored data is corrupt or was tampered with (e.g. failed decryption or checksum). */
export class IntegrityError extends LokioError {
  constructor(path: string, reason: string, options?: { cause?: unknown }) {
    super(`Integrity check failed for ${path}: ${reason}`, { ...options, code: "INTEGRITY", path });
    this.name = "IntegrityError";
  }
}

export function isLokioError(error: unknown, code?: LokioErrorCode): error is LokioError {
  if (typeof error !== "object" || error === null || !("code" in error)) return false;
  if (!(error instanceof Error)) return false;
  return code === undefined ? true : (error as LokioError).code === code;
}
