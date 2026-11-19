import {
  definePlugin,
  extname,
  isInternalPath,
  isLokioError,
  isWithin,
  type LokioPlugin,
  normalizePath,
  type Unsubscribe,
  type Workspace,
} from "@lokio/core";
import type { ChangeEvent } from "@lokio/types";
import { foldWithMap, tokenize } from "./tokenize.js";

export { fold, tokenize } from "./tokenize.js";

export interface SearchOptions {
  /** File extensions to index (case-insensitive). */
  extensions?: string[];
  /** Larger files are skipped. Defaults to 1 MB. */
  maxFileSize?: number;
  /** Default matching mode: every query term must match (`all`) or any (`any`). */
  mode?: "all" | "any";
}

export interface QueryOptions {
  /** Maximum number of results. Defaults to 20. */
  limit?: number;
  /** Only return files at or below this path. */
  path?: string;
  mode?: "all" | "any";
}

export interface SearchResult {
  path: string;
  score: number;
  /** About 80 characters of the original text around the first match. */
  snippet: string;
}

export interface SearchApi {
  /** Resolves once the initial index is built. */
  readonly ready: Promise<void>;
  /** Number of indexed files. */
  readonly size: number;
  query(text: string, options?: QueryOptions): SearchResult[];
  /** Rebuilds the whole index. */
  reindex(): Promise<void>;
  /** Resolves once all queued incremental updates are applied. */
  idle(): Promise<void>;
}

interface Doc {
  text: string;
  length: number;
  terms: Map<string, number>;
}

const DEFAULT_EXTENSIONS = [".md", ".txt", ".json", ".html", ".csv"];
const SNIPPET_LENGTH = 80;

class SearchIndex {
  readonly docs = new Map<string, Doc>();
  private readonly postings = new Map<string, Set<string>>();

  add(path: string, text: string): void {
    this.remove(path);
    const tokens = tokenize(text);
    const terms = new Map<string, number>();
    for (const token of tokens) terms.set(token, (terms.get(token) ?? 0) + 1);
    this.docs.set(path, { text, length: Math.max(1, tokens.length), terms });
    for (const term of terms.keys()) {
      const set = this.postings.get(term) ?? new Set<string>();
      set.add(path);
      this.postings.set(term, set);
    }
  }

  remove(path: string): void {
    const doc = this.docs.get(path);
    if (!doc) return;
    this.docs.delete(path);
    for (const term of doc.terms.keys()) {
      const set = this.postings.get(term);
      set?.delete(path);
      if (set?.size === 0) this.postings.delete(term);
    }
  }

  /** Removes `path` and everything below it. */
  removeTree(path: string): void {
    for (const doc of [...this.docs.keys()]) if (isWithin(path, doc)) this.remove(doc);
  }

  clear(): void {
    this.docs.clear();
    this.postings.clear();
  }

  query(text: string, options: Required<Pick<QueryOptions, "limit" | "mode">> & { path?: string }) {
    const tokens = [...new Set(tokenize(text))];
    if (tokens.length === 0) return [];
    const scope = options.path === undefined ? "" : normalizePath(options.path);
    const total = this.docs.size;
    const scores = new Map<string, number>();
    const matchedBy = new Map<string, number>();

    tokens.forEach((token, index) => {
      const isLast = index === tokens.length - 1;
      const terms = isLast
        ? [...this.postings.keys()].filter((term) => term.startsWith(token))
        : this.postings.has(token)
          ? [token]
          : [];
      const hits = new Set<string>();
      for (const term of terms) {
        const docs = this.postings.get(term)!;
        const idf = Math.log(1 + total / docs.size);
        const weight = term === token ? 1 : 0.5;
        for (const path of docs) {
          const doc = this.docs.get(path)!;
          const tf = doc.terms.get(term)! / doc.length;
          scores.set(path, (scores.get(path) ?? 0) + tf * idf * weight);
          hits.add(path);
        }
      }
      for (const path of hits) matchedBy.set(path, (matchedBy.get(path) ?? 0) + 1);
    });

    const results: SearchResult[] = [];
    for (const [path, score] of scores) {
      if (options.mode === "all" && matchedBy.get(path) !== tokens.length) continue;
      if (!isWithin(scope, path)) continue;
      results.push({ path, score, snippet: snippet(this.docs.get(path)!.text, tokens) });
    }
    return results
      .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
      .slice(0, options.limit);
  }
}

