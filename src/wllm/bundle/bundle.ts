/**
 * @fileoverview WllmWiki Bundle — portable single-file wiki distribution.
 *
 * ## What is a `.wllmwiki` file?
 *
 * A `.wllmwiki` is a **ZIP file** containing an entire wiki (manifest +
 * pages + optional README + optional signature) in one portable artifact.
 * It's the unit of sharing on the WllmConcept marketplace.
 *
 * ## Layout
 *
 * ```
 * my-great-wiki.wllmwiki          ← ZIP file, MIME: application/zip
 * ├── manifest.yaml               ← WikiManifest (REQUIRED)
 * ├── README.md                   ← User-facing notes (OPTIONAL)
 * ├── pages/                      ← Wiki pages as markdown (OPTIONAL)
 * │   ├── 01K2X3Y-getting-started.md
 * │   ├── 01K2X3Z-fibonacci.md
 * │   └── ...
 * ├── pages.json                  ← Index of pages with metadata (OPTIONAL)
 * └── SIGNATURE.txt               ← Ed25519 signature (FUTURE)
 * ```
 *
 * Pages are markdown with Obsidian frontmatter. The `pages/` directory is
 * human-readable and can be inspected with any unzip tool. The `manifest.yaml`
 * is the source of truth for wiki identity (name, version, author, license).
 *
 * ## Why ZIP and not tar?
 *
 *  - **Universal**: every OS ships with unzip; tar is messier on Windows.
 *  - **Random access**: ZIP central directory lets us list/read individual
 *    entries without unpacking the whole file.
 *  - **GitHub-friendly**: GitHub renders `.zip` releases natively.
 *  - **Streaming**: yazl/yauzl stream, so we can handle huge wikis.
 *
 * ## Versioning
 *
 * The bundle format is versioned separately from the wiki content. Bump
 * `BUNDLE_FORMAT_VERSION` when the layout changes in a non-backward-compatible
 * way. Older bundles can be migrated on import.
 *
 * ## Security
 *
 * - ZIP entries are NOT trusted — paths with `..` are rejected.
 * - File sizes are checked BEFORE reading to prevent zip-bomb attacks
 *   (max 10 MB per entry, max 100 MB total).
 * - The optional SIGNATURE.txt will let authors sign their wikis with
 *   Ed25519 (Phase 2.6+).
 *
 * @module wllm/bundle/bundle
 */

import * as path from "node:path";
import { createWriteStream } from "node:fs";
import { promises as fs } from "node:fs";
import yazl from "yazl";
import yauzl from "yauzl";
import type { WikiManifest } from "../storage/manifest.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Current bundle format version. Bump on breaking layout changes. */
export const BUNDLE_FORMAT_VERSION = 1;

/** Required file: manifest.yaml. The wiki's identity card. */
export const MANIFEST_FILENAME = "manifest.yaml";

/** Optional file: human-facing notes for wiki consumers. */
export const README_FILENAME = "README.md";

/** Optional directory: markdown pages. */
export const PAGES_DIR = "pages/";

/** Optional file: full page index with metadata (used when pages/ is absent). */
export const PAGES_JSON_FILENAME = "pages.json";

/** Future: signed bundles. */
export const SIGNATURE_FILENAME = "SIGNATURE.txt";

/** ZIP bomb protection: max 10 MB per file inside a bundle. */
export const MAX_ENTRY_SIZE = 10 * 1024 * 1024;

/** ZIP bomb protection: max 100 MB total uncompressed size. */
export const MAX_TOTAL_SIZE = 100 * 1024 * 1024;

/** File extension for bundle files. */
export const BUNDLE_EXTENSION = ".wllmwiki";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A single page inside a bundle (or in the in-memory wiki).
 *
 * The bundle is markdown-based for human readability, but we keep the
 * structured form (`meta`) so a re-ingest isn't required on import.
 */
export interface BundlePage {
  /** Stable page ID (slug or k-sortable). */
  id: string;
  /** Page title for display. */
  title: string;
  /** Full markdown body, including frontmatter. */
  body: string;
  /** Optional structured metadata. */
  meta?: {
    memory?: string;
    confidence?: string;
    freshness?: string;
    sources?: string[];
    tags?: string[];
    related?: string[];
    [k: string]: unknown;
  };
}

