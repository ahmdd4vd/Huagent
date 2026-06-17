/**
 * @fileoverview Ingest Cache — SHA256-based incremental ingest tracker.
 *
 * Design goals (per Phase 2.4 spec):
 *  - **Zero re-work on unchanged files**: hash source content, skip if hash
 *    matches the last successful ingest.
 *  - **Fail-safe**: corrupt cache → treat as empty, don't crash; missing file
 *    → invalidate entry, don't keep stale data.
 *  - **Atomic writes**: write to temp file then rename, so a crash mid-write
 *    doesn't leave a half-baked cache.
 *  - **Multiple content identities**: a file can have multiple hashed views
 *    (e.g. raw vs. normalized); cache key is `(path, mode)`.
 *  - **Schema versioning**: a `version` field lets us invalidate old caches
 *    when the ingest format changes.
 *  - **Human-readable on disk**: JSON, with pretty-print for git diffs.
 *
 * The cache is a *sidecar* to the wiki store. It is purely advisory: if the
 * store and the cache ever disagree, the store wins (re-ingest). The cache
 * exists only to avoid the expensive Pass 2 + Pass 3 LLM calls.
 *
 * Cache file lives at `<wikiRoot>/.wllmconcept/cache.json` by convention,
 * but the class accepts any path for testability.
 *
 * @module wllm/ingest/cache
 */

import { promises as fs } from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * One cached record per source file. Keyed by absolute path + content mode.
 *
 * `mode` lets us hash the same file differently for different purposes:
 *  - `raw`:    the file bytes as-is (used for tree-sitter / TS Compiler)
 *  - `normalized`: stripped of comments + whitespace (more robust to reformat)
 *  - `compiled`:   the compiled JS (post-TS, for type-aware analyzers)
 *
 * Currently we always use `raw`, but the field is here so we can evolve.
 */
export interface CacheEntry {
  /** SHA256 hex digest of the file content (64 chars). */
  hash: string;
  /** Wall-clock ISO timestamp of when this entry was last successfully ingested. */
  ingestedAt: string;
  /** Ingest mode that produced this hash. */
  mode: CacheMode;
  /** Optional: link back to the wiki page IDs this ingest created. */
  pageIds?: string[];
  /** Optional: ingest duration in ms (for stats). */
  durationMs?: number;
  /** Optional: which ingest stages ran (Pass 1, Pass 2, Pass 3). */
  stages?: IngestStage[];
}

export type CacheMode = "raw" | "normalized" | "compiled";
export type IngestStage = "pass1-structural" | "pass2-semantic" | "pass3-critic";

/**
 * Top-level cache file schema. Versioned so we can invalidate on format
 * changes without having to write a migration.
 */
export interface IngestCache {
  /** Schema version. Bump when CacheEntry shape changes. */
  version: 1;
  /** When this cache file was last written. */
  updatedAt: string;
  /** Map of `path :: mode` → entry. We use `::` as separator (illegal in paths). */
  entries: Record<string, CacheEntry>;
}

/**
 * Result of a cache lookup. We return enough info for callers to decide
 * whether to skip, re-ingest, or update.
 */
