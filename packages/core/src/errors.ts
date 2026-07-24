/**
 * Error hierarchy shared by all Lokio adapters and packages.
 */

export class LokioError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "LokioError";
  }
}

export class NotFoundError extends LokioError {
  constructor(path: string) {
    super(`Not found: ${path}`);
    this.name = "NotFoundError";
  }
}

export class PermissionDeniedError extends LokioError {
  constructor(path: string) {
    super(`Permission denied: ${path}`);
    this.name = "PermissionDeniedError";
  }
}

export class NotSupportedError extends LokioError {
  constructor(feature: string) {
    super(`Not supported by this adapter: ${feature}`);
    this.name = "NotSupportedError";
  }
}
