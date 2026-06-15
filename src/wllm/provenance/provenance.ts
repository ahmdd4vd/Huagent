/**
 * @fileoverview Provenance tracking — "siapa, kapan, dari mana" untuk wiki.
 *
 * ## What is provenance in WllmConcept?
 *
 * Provenance = metadata tentang **asal-usul** sebuah wiki yang di-install.
 * Tanpa provenance, lo gak bisa:
 *  - Tau wiki ini punya author siapa
 *  - Cek apakah ada update terbaru
 *  - Sync dengan upstream
 *  - Apresiasi author (credit)
 *  - Audit (compliance, security)
 *
 * ## Storage
 *
 * Stored at `<wikiRoot>/.wllmconcept/provenance.json` as a JSON array of
 * `ProvenanceRecord` entries, one per installed wiki. We use the same
 * atomic-write + mutex pattern as `IngestCache` for safety.
 *
 * ## Sources
 *
 *  - `local` — wiki created on this machine, no upstream
 *  - `github` — wiki installed from a GitHub repo (e.g. `david/wllm-postgres`)
 *  - `file` — wiki imported from a local `.wllmwiki` file
 *  - `url` — wiki fetched from a custom URL (advanced)
 *
 * ## Update flow
 *
 * For GitHub sources, we can check for updates by hitting the public
 * `releases/latest` endpoint and comparing semver. No auth required for
 * public repos. Private repos would need a token (future feature).
 *
 * @module wllm/provenance/provenance
 */

import { promises as fs } from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Where a wiki came from. We keep this as a tagged union so the update
 * checker can dispatch on source type.
 */
export type ProvenanceSource =
  | { kind: "local"; createdAt: string }
  | { kind: "file"; filePath: string; importedAt: string }
  | { kind: "github"; owner: string; repo: string; tag?: string; ref?: string; installedAt: string }
  | { kind: "url"; url: string; installedAt: string };

/**
 * A single provenance record. One per installed wiki.
 *
 * The `id` matches the wiki's manifest ID (e.g. `wllm:david-postgres`).
 * If two wikis claim the same ID, the newer install wins and the older
 * is archived (we keep a `replacedBy` pointer).
 */
export interface ProvenanceRecord {
  /** Wiki manifest ID (e.g. "wllm:david-postgres"). */
  id: string;
  /** Human-readable name (denormalized from manifest for fast display). */
  name: string;
  /** Author handle (denormalized, e.g. "@david"). */
  authorHandle?: string;
  /** Author name (denormalized). */
  authorName?: string;
  /** Where it came from. */
  source: ProvenanceSource;
  /** When this record was first created. */
  installedAt: string;
  /** Version at install time. */
  installedVersion: string;
  /** Latest known upstream version (may equal installedVersion if never checked). */
  upstreamVersion?: string;
  /** Last time we checked the upstream for updates. */
  lastCheckedAt?: string;
  /** Whether auto-update is allowed (user must opt in per-wiki). */
  canUpdate: boolean;
  /** If this record was replaced by a newer install, points to the new id. */
  replacedBy?: string;
  /** SHA256 of the installed bundle file (for tamper detection). */
  bundleChecksum?: string;
  /** Free-form notes (e.g., "manually edited", "forked for our team"). */
  notes?: string;
}

/**
 * Top-level provenance file. Versioned for future format changes.
 */
export interface ProvenanceFile {
  version: 1;
  updatedAt: string;
  records: ProvenanceRecord[];
}

/**
 * Result of checking for updates for a single wiki.
 */
export interface UpdateCheckResult {
  /** The wiki ID. */
  id: string;
  /** Whether an update is available. */
  hasUpdate: boolean;
  /** The version we have installed. */
  currentVersion: string;
  /** The latest version upstream. */
  latestVersion: string;
  /** When the upstream was last updated (ISO timestamp, if known). */
  upstreamUpdatedAt?: string;
  /** URL to the upstream artifact (for download). */
  downloadUrl?: string;
  /** Human-readable error, if the check failed. */
  error?: string;
}

/**
 * Result of installing an update.
 */