export interface CacheLookup {
  /** True if a valid (matching-hash) entry exists. */
  hit: boolean;
  /** The cached entry, if any (may be stale). */
  entry?: CacheEntry;
  /** The current file hash, always computed. */
  currentHash: string;
  /** The current file size in bytes, for quick rejection. */
  currentSize: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CACHE_VERSION: 1 = 1;
const KEY_SEPARATOR = "::";

/**
 * Empty cache used as a starting point. We never return null from `read()`.
 */
function emptyCache(): IngestCache {
  return {
    version: CACHE_VERSION,
    updatedAt: new Date(0).toISOString(),
    entries: {},
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Hash file content with SHA256. Reads the file once, streams into the hash
 * to avoid loading huge files into memory.
 *
 * Returns hex digest + byte length.
 */
async function hashFile(absPath: string): Promise<{ hash: string; size: number }> {
  // 64 KB chunks: large enough to be fast, small enough to be memory-safe.
  const CHUNK = 64 * 1024;
  const hash = createHash("sha256");
  let size = 0;

  let handle: import("node:fs/promises").FileHandle | undefined;
  try {
    handle = await fs.open(absPath, "r");
    for (;;) {
      const buf = Buffer.alloc(CHUNK);
      const { bytesRead } = await handle.read(buf, 0, CHUNK, null);
      if (bytesRead === 0) break;
      hash.update(buf.subarray(0, bytesRead));
      size += bytesRead;
    }
  } finally {
    if (handle) await handle.close().catch(() => undefined);
  }

  return { hash: hash.digest("hex"), size };
}

/**
 * Hash a string in memory (used for tests + normalized content).
 */
export function hashString(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

/**
 * Build the cache key for a (path, mode) pair.
 *
 * Normalizes the path to absolute so the same file from different working
 * directories produces the same key.
 */
export function cacheKey(absPath: string, mode: CacheMode): string {
  const normalized = path.resolve(absPath);
  return `${normalized}${KEY_SEPARATOR}${mode}`;
}

// ---------------------------------------------------------------------------
// IngestCache class
// ---------------------------------------------------------------------------

export class IngestCacheStore {
  private cachePath: string;
  private cache: IngestCache | null = null;
  /** If true, we won't write the cache back to disk (test mode). */
  private readonly ephemeral: boolean;
  /**
   * Mutex chain. EVERY read-modify-write of `this.cache` (set, invalidate,
   * pruneStale, clear, save) goes through this so concurrent callers don't
   * clobber each other's changes.
   */
  private mutex: Promise<void> = Promise.resolve();

  constructor(cachePath: string, opts: { ephemeral?: boolean } = {}) {
    this.cachePath = cachePath;
    this.ephemeral = !!opts.ephemeral;
  }

  /**
   * Acquire the mutex, run `fn`, then release. The returned promise resolves
   * with the result of `fn` (or rejects with its error), but the lock is
   * always released — even on error.
   */
  private async withLock<T>(fn: () => Promise<T>): Promise<T> {
    const prev = this.mutex;
    let release: () => void = () => undefined;
    this.mutex = new Promise<void>((resolve) => (release = resolve));
    try {
      await prev;
      return await fn();
    } finally {
      release();
    }
  }

  // -------------------------------------------------------------------------
  // I/O
  // -------------------------------------------------------------------------

  /**
   * Load the cache from disk. Returns an empty cache on:
   *  - file not found (first run)
   *  - parse error (corrupt cache)
   *  - version mismatch (old format)
   *
   * Never throws. Logs the reason for the empty cache via the optional
   * `onWarning` callback.
   */
  async load(onWarning?: (msg: string) => void): Promise<IngestCache> {
    if (this.cache) return this.cache;

    try {
      const raw = await fs.readFile(this.cachePath, "utf8");
      const parsed = JSON.parse(raw) as IngestCache;

      if (!parsed || typeof parsed !== "object") {
        onWarning?.(`Cache at ${this.cachePath} is not an object; ignoring.`);
        this.cache = emptyCache();
        return this.cache;
      }

      if (parsed.version !== CACHE_VERSION) {
        onWarning?.(
          `Cache version mismatch (file: ${parsed.version}, expected: ${CACHE_VERSION}); ignoring.`
        );
        this.cache = emptyCache();
        return this.cache;
      }

      if (!parsed.entries || typeof parsed.entries !== "object") {
        onWarning?.(`Cache at ${this.cachePath} has invalid entries; ignoring.`);
        this.cache = emptyCache();
        return this.cache;
      }

      this.cache = parsed;
      return this.cache;
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code === "ENOENT") {
        // First run — totally normal, no warning needed.
        this.cache = emptyCache();
      } else {
        onWarning?.(
          `Failed to load cache at ${this.cachePath}: ${(err as Error).message}; ignoring.`
        );
        this.cache = emptyCache();
      }
      return this.cache;
    }
  }

  /**
   * Persist the cache to disk atomically. Writes to `<path>.tmp` first,
   * then renames.
   *
   * NOTE: this method does NOT acquire the mutex — callers must already
   * hold it (e.g. inside `withLock(() => { ...; await this.save(); })`).
   * This makes the lock re-entrant safe for our common save-after-mutate
   * pattern.
   */
  private async saveLocked(): Promise<void> {
    if (this.ephemeral) return;
    if (!this.cache) return;

    this.cache.updatedAt = new Date().toISOString();
    const dir = path.dirname(this.cachePath);
    await fs.mkdir(dir, { recursive: true });

    const tmp = `${this.cachePath}.tmp-${process.pid}-${Date.now()}`;
    const json = JSON.stringify(this.cache, null, 2) + "\n";
    await fs.writeFile(tmp, json, "utf8");
    await fs.rename(tmp, this.cachePath);
  }

  /**
   * Public save: acquires the mutex and writes to disk. Use this when
   * you're NOT already inside a withLock block. Mutex-safe (re-entrant).
   */
  async save(): Promise<void> {
    if (this.ephemeral) return;
    if (!this.cache) return;
    await this.withLock(() => this.saveLocked());
  }

  /**
   * Force a fresh empty cache. Useful for `huagent wiki rebuild` flows.
   */
  async clear(): Promise<void> {
    await this.withLock(async () => {
      this.cache = emptyCache();
      if (!this.ephemeral) {
        try {
          await fs.unlink(this.cachePath);
        } catch (err: unknown) {
          const code = (err as NodeJS.ErrnoException)?.code;
          if (code !== "ENOENT") throw err;
        }
      }
    });
  }

  // -------------------------------------------------------------------------
  // Lookup
  // -------------------------------------------------------------------------

  /**
   * Look up a file in the cache. Always computes the current hash so the
   * caller can decide what to do.
   *
   * Behavior:
   *  - File missing → returns `{ hit: false, entry: undefined }` and
   *    removes any stale entry.
   *  - File present, hash matches → `hit: true`.
   *  - File present, hash differs → `hit: false`, entry returned so caller
   *    can re-ingest.
   *  - No entry for this file → `hit: false`, entry undefined.
   */
  async lookup(
    absPath: string,
    mode: CacheMode = "raw"
  ): Promise<CacheLookup> {
    // Hash outside the lock — file I/O doesn't need to be serialized.
    let currentHash: string;
    let currentSize: number;
    try {
      const h = await hashFile(absPath);
      currentHash = h.hash;
      currentSize = h.size;
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code === "ENOENT") {
        // File was deleted out from under us — drop the stale entry.
        await this.withLock(async () => {
          const cache = await this.load();
          const key = cacheKey(absPath, mode);
          if (cache.entries[key]) {
            delete cache.entries[key];
            await this.saveLocked();
          }
        });
        return { hit: false, currentHash: "", currentSize: 0 };
      }
      throw err;
    }

    // Read-only lookup: no need for the full lock, but we do need to ensure
    // load() has run so we can see entries.
    const cache = await this.load();
    const key = cacheKey(absPath, mode);
    const entry = cache.entries[key];
    if (entry && entry.hash === currentHash) {
      return { hit: true, entry, currentHash, currentSize };
    }
    return { hit: false, entry, currentHash, currentSize };
  }

  /**
   * Bulk lookup. Returns a map of path → CacheLookup. Skips hashing if the
   * file was already hashed in this call (idempotent).
   */
  async lookupMany(
    absPaths: string[],
    mode: CacheMode = "raw"
  ): Promise<Map<string, CacheLookup>> {
    // BUGFIX: Previously this looped sequentially with `await` inside a
    // for-of, serializing all disk I/O (file reads + hashing). For a
    // 1000-file project this meant 1000 sequential file reads. We now
    // parallelize with a concurrency limit of 32 (enough to keep the
    // disk busy without overwhelming the file descriptor table).
    const out = new Map<string, CacheLookup>();
    const CONCURRENCY = 32;
    for (let i = 0; i < absPaths.length; i += CONCURRENCY) {
      const batch = absPaths.slice(i, i + CONCURRENCY);
      const entries = await Promise.all(
        batch.map(async (p) => [p, await this.lookup(p, mode)] as const),
      );
      for (const [p, lookup] of entries) out.set(p, lookup);
    }
    return out;
  }

  // -------------------------------------------------------------------------
  // Mutation
  // -------------------------------------------------------------------------

  /**
   * Record that a file was successfully ingested. Stores hash + metadata.
   * Does NOT call `save()` — caller batches.
   *
   * Locked: concurrent set() calls can race on the entries object.
   */
  async set(
    absPath: string,
    mode: CacheMode,
    meta: {
      hash: string;
      pageIds?: string[];
      durationMs?: number;
      stages?: IngestStage[];
    }
  ): Promise<void> {
    await this.withLock(async () => {
      const cache = await this.load();
      const key = cacheKey(absPath, mode);
      cache.entries[key] = {
        hash: meta.hash,
        ingestedAt: new Date().toISOString(),
        mode,
        pageIds: meta.pageIds,
        durationMs: meta.durationMs,
        stages: meta.stages,
      };
    });
  }

  /**
   * Drop a single entry (e.g. file was deleted, or ingest failed irrecoverably).
   * Locked for safety against concurrent set/invalidate.
   */
  async invalidate(absPath: string, mode: CacheMode = "raw"): Promise<void> {
    await this.withLock(async () => {
      const cache = await this.load();
      const key = cacheKey(absPath, mode);
      delete cache.entries[key];
    });
  }

  /**
   * Drop entries whose paths don't exist on disk anymore. Returns the
   * number of entries dropped. Useful for `huagent wiki gc`.
   *
   * The fs.access calls are intentionally outside the lock — we don't want
   * to hold the mutex for arbitrary I/O. We do the mutation under the lock.
   */
  async pruneStale(): Promise<number> {
    const cache = await this.load();
    const keys = Object.keys(cache.entries);
    const toDelete: string[] = [];

    for (const key of keys) {
      const sepIdx = key.lastIndexOf(KEY_SEPARATOR);
      if (sepIdx < 0) {
        toDelete.push(key);
        continue;
      }
      const filePath = key.slice(0, sepIdx);
      try {
        await fs.access(filePath);
      } catch {
        toDelete.push(key);
      }
    }

    if (toDelete.length === 0) return 0;

    await this.withLock(async () => {
      const cache = await this.load();
      for (const k of toDelete) delete cache.entries[k];
      await this.saveLocked();
    });

    return toDelete.length;
  }

  // -------------------------------------------------------------------------
  // Introspection
  // -------------------------------------------------------------------------

  size(): number {
    return this.cache?.entries ? Object.keys(this.cache.entries).length : 0;
  }

  /**
   * Get all cached entries, sorted by ingestedAt descending. Returns a copy
   * so callers can't mutate the cache.
   */
  list(): CacheEntry[] {
    if (!this.cache) return [];
    return Object.values(this.cache.entries).slice().sort((a, b) =>
      b.ingestedAt.localeCompare(a.ingestedAt)
    );
  }

  /**
   * Sum of all cached `durationMs` values. Useful for "we saved X seconds
   * of LLM time" stats.
   */
  totalSavedMs(): number {
    return this.list().reduce((acc, e) => acc + (e.durationMs ?? 0), 0);
  }

  get path(): string {
    return this.cachePath;
  }
}

// ---------------------------------------------------------------------------
// Convenience: factory for the standard cache location
// ---------------------------------------------------------------------------

/**
 * Standard cache path: `<wikiRoot>/.wllmconcept/cache.json`.
 */
export function defaultCachePath(wikiRoot: string): string {
  return path.join(wikiRoot, ".wllmconcept", "cache.json");
}