function snippet(text: string, tokens: string[]): string {
  const { folded, map } = foldWithMap(text);
  let first = -1;
  for (const token of tokens) {
    const at = folded.indexOf(token);
    if (at !== -1 && (first === -1 || at < first)) first = at;
  }
  const center = first === -1 ? 0 : map[first]!;
  const start = Math.max(0, center - SNIPPET_LENGTH / 4);
  const end = Math.min(text.length, start + SNIPPET_LENGTH);
  const body = text.slice(start, end).replace(/\s+/g, " ").trim();
  return `${start > 0 ? "…" : ""}${body}${end < text.length ? "…" : ""}`;
}

/**
 * In-memory full-text search over the workspace, kept up to date from
 * workspace change events (local and external).
 *
 * ```ts
 * const search = await workspace.use(searchPlugin());
 * await search.ready;
 * search.query("kun"); // finds "kůň"
 * ```
 */
export function search(options: SearchOptions = {}): LokioPlugin<SearchApi> {
  const extensions = new Set(
    (options.extensions ?? DEFAULT_EXTENSIONS).map((e) => e.toLowerCase()),
  );
  const maxFileSize = options.maxFileSize ?? 1_000_000;
  const index = new SearchIndex();
  let unsubscribe: Unsubscribe | undefined;
  let queue: Promise<void> = Promise.resolve();
  let generation = 0;

  const indexable = (path: string) =>
    !isInternalPath(path) && extensions.has(extname(path).toLowerCase());

  return definePlugin<SearchApi>({
    name: "search",
    setup(workspace: Workspace) {
      const enqueue = (task: () => Promise<void>): Promise<void> => {
        queue = queue.then(task).catch((error: unknown) => {
          queueMicrotask(() => {
            throw error;
          });
        });
        return queue;
      };

      const indexFile = async (path: string, current: number): Promise<void> => {
        if (!indexable(path)) return;
        try {
          const file = workspace.file(path);
          const stat = await file.stat();
          if (stat.kind !== "file" || stat.size > maxFileSize) {
            index.remove(path);
            return;
          }
          const text = await file.readText();
          if (current === generation) index.add(path, text);
        } catch (error) {
          if (!isLokioError(error, "NOT_FOUND")) throw error;
          index.remove(path);
        }
      };

      const indexTree = async (path: string, current: number): Promise<void> => {
        const directory = workspace.directory(path);
        for await (const entry of directory.walk({
          directories: false,
          filter: (e) => !isInternalPath(e.path),
        })) {
          if (current !== generation) return;
          await indexFile(entry.path, current);
        }
      };

      const reindex = () =>
        enqueue(async () => {
          const current = ++generation;
          index.clear();
          await indexTree("", current);
        });

      const onChange = (event: ChangeEvent) =>
        void enqueue(async () => {
          const current = generation;
          if (event.type === "deleted") {
            index.removeTree(event.path);
            return;
          }
          let kind = event.kind;
          if (!kind) {
            try {
              kind = (await workspace.file(event.path).stat()).kind;
            } catch {
              index.removeTree(event.path);
              return;
            }
          }
          if (kind === "directory") await indexTree(event.path, current);
          else await indexFile(event.path, current);
        });

      const ready = reindex();
      unsubscribe = workspace.watch(onChange);

      return {
        ready,
        get size() {
          return index.docs.size;
        },
        query(text, queryOptions = {}) {
          return index.query(text, {
            limit: queryOptions.limit ?? 20,
            mode: queryOptions.mode ?? options.mode ?? "all",
            path: queryOptions.path,
          });
        },
        reindex,
        idle: () => queue,
      };
    },
    dispose() {
      unsubscribe?.();
      unsubscribe = undefined;
      generation++;
      index.clear();
    },
  });
}