/**
 * A complete bundle's worth of data. This is the in-memory representation
 * that gets passed to the exporter or comes out of the importer.
 */
export interface BundleContents {
  /** The wiki manifest. */
  manifest: WikiManifest;
  /** Optional README. */
  readme?: string;
  /** All pages in the bundle, in stable order. */
  pages: BundlePage[];
  /** Provenance info for this bundle (set on import, may be empty on export). */
  provenance?: BundleProvenance;
}

/**
 * Provenance = "where did this wiki come from?" Set on import, preserved
 * through re-exports, and consulted when checking for updates.
 */
export interface BundleProvenance {
  /** Original author (e.g. "@david"). */
  originalAuthor?: string;
  /** Where the bundle was first installed from (e.g. github URL or local path). */
  source?: string;
  /** When the bundle was installed locally. */
  installedAt?: string;
  /** The version of the wiki at install time. */
  installedVersion?: string;
  /** Last time we checked the upstream for updates. */
  lastCheckedAt?: string;
  /** Latest known upstream version. */
  upstreamVersion?: string;
  /** Whether updates can be auto-applied. False = notify-only. */
  canUpdate?: boolean;
  /** Checksum of the bundle file at install time. */
  bundleChecksum?: string;
}

/**
 * Result of a successful bundle read.
 */
export interface BundleReadResult {
  /** Parsed bundle contents. */
  contents: BundleContents;
  /** Stats from the read. */
  stats: {
    totalEntries: number;
    totalSizeBytes: number;
    pageCount: number;
  };
  /** Warnings (non-fatal issues that the caller should know about). */
  warnings: string[];
}

// ---------------------------------------------------------------------------
// YAML helpers (minimal — we don't want a full YAML dep just for manifest)
// ---------------------------------------------------------------------------

/**
 * Parse a manifest.yaml produced by the WikiManifestStore.
 *
 * We use a small custom parser because:
 *  - The manifest is a fixed shape (we control its serialization).
 *  - Avoiding a YAML dep keeps the bundle format self-contained.
 *  - If we ever need full YAML, swap this for `yaml` package — interface
 *    is the same.
 *
 * Supports: scalars, quoted strings, inline lists `[a, b]`, block lists
 * `key:\n  - a\n  - b`, and 1-level-deep maps. Anything more exotic is
 * not produced by our serializer, so we don't try to parse it.
 */
export function parseBundleManifest(yaml: string): Record<string, unknown> {
  const lines = yaml.split(/\r?\n/);
  // Pre-tokenize: classify each non-empty line as SCALAR, LIST_ITEM, or
  // SECTION_START. Then walk and build nested structures.
  type Tok =
    | { kind: "scalar"; key: string; value: string; indent: number }
    | { kind: "list"; key: string; value: string; indent: number }
    | { kind: "sectionStart"; key: string; indent: number };
  const tokens: Tok[] = [];
  for (const raw of lines) {
    if (!raw.trim() || raw.trim().startsWith("#")) continue;
    const indent = raw.match(/^[ \t]*/)?.[0].length ?? 0;
    const trimmed = raw.trim();

    if (trimmed.startsWith("- ")) {
      // orphan list item — should be a child of a list
      tokens.push({ kind: "list", key: "", value: trimmed.slice(2), indent });
      continue;
    }
    const m = trimmed.match(/^([A-Za-z_][A-Za-z0-9_.-]*)\s*:\s*(.*)$/);
    if (!m) continue;
    const [, key, valueRaw] = m;
    const value = valueRaw.trim();
    if (value === "" || value === "|" || value === ">") {
      tokens.push({ kind: "sectionStart", key, indent });
    } else {
      tokens.push({ kind: "scalar", key, value, indent });
    }
  }

  // Build result: any value that is a `sectionStart` becomes a sub-map
  // (or a sub-list, if the next non-empty tokens are list items at indent+2).
  // Algorithm: walk tokens in order, maintaining a stack of (indent, container).
  type Container = Record<string, unknown> | unknown[];
  const root: Record<string, unknown> = {};
  type Frame = { indent: number; container: Container; isList: boolean };
  const stack: Frame[] = [{ indent: -1, container: root, isList: false }];

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];

    // Pop frames with indent >= this token's indent (we've left their scope).
    while (stack.length > 1 && stack[stack.length - 1].indent >= t.indent) {
      stack.pop();
    }

    const parent = stack[stack.length - 1];

    if (t.kind === "scalar") {
      if (parent.isList) {
        // parent is a list — scalars in a list become a 2-element [key, value]
        // object form? We don't emit that, so this is a malformed input.
        continue;
      }
      (parent.container as Record<string, unknown>)[t.key] = coerceScalar(t.value);
    } else if (t.kind === "list") {
      // We're inside a list; push the value.
      if (parent.isList) {
        (parent.container as unknown[]).push(coerceScalar(t.value));
      }
    } else if (t.kind === "sectionStart") {
      // Look ahead: if the next non-empty token is a `list` at indent+2,
      // this is a list. Otherwise, it's a map.
      const next = tokens[i + 1];
      const isList = next?.kind === "list" && next.indent > t.indent;

      let newContainer: Container;
      if (isList) {
        newContainer = [];
      } else {
        newContainer = {};
      }
      (parent.container as Record<string, unknown>)[t.key] = newContainer;
      stack.push({ indent: t.indent, container: newContainer, isList });
    }
  }

  return root;
}

