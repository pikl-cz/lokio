import { joinPath } from "@lokio/core";
import type { WatchEvent } from "@lokio/types";

/** Minimal typings for the (Chromium-only, 2024+) `FileSystemObserver` API. */
export type ObserverRecordType =
  | "appeared"
  | "disappeared"
  | "modified"
  | "moved"
  | "unknown"
  | "errored";

export interface ObserverRecord {
  type: ObserverRecordType;
  changedHandle?: FileSystemHandle | null;
  relativePathComponents: string[];
  relativePathMovedFrom?: string[] | null;
}

export interface FileSystemObserverLike {
  observe(handle: FileSystemHandle, options?: { recursive?: boolean }): Promise<void>;
  disconnect(): void;
}

export type FileSystemObserverConstructor = new (
  callback: (records: ObserverRecord[], observer: FileSystemObserverLike) => void,
) => FileSystemObserverLike;

export function getObserverConstructor(): FileSystemObserverConstructor | undefined {
  const ctor = (globalThis as { FileSystemObserver?: unknown }).FileSystemObserver;
  return typeof ctor === "function" ? (ctor as FileSystemObserverConstructor) : undefined;
}

/** Converts an observer record (paths relative to the observed directory) into Lokio watch events. */
export function toWatchEvents(record: ObserverRecord, base: string): WatchEvent[] {
  const path = joinPath(base, ...record.relativePathComponents);
  const kind = record.changedHandle?.kind;
  const withKind = <T extends WatchEvent>(event: T): T => (kind ? { ...event, kind } : event);
  switch (record.type) {
    case "appeared":
      return [withKind({ type: "created", path })];
    case "disappeared":
      return [withKind({ type: "deleted", path })];
    case "modified":
      return [withKind({ type: "modified", path })];
    case "moved": {
      const created = withKind({ type: "created" as const, path });
      if (!record.relativePathMovedFrom) return [created];
      return [
        withKind({ type: "deleted", path: joinPath(base, ...record.relativePathMovedFrom) }),
        created,
      ];
    }
    default:
      // "unknown" (events were dropped) and "errored" (observation stopped): re-scan the base.
      return [{ type: "unknown", path: base }];
  }
}