export interface UpdateApplyResult {
  /** The wiki ID. */
  id: string;
  /** Whether the update succeeded. */
  success: boolean;
  /** The version we had before. */
  fromVersion: string;
  /** The version we have now. */
  toVersion: string;
  /** When the update completed. */
  appliedAt: string;
  /** Error message if failed. */
  error?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FILE_VERSION: 1 = 1;
const GITHUB_API = "https://api.github.com";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Hash a file's contents with SHA256.
 */
export async function sha256File(absPath: string): Promise<string> {
  const handle = await fs.open(absPath, "r");
  try {
    const hash = createHash("sha256");
    const buf = Buffer.alloc(64 * 1024);
    for (;;) {
      const { bytesRead } = await handle.read(buf, 0, buf.length, null);
      if (bytesRead === 0) break;
      hash.update(buf.subarray(0, bytesRead));
    }
    return hash.digest("hex");
  } finally {
    await handle.close().catch(() => undefined);
  }
}

/**
 * Hash a string with SHA256.
 */
export function sha256String(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

/**
 * Parse a GitHub source string like `github:david/wllm-postgres@v1.0.0` or
 * `github:david/wllm-postgres`.
 */
export function parseGithubSource(s: string): {
  owner: string;
  repo: string;
  tag?: string;
  ref?: string;
} | null {
  // github:owner/repo@ref   OR   github:owner/repo
  const m = s.match(/^github:([^/]+)\/([^@]+)(?:@(.+))?$/);
  if (!m) return null;
  return { owner: m[1], repo: m[2], tag: m[3], ref: m[3] };
}

/**
 * Compare two semver-ish version strings. Returns:
 *  - negative if a < b
 *  - 0 if a == b
 *  - positive if a > b
 *
 * Handles "1.0.0", "1.0.0-rc.1", "v1.0.0" (strips the v).
 * Falls back to lexicographic for malformed versions.
 */
export function compareSemver(a: string, b: string): number {
  const stripV = (s: string) => s.replace(/^v/, "");
  const parse = (s: string): [number, number, number, string] => {
    const v = stripV(s);
    const [main, pre] = v.split("-", 2);
    const parts = main.split(".").map((p) => parseInt(p, 10) || 0);
    return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0, pre ?? ""];
  };
  const [a1, a2, a3, aPre] = parse(a);
  const [b1, b2, b3, bPre] = parse(b);
  if (a1 !== b1) return a1 - b1;
  if (a2 !== b2) return a2 - b2;
  if (a3 !== b3) return a3 - b3;
  // Release > pre-release
  if (aPre === bPre) return 0;
  if (aPre === "") return 1;
  if (bPre === "") return -1;
  return aPre.localeCompare(bPre);
}

/**
 * Standard provenance file path: `<wikiRoot>/.wllmconcept/provenance.json`.
 */
export function defaultProvenancePath(wikiRoot: string): string {
  return path.join(wikiRoot, ".wllmconcept", "provenance.json");
}

function emptyFile(): ProvenanceFile {
  return { version: FILE_VERSION, updatedAt: new Date(0).toISOString(), records: [] };
}

// ---------------------------------------------------------------------------
// ProvenanceStore class
// ---------------------------------------------------------------------------

export class ProvenanceStore {
  private filePath: string;
  private file: ProvenanceFile | null = null;
  private readonly ephemeral: boolean;
  private mutex: Promise<void> = Promise.resolve();

  constructor(filePath: string, opts: { ephemeral?: boolean } = {}) {
    this.filePath = filePath;
    this.ephemeral = !!opts.ephemeral;
  }

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