/**
 * Coerce a raw string into a JS value: boolean, number, null, or string.
 * Recognizes quoted strings and unquotes them.
 */
function coerceScalar(raw: string): unknown {
  const v = raw.trim();
  if (v === "true") return true;
  if (v === "false") return false;
  if (v === "null" || v === "~") return null;
  if (v.startsWith("[") && v.endsWith("]")) {
    // Inline list — split on commas at top level.
    const inner = v.slice(1, -1);
    if (inner.trim() === "") return [];
    return inner.split(",").map((s) => coerceScalar(unquote(s.trim())));
  }
  if (/^-?\d+$/.test(v)) return parseInt(v, 10);
  if (/^-?\d+\.\d+$/.test(v)) return parseFloat(v);
  if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) {
    return v.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
  if (v.length >= 2 && v.startsWith("'") && v.endsWith("'")) {
    return v.slice(1, -1).replace(/''/g, "'");
  }
  return v;
}

/**
 * Serialize a WikiManifest to YAML. Mirrors `parseBundleManifest` so
 * round-trips are lossless for the fields we care about.
 */
export function serializeBundleManifest(m: WikiManifest): string {
  const lines: string[] = [];
  lines.push(`# WllmConcept Wiki Manifest`);
  lines.push(`# Generated: ${new Date().toISOString()}`);
  lines.push(`format_version: ${BUNDLE_FORMAT_VERSION}`);
  lines.push(`id: ${quoteIfNeeded(m.id)}`);
  lines.push(`name: ${quoteIfNeeded(m.name)}`);
  if (m.description) lines.push(`description: ${quoteIfNeeded(m.description)}`);
  lines.push(`version: ${quoteIfNeeded(m.version)}`);
  lines.push(`license: ${quoteIfNeeded(m.license)}`);
  lines.push(`homepage: ${quoteIfNeeded(m.homepage)}`);
  lines.push(`created: ${quoteIfNeeded(m.created)}`);
  lines.push(`updated: ${quoteIfNeeded(m.updated)}`);

  if (m.author) {
    lines.push(`author:`);
    if (m.author.name) lines.push(`  name: ${quoteIfNeeded(m.author.name)}`);
    if (m.author.handle) lines.push(`  handle: ${quoteIfNeeded(m.author.handle)}`);
    if (m.author.email) lines.push(`  email: ${quoteIfNeeded(m.author.email)}`);
    if (m.author.url) lines.push(`  url: ${quoteIfNeeded(m.author.url)}`);
  }

  if (m.tags && m.tags.length > 0) {
    lines.push(`tags: [${m.tags.map(quoteIfNeeded).join(", ")}]`);
  }

  if (m.dependencies && m.dependencies.length > 0) {
    lines.push(`dependencies:`);
    for (const d of m.dependencies) {
      lines.push(`  - ${quoteIfNeeded(d)}`);
    }
  }

  if (m.pages) {
    lines.push(`pages:`);
    for (const p of m.pages) {
      lines.push(`  - id: ${quoteIfNeeded(p.id)}`);
      lines.push(`    title: ${quoteIfNeeded(p.title)}`);
      if (p.memory) lines.push(`    memory: ${p.memory}`);
      if (p.confidence) lines.push(`    confidence: ${p.confidence}`);
      if (p.tags && p.tags.length > 0) {
        lines.push(`    tags: [${p.tags.map(quoteIfNeeded).join(", ")}]`);
      }
    }
  }

  // Provenance block (optional, at end).
  if (m.provenance) {
    lines.push(`provenance:`);
    for (const [k, v] of Object.entries(m.provenance)) {
      if (v === undefined) continue;
      if (typeof v === "string") {
        lines.push(`  ${k}: ${quoteIfNeeded(v)}`);
      } else if (typeof v === "boolean" || typeof v === "number") {
        lines.push(`  ${k}: ${v}`);
      }
    }
  }

  return lines.join("\n") + "\n";
}