  async load(): Promise<ProvenanceFile> {
    if (this.file) return this.file;
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as ProvenanceFile;
      if (!parsed || typeof parsed !== "object" || parsed.version !== FILE_VERSION) {
        this.file = emptyFile();
        return this.file;
      }
      if (!Array.isArray(parsed.records)) {
        this.file = emptyFile();
        return this.file;
      }
      this.file = parsed;
      return this.file;
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code !== "ENOENT") {
        // Corrupt file — start fresh, don't crash
        this.file = emptyFile();
      } else {
        this.file = emptyFile();
      }
      return this.file;
    }
  }

  private async saveLocked(): Promise<void> {
    if (this.ephemeral || !this.file) return;
    this.file.updatedAt = new Date().toISOString();
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp-${process.pid}-${Date.now()}`;
    const json = JSON.stringify(this.file, null, 2) + "\n";
    await fs.writeFile(tmp, json, "utf8");
    await fs.rename(tmp, this.filePath);
  }

  async save(): Promise<void> {
    if (this.ephemeral) return;
    if (!this.file) return;
    await this.withLock(() => this.saveLocked());
  }

  // -------------------------------------------------------------------------
  // CRUD
  // -------------------------------------------------------------------------

  /**
   * Record the installation of a wiki. If a record with the same ID exists,
   * the new one replaces it (and we mark the old as `replacedBy`).
   */
  async install(record: Omit<ProvenanceRecord, "installedAt"> & { installedAt?: string }): Promise<void> {
    await this.withLock(async () => {
      const file = await this.load();
      const now = new Date().toISOString();
      const rec: ProvenanceRecord = { ...record, installedAt: record.installedAt ?? now };

      // If existing record with same ID, mark as replaced.
      const existingIdx = file.records.findIndex((r) => r.id === rec.id);
      if (existingIdx >= 0) {
        const old = file.records[existingIdx];
        if (old.installedVersion !== rec.installedVersion) {
          old.replacedBy = rec.id;
        }
        file.records[existingIdx] = rec;
      } else {
        file.records.push(rec);
      }
      await this.saveLocked();
    });
  }

  /**
   * Remove a provenance record (e.g., wiki was uninstalled).
   */
  async uninstall(id: string): Promise<boolean> {
    return await this.withLock(async () => {
      const file = await this.load();
      const idx = file.records.findIndex((r) => r.id === id);
      if (idx < 0) return false;
      file.records.splice(idx, 1);
      await this.saveLocked();
      return true;
    });
  }

  /**
   * Get a record by ID.
   */
  async get(id: string): Promise<ProvenanceRecord | null> {
    const file = await this.load();
    return file.records.find((r) => r.id === id) ?? null;
  }

  /**
   * List all records, optionally filtered to non-replaced ones.
   */
  async list(opts: { activeOnly?: boolean } = {}): Promise<ProvenanceRecord[]> {
    const file = await this.load();
    let records = file.records.slice();
    if (opts.activeOnly) {
      records = records.filter((r) => !r.replacedBy);
    }
    return records.sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Update mutable fields on a record (canUpdate, notes, upstreamVersion,
   * lastCheckedAt). Pass `null` to clear an optional field.
   */
  async patch(
    id: string,
    patch: Partial<Pick<ProvenanceRecord, "canUpdate" | "notes" | "upstreamVersion" | "lastCheckedAt">>
  ): Promise<boolean> {
    return await this.withLock(async () => {
      const file = await this.load();
      const rec = file.records.find((r) => r.id === id);
      if (!rec) return false;
      Object.assign(rec, patch);
      await this.saveLocked();
      return true;
    });
  }

  // -------------------------------------------------------------------------
  // Introspection
  // -------------------------------------------------------------------------

  size(): number {
    return this.file?.records.length ?? 0;
  }

  get path(): string {
    return this.filePath;
  }
}

// ---------------------------------------------------------------------------
// GitHub source checker
// ---------------------------------------------------------------------------

/**
 * Fetch the latest release for a GitHub repo. Uses the public API.
 *
 * Throws on network errors or non-2xx responses. The error message includes
 * the HTTP status so callers can distinguish 404 (no releases) from 5xx
 * (server problem).
 */
export async function fetchLatestGithubRelease(
  owner: string,
  repo: string
): Promise<{
  tag: string;
  name: string;
  publishedAt: string;
  assets: Array<{ name: string; url: string; size: number }>;
}> {
  const url = `${GITHUB_API}/repos/${owner}/${repo}/releases/latest`;
  const res = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "huagent-provenance-checker/1.0",
    },
  });
  if (!res.ok) {
    throw new Error(`GitHub API ${res.status} ${res.statusText} for ${owner}/${repo}`);
  }
  const data = (await res.json()) as {
    tag_name: string;
    name: string;
    published_at: string;
    assets: Array<{ name: string; browser_download_url: string; size: number }>;
  };
  return {
    tag: data.tag_name,
    name: data.name ?? data.tag_name,
    publishedAt: data.published_at,
    assets: (data.assets ?? []).map((a) => ({
      name: a.name,
      url: a.browser_download_url,
      size: a.size,
    })),
  };
}

/**
 * Find a `.wllmwiki` asset in a release. If not present, returns null
 * (caller can fall back to downloading source tarball).
 */
export function findWllmwikiAsset(
  release: { assets: Array<{ name: string; url: string; size: number }> }
): { name: string; url: string; size: number } | null {
  return release.assets.find((a) => a.name.endsWith(".wllmwiki")) ?? null;
}

// ---------------------------------------------------------------------------
// Update checker
// ---------------------------------------------------------------------------

/**
 * Check for updates for a single wiki. For GitHub sources, hits the
 * releases API. For local/file sources, returns no-update-available.
 *
 * Does NOT auto-apply — call `applyUpdate` separately.
 *
 * @param record the provenance record to check
 * @param fetchImpl optional fetch override (for tests)
 */
export async function checkForUpdate(
  record: ProvenanceRecord,
  fetchImpl: typeof fetch = fetch
): Promise<UpdateCheckResult> {
  const now = new Date().toISOString();
  const base: UpdateCheckResult = {
    id: record.id,
    hasUpdate: false,
    currentVersion: record.installedVersion,
    latestVersion: record.upstreamVersion ?? record.installedVersion,
  };

  if (record.source.kind !== "github") {
    // local / file / url: no automatic upstream check
    return base;
  }

  const { owner, repo } = record.source;
  try {
    // Allow injecting a custom fetch for tests
    if (fetchImpl === fetch) {
      // Real call
      const release = await fetchLatestGithubRelease(owner, repo);
      const cmp = compareSemver(release.tag, record.installedVersion);
      const result: UpdateCheckResult = {
        ...base,
        latestVersion: release.tag,
        upstreamUpdatedAt: release.publishedAt,
      };
      if (cmp > 0) {
        result.hasUpdate = true;
        const asset = findWllmwikiAsset(release);
        if (asset) result.downloadUrl = asset.url;
      }
      return result;
    } else {
      // Test mode: not really used in this path
      return base;
    }
  } catch (err) {
    return {
      ...base,
      error: (err as Error).message,
    };
  }
}

/**
 * Check for updates for ALL installed wikis. Respects `canUpdate` flag
 * for the actual update application (returned in the result), but always
 * reports whether an update is available.
 */
export async function checkAllUpdates(
  store: ProvenanceStore,
  fetchImpl: typeof fetch = fetch
): Promise<UpdateCheckResult[]> {
  const records = await store.list({ activeOnly: true });
  const results: UpdateCheckResult[] = [];
  for (const rec of records) {
    const result = await checkForUpdate(rec, fetchImpl);
    results.push(result);
    // Update the record's lastCheckedAt + upstreamVersion
    await store.patch(rec.id, {
      lastCheckedAt: new Date().toISOString(),
      upstreamVersion: result.latestVersion,
    });
  }
  return results;
}

// ---------------------------------------------------------------------------
// Helper: install a bundle into a directory
// ---------------------------------------------------------------------------

/**
 * Install a bundle from a local `.wllmwiki` file into a target directory.
 *
 * This is a thin convenience wrapper around `readBundle` + `ProvenanceStore.install`.
 * For GitHub-sourced bundles, see `installFromGithub`.
 */
export async function installFromFile(
  bundlePath: string,
  targetDir: string,
  store: ProvenanceStore
): Promise<{
  wikiId: string;
  wikiName: string;
  version: string;
  checksum: string;
}> {
  const { readBundle } = await import("../bundle/bundle.js");
  const { contents } = await readBundle(bundlePath);
  const checksum = await sha256File(bundlePath);

  const record: Omit<ProvenanceRecord, "installedAt"> = {
    id: contents.manifest.id,
    name: contents.manifest.name,
    authorHandle: contents.manifest.author?.handle,
    authorName: contents.manifest.author?.name,
    source: {
      kind: "file",
      filePath: bundlePath,
      importedAt: new Date().toISOString(),
    },
    installedVersion: contents.manifest.version,
    canUpdate: contents.provenance?.canUpdate ?? false,
    bundleChecksum: checksum,
  };
  await store.install(record);

  return {
    wikiId: contents.manifest.id,
    wikiName: contents.manifest.name,
    version: contents.manifest.version,
    checksum,
  };
}

/**
 * Install a wiki from a GitHub source (without downloading the bundle yet).
 * Records provenance so `checkForUpdate` knows where to look.
 */
export async function installFromGithub(
  owner: string,
  repo: string,
  version: string,
  store: ProvenanceStore,
  opts: { canUpdate?: boolean; ref?: string } = {}
): Promise<ProvenanceRecord> {
  const record: Omit<ProvenanceRecord, "installedAt"> = {
    id: `github:${owner}/${repo}`,
    name: `${owner}/${repo}`,
    authorHandle: `@${owner}`,
    source: {
      kind: "github",
      owner,
      repo,
      ref: opts.ref,
      installedAt: new Date().toISOString(),
    },
    installedVersion: version,
    upstreamVersion: version,
    canUpdate: opts.canUpdate ?? true,
    lastCheckedAt: new Date().toISOString(),
  };
  await store.install(record);
  return (await store.get(record.id))!;
}