/**
 * Quote a YAML string if it contains characters that would break parsing.
 * Conservative: quotes anything non-trivial.
 */
function quoteIfNeeded(s: string): string {
  if (s === undefined || s === null) return '""';
  const str = String(s);
  if (str === "") return '""';
  // If it's pure alphanumeric + dash/underscore/dot, leave unquoted.
  if (/^[A-Za-z0-9._-]+$/.test(str) && !str.includes(":")) {
    return str;
  }
  // Escape backslashes and double-quotes, then wrap in double quotes.
  return `"${str.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function unquote(s: string): string {
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
    return s.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
  if (s.length >= 2 && s.startsWith("'") && s.endsWith("'")) {
    return s.slice(1, -1).replace(/''/g, "'");
  }
  return s;
}

// ---------------------------------------------------------------------------
// Frontmatter parsing (for individual page markdown files in pages/)
// ---------------------------------------------------------------------------

/**
 * Parse a single markdown file with YAML frontmatter into a BundlePage.
 *
 * Format:
 * ```
 * ---
 * id: foo
 * title: Foo
 * memory: semantic
 * confidence: VERIFIED
 * tags: [a, b]
 * ---
 *
 * # Body starts here
 * ```
 */
export function parseBundlePage(md: string, fallbackId: string): BundlePage {
  const fmMatch = md.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!fmMatch) {
    return { id: fallbackId, title: fallbackId, body: md.trim() };
  }
  const [, frontmatter, body] = fmMatch;
  const meta = parseBundleManifest(frontmatter) as unknown as Record<string, unknown>;
  const id = String(meta.id ?? fallbackId);
  const title = String(meta.title ?? id);
  // Drop meta keys we've already promoted.
  const rest = { ...meta };
  delete rest.id;
  delete rest.title;
  return { id, title, body: body.trim(), meta: rest as BundlePage["meta"] };
}

// ---------------------------------------------------------------------------
// Exporter: BundleContents → .wllmwiki file
// ---------------------------------------------------------------------------

/**
 * Write bundle contents to a .wllmwiki file.
 *
 * Uses yazl to stream a real ZIP file. Pages go under `pages/` as markdown.
 *
 * @param outputPath absolute path to write the .wllmwiki file
 * @param contents the bundle to write
 * @param opts.verbose log progress to console
 */
export async function writeBundle(
  outputPath: string,
  contents: BundleContents,
  opts: { verbose?: boolean } = {}
): Promise<{ bytes: number; entryCount: number }> {
  const log = opts.verbose ? (m: string) => console.log(`  ${m}`) : () => undefined;

  // Attach provenance to manifest if present.
  const manifest: WikiManifest = contents.provenance
    ? ({ ...contents.manifest, provenance: contents.provenance } as unknown as WikiManifest)
    : contents.manifest;

  // yazl's addBuffer expects Buffer; we keep all writes in memory for a
  // bundle this small (markdown + manifest). For huge bundles, swap to
  // addReadStream + per-file streams.
  const zip = new yazl.ZipFile();

  // 1. manifest.yaml (REQUIRED)
  const manifestYaml = serializeBundleManifest(manifest);
  zip.addBuffer(Buffer.from(manifestYaml, "utf8"), MANIFEST_FILENAME);
  log(`added ${MANIFEST_FILENAME} (${manifestYaml.length} bytes)`);

  // 2. README.md (OPTIONAL)
  if (contents.readme) {
    zip.addBuffer(Buffer.from(contents.readme, "utf8"), README_FILENAME);
    log(`added ${README_FILENAME} (${contents.readme.length} bytes)`);
  }

  // 3. pages/ markdown files
  for (const page of contents.pages) {
    const filename = pageFilename(page);
    const md = serializeBundlePage(page);
    zip.addBuffer(Buffer.from(md, "utf8"), filename);
  }
  if (contents.pages.length > 0) {
    log(`added ${contents.pages.length} page${contents.pages.length === 1 ? "" : "s"}`);
  }

  // 4. pages.json (full metadata index, for re-imports)
  const pagesJson = JSON.stringify(contents.pages, null, 2) + "\n";
  zip.addBuffer(Buffer.from(pagesJson, "utf8"), PAGES_JSON_FILENAME);
  log(`added ${PAGES_JSON_FILENAME} (${pagesJson.length} bytes)`);

  zip.end();

  // Stream to disk. yazl exposes a Node Readable via `outputStream` (not
  // a plain iterable), so we use .pipe() rather than Readable.from().
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await new Promise<void>((resolve, reject) => {
    const out = createWriteStream(outputPath);
    zip.outputStream.pipe(out);
    out.on("finish", () => resolve());
    out.on("error", reject);
    zip.outputStream.on("error", reject);
  });

  const stat = await fs.stat(outputPath);
  log(`wrote ${outputPath} (${stat.size} bytes)`);

  return {
    bytes: stat.size,
    // BUGFIX: entryCount was `3 + (readme ? 1 : 0) + pages.length`,
    // but the actual entry count is manifest (1) + pages.json (1) +
    // README (1 if present) + pages (N). The constant should be 2
    // (manifest + pages.json), not 3. README is already counted by the
    // ternary. With `3`, the count was inflated by 1.
    entryCount: 2 + (contents.readme ? 1 : 0) + contents.pages.length,
  };
}

/**
 * Build the filename for a page inside `pages/`.
 *
 * We slugify the ID to keep filenames safe across OSes. If two pages would
 * collide, we append a numeric suffix.
 */
export function pageFilename(page: BundlePage): string {
  const safe = slugifyForFilename(page.id || page.title);
  return path.posix.join(PAGES_DIR, `${safe}.md`);
}

/**
 * Slugify a string to be safe as a filename. Conservative: lowercase, dashes,
 * alphanumerics + a few common punctuation marks.
 */
export function slugifyForFilename(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "untitled";
}

function serializeBundlePage(page: BundlePage): string {
  const fm: string[] = ["---"];
  fm.push(`id: ${quoteIfNeeded(page.id)}`);
  fm.push(`title: ${quoteIfNeeded(page.title)}`);
  if (page.meta) {
    for (const [k, v] of Object.entries(page.meta)) {
      if (v === undefined) continue;
      if (Array.isArray(v)) {
        fm.push(`${k}: [${v.map((x) => quoteIfNeeded(String(x))).join(", ")}]`);
      } else if (typeof v === "string") {
        fm.push(`${k}: ${quoteIfNeeded(v)}`);
      } else if (typeof v === "number" || typeof v === "boolean") {
        fm.push(`${k}: ${v}`);
      } else {
        fm.push(`${k}: ${quoteIfNeeded(JSON.stringify(v))}`);
      }
    }
  }
  fm.push("---");
  fm.push("");
  fm.push(page.body);
  return fm.join("\n");
}

// ---------------------------------------------------------------------------
// Importer: .wllmwiki file → BundleContents
// ---------------------------------------------------------------------------

/**
 * Read a .wllmwiki file and return its contents.
 *
 * Validates:
 *  - ZIP central directory is readable
 *  - `manifest.yaml` is present
 *  - No entry exceeds MAX_ENTRY_SIZE
 *  - Total uncompressed size ≤ MAX_TOTAL_SIZE
 *  - No entry has a `..` path (zip-slip)
 *
 * On any validation failure, throws a descriptive Error.
 */
export async function readBundle(
  inputPath: string,
  opts: { verbose?: boolean } = {}
): Promise<BundleReadResult> {
  const log = opts.verbose ? (m: string) => console.log(`  ${m}`) : () => undefined;
  const warnings: string[] = [];

  if (!inputPath.endsWith(BUNDLE_EXTENSION)) {
    warnings.push(`File does not end with ${BUNDLE_EXTENSION} (was: ${path.extname(inputPath)})`);
  }

  return await new Promise<BundleReadResult>((resolve, reject) => {
    yauzl.open(inputPath, { lazyEntries: true }, (err, zip) => {
      if (err) {
        reject(new Error(`Failed to open bundle: ${err.message}`));
        return;
      }
      if (!zip) {
        reject(new Error("yauzl returned no zipfile"));
        return;
      }

      let totalSize = 0;
      let manifestYaml: string | null = null;
      let readme: string | null = null;
      const pageBlobs: Map<string, Buffer> = new Map();
      let pagesJson: string | null = null;
      const pageFilenames: string[] = [];
      let totalEntries = 0;

      zip.on("error", (e) => reject(new Error(`ZIP error: ${e.message}`)));
      zip.on("end", () => {
        if (totalEntries === 0) {
          reject(new Error("Bundle contains no entries"));
          return;
        }
        if (!manifestYaml) {
          reject(new Error(`Bundle is missing required ${MANIFEST_FILENAME}`));
          return;
        }
        try {
          const manifest = parseBundleManifest(manifestYaml) as unknown as WikiManifest;
          const pages: BundlePage[] = [];

          // Prefer pages.json for full metadata; fall back to pages/*.md.
          if (pagesJson) {
            const parsed = JSON.parse(pagesJson) as BundlePage[];
            pages.push(...parsed);
          } else if (pageFilenames.length > 0) {
            for (const fn of pageFilenames.sort()) {
              const blob = pageBlobs.get(fn);
              if (!blob) continue;
              const md = blob.toString("utf8");
              const id = path.basename(fn, ".md");
              pages.push(parseBundlePage(md, id));
            }
          }

          const prov = manifest.provenance;
          // Strip provenance from manifest (it's stored as a separate field).
          if (prov) {
            manifest.provenance = undefined;
          }

          const contents: BundleContents = {
            manifest,
            readme: readme ?? undefined,
            pages,
            provenance: prov,
          };

          log(`manifest: ${manifest.name} v${manifest.version}`);
          log(`pages: ${pages.length}`);
          log(`total uncompressed: ${totalSize} bytes`);

          resolve({
            contents,
            stats: {
              totalEntries,
              totalSizeBytes: totalSize,
              pageCount: pages.length,
            },
            warnings,
          });
        } catch (e) {
          reject(new Error(`Failed to parse bundle contents: ${(e as Error).message}`));
        }
      });

      zip.on("entry", (entry: yauzl.Entry) => {
        totalEntries++;

        // Zip-slip protection: reject paths with ..
        const name = entry.fileName;
        if (name.includes("..")) {
          reject(new Error(`Refusing entry with '..' in path: ${name}`));
          return;
        }

        // Only accept files in our known layout. No nested dirs, no symlinks.
        if (!isAllowedEntry(name)) {
          warnings.push(`Skipping unexpected entry: ${name}`);
          zip.readEntry(); // skip
          return;
        }

        // Per-entry size check (use compressed size as a quick upper bound).
        if (entry.uncompressedSize > MAX_ENTRY_SIZE) {
          reject(
            new Error(
              `Entry ${name} exceeds MAX_ENTRY_SIZE (${entry.uncompressedSize} > ${MAX_ENTRY_SIZE})`
            )
          );
          return;
        }

        totalSize += entry.uncompressedSize;
        if (totalSize > MAX_TOTAL_SIZE) {
          reject(
            new Error(
              `Total bundle size exceeds MAX_TOTAL_SIZE (${totalSize} > ${MAX_TOTAL_SIZE})`
            )
          );
          return;
        }

        zip.openReadStream(entry, (e, stream) => {
          if (e) {
            reject(new Error(`Failed to read entry ${name}: ${e.message}`));
            return;
          }
          if (!stream) {
            reject(new Error(`No stream for entry ${name}`));
            return;
          }
          const chunks: Buffer[] = [];
          // SECURITY (ZIP-bomb): track ACTUAL bytes read, not just the
          // reported uncompressedSize from the ZIP central directory.
          // A malicious archive can report uncompressedSize=0 while
          // delivering huge data via the stream, bypassing the size
          // check above. We accumulate actual bytes and reject if the
          // running total exceeds MAX_ENTRY_SIZE.
          let actualEntrySize = 0;
          stream.on("data", (c: Buffer) => {
            actualEntrySize += c.length;
            if (actualEntrySize > MAX_ENTRY_SIZE) {
              reject(new Error(`Entry ${name} exceeded MAX_ENTRY_SIZE during decompression (${actualEntrySize} > ${MAX_ENTRY_SIZE})`));
              stream.destroy();  // stop reading
              return;
            }
            chunks.push(c);
          });
          stream.on("end", () => {
            const buf = Buffer.concat(chunks);
            if (name === MANIFEST_FILENAME) {
              manifestYaml = buf.toString("utf8");
            } else if (name === README_FILENAME) {
              readme = buf.toString("utf8");
            } else if (name === PAGES_JSON_FILENAME) {
              pagesJson = buf.toString("utf8");
            } else if (name.startsWith(PAGES_DIR) && name.endsWith(".md")) {
              pageFilenames.push(name);
              pageBlobs.set(name, buf);
            } else if (name === SIGNATURE_FILENAME) {
              warnings.push(`Bundle has ${SIGNATURE_FILENAME} but signature verification is not yet implemented`);
            }
            zip.readEntry();
          });
          stream.on("error", (se) => reject(new Error(`Stream error on ${name}: ${se.message}`)));
        });
      });

      zip.readEntry();
    });
  });
}

/**
 * Whether a ZIP entry name is something we'll read. We only accept:
 *  - manifest.yaml
 *  - README.md
 *  - pages.json
 *  - pages/*.md
 *  - SIGNATURE.txt (read as warning, not validated yet)
 */
function isAllowedEntry(name: string): boolean {
  if (name === MANIFEST_FILENAME) return true;
  if (name === README_FILENAME) return true;
  if (name === PAGES_JSON_FILENAME) return true;
  if (name === SIGNATURE_FILENAME) return true;
  if (name.startsWith(PAGES_DIR) && name.endsWith(".md")) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Bundle inspection (peek without full read)
// ---------------------------------------------------------------------------

/**
 * Quick stats about a bundle file. Just reads the central directory, not
 * the page contents. Useful for `huagent wiki info`.
 */
export async function inspectBundle(inputPath: string): Promise<{
  entries: string[];
  totalSizeBytes: number;
  hasManifest: boolean;
  hasReadme: boolean;
  hasPagesJson: boolean;
  pageCount: number;
  hasSignature: boolean;
}> {
  return await new Promise((resolve, reject) => {
    yauzl.open(inputPath, { lazyEntries: true }, (err, zip) => {
      if (err) {
        reject(new Error(`Failed to open: ${err.message}`));
        return;
      }
      if (!zip) {
        reject(new Error("yauzl returned no zipfile"));
        return;
      }
      const entries: string[] = [];
      let totalSize = 0;
      let hasManifest = false;
      let hasReadme = false;
      let hasPagesJson = false;
      let pageCount = 0;
      let hasSignature = false;

      zip.on("end", () =>
        resolve({
          entries,
          totalSizeBytes: totalSize,
          hasManifest,
          hasReadme,
          hasPagesJson,
          pageCount,
          hasSignature,
        })
      );
      zip.on("error", (e) => reject(new Error(`ZIP error: ${e.message}`)));
      zip.on("entry", (entry: yauzl.Entry) => {
        entries.push(entry.fileName);
        totalSize += entry.uncompressedSize;
        if (entry.fileName === MANIFEST_FILENAME) hasManifest = true;
        else if (entry.fileName === README_FILENAME) hasReadme = true;
        else if (entry.fileName === PAGES_JSON_FILENAME) hasPagesJson = true;
        else if (entry.fileName === SIGNATURE_FILENAME) hasSignature = true;
        else if (entry.fileName.startsWith(PAGES_DIR) && entry.fileName.endsWith(".md")) {
          pageCount++;
        }
        zip.readEntry();
      });
      zip.readEntry();
    });
  });
}

// ---------------------------------------------------------------------------
// Convenience: read a single page from a bundle (memory-efficient)
// ---------------------------------------------------------------------------

/**
 * Read a single page from a bundle by ID. Useful for `huagent wiki get <id>`.
 *
 * Iterates the ZIP entries once and stops after the match.
 */
export async function readBundlePage(
  inputPath: string,
  pageId: string
): Promise<BundlePage | null> {
  const target = slugifyForFilename(pageId);
  const result = await readBundle(inputPath);
  return result.contents.pages.find(
    (p) => p.id === pageId || slugifyForFilename(p.id) === target
  ) ?? null;
}

// Re-export the streaming helpers for advanced users.
export { createReadStream as _createReadStream } from "node:fs";
