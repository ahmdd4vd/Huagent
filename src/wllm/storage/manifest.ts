/**
 * wllm/storage/manifest.ts
 *
 * Wiki manifest: the "cover page" of a wiki that identifies it for sharing.
 *
 * The manifest is stored in `.wllmconcept/wiki.yaml` and contains:
 *   - name: human-readable wiki name
 *   - id: globally unique identifier (namespace:slug format)
 *   - version: semver for marketplace updates
 *   - author: who made this
 *   - license: distribution terms (MIT default)
 *   - description, tags, category: for marketplace discovery
 *   - github: source repo URL (for marketplace)
 *   - provenance: per-page source tracking
 *   - dependencies: what this wiki assumes (libraries, etc.)
 *
 * Why this matters for marketplace:
 *   - A wiki without manifest = anonymous, can't be shared
 *   - Manifest = ISBN/copyright page of a book
 *   - GitHub topic "wllm-wiki" + manifest = discoverable
 */

import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { WikiStore } from "../graph/wiki-store.js";

/**
 * Wiki manifest schema.
 */
export interface WikiManifest {
  /** Human-readable name (e.g., "PostgreSQL Mastery Guide") */
  name: string;
  /** Globally unique ID in namespace:slug format (e.g., "wllm:david-postgres") */
  id: string;
  /** Semver version (e.g., "1.2.0") */
  version: string;
  /** Author info */
  author: {
    name: string;
    handle?: string;          // GitHub handle like "@david"
    email?: string;
    url?: string;             // Personal/blog URL
  };
  /** License (MIT default, but Apache 2.0, CC-BY-SA also valid) */
  license: "MIT" | "Apache-2.0" | "CC-BY-SA-4.0" | "GPL-3.0" | "Proprietary" | string;
  /** Short description (1-2 sentences) */
  description: string;
  /** Long description (markdown, optional) */
  longDescription?: string;
  /** Tags for search/discovery */
  tags: string[];
  /** Category (e.g., "backend", "frontend", "devops", "domain-fintech") */
  category: string;
  /** GitHub repo URL (if published to GitHub) */
  github?: string;
  /** Homepage URL (optional) */
  homepage?: string;
  /** What this wiki assumes (e.g., ["PostgreSQL 14+", "Node 20+"]) */
  dependencies: string[];
  /** Minimum huagent version required (e.g., "4.0.0") */
  minHuagentVersion?: string;
  /** When this manifest was created */
  created: string;
  /** When this manifest was last updated */
  updated: string;
  /**
   * Optional page summary index. The full pages live in `pages.json` /
   * `pages/*.md` inside a bundle; this is a lightweight list for manifest
   * inspection without unpacking the bundle.
   */
  pages?: Array<{
    id: string;
    title: string;
    memory?: string;
    confidence?: string;
    tags?: string[];
  }>;
  /**
   * Optional bundle-level provenance. Set when the bundle is imported from
   * a marketplace source. Preserved through re-exports.
   */
  provenance?: BundleProvenance;
}

/**
 * Bundle-level provenance — where did this wiki come from?
 * Lives on the manifest as `provenance` and is preserved across exports.
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
 * Per-page provenance — where did this page come from?
 */
export interface PageProvenance {
  /** Source identifier: "local" | "github:user/repo@version" | "import:filename" */
  source: string;
  /** When was this page installed/created */
  installed: string;
  /** Original author (for credit) */
  originalAuthor?: string;
  /** Upstream version (for update detection) */
  upstreamVersion?: string;
  /** When was this last synced with upstream */
  lastSynced?: string;
  /** Can this be auto-updated? */
  canUpdate: boolean;
}

/**
 * Default manifest template.
 */
export function createDefaultManifest(overrides: Partial<WikiManifest> = {}): WikiManifest {
  const now = new Date().toISOString();
  return {
    name: "Untitled Wiki",
    id: "wllm:local-untitled",
    version: "0.1.0",
    author: {
      name: "Anonymous",
    },
    license: "MIT",
    description: "A new wiki created with WllmConcept.",
    tags: [],
    category: "general",
    dependencies: [],
    created: now,
    updated: now,
    ...overrides,
  };
}

/**
 * Generate a manifest from current wiki state.
 * Useful when creating a manifest for the first time.
 */
export async function generateManifestFromWiki(
  store: WikiStore,
  baseOptions: Partial<WikiManifest> = {}
): Promise<WikiManifest> {
  const stats = await store.getStats();
  const allPages = await store.listAll();

  // Auto-detect category from most common page type
  const pageTypeCounts: Record<string, number> = {};
  for (const p of allPages) {
    pageTypeCounts[p.pageType] = (pageTypeCounts[p.pageType] ?? 0) + 1;
  }
  const dominantType = Object.entries(pageTypeCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "concept";

  // Auto-suggest category
  const categoryMap: Record<string, string> = {
    entity: "reference",
    concept: "patterns",
    decision: "architecture",
    episode: "debugging",
    structure: "code-analysis",
    meta: "self-improvement",
  };

  // Auto-suggest tags from most common tags
  const tagCounts: Record<string, number> = {};
  for (const p of allPages) {
    for (const t of p.tags) {
      tagCounts[t] = (tagCounts[t] ?? 0) + 1;
    }
  }
  const topTags = Object.entries(tagCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([tag]) => tag);

  return createDefaultManifest({
    description: `Wiki with ${stats.totalPages} pages across ${Object.values(stats.byMemory).filter(c => c > 0).length} memory systems.`,
    category: categoryMap[dominantType] ?? "general",
    tags: topTags,
    ...baseOptions,
  });
}

/**
 * ManifestManager — handles read/write/parse of wiki.yaml.
 */
export class ManifestManager {
  constructor(private readonly manifestPath: string) {}

  /**
   * Check if a manifest exists.
   */
  exists(): boolean {
    return existsSync(this.manifestPath);
  }

  /**
   * Read and parse the manifest.
   * Returns null if the file doesn't exist or is invalid.
   */
  async read(): Promise<WikiManifest | null> {
    if (!this.exists()) return null;
    try {
      const content = await readFile(this.manifestPath, "utf8");
      return parseManifest(content);
    } catch (e) {
      console.error(`Failed to read manifest: ${e}`);
      return null;
    }
  }

  /**
   * Write the manifest to disk.
   */
  async write(manifest: WikiManifest): Promise<void> {
    manifest.updated = new Date().toISOString();
    const yaml = manifestToYaml(manifest);
    await writeFile(this.manifestPath, yaml, { encoding: "utf8" });
  }

  /**
   * Update an existing manifest (or create if missing).
   */
  async update(patch: Partial<WikiManifest>): Promise<WikiManifest> {
    const current = (await this.read()) ?? createDefaultManifest();
    // Ensure required fields have defaults so YAML doesn't fail
    const safeCurrent: WikiManifest = {
      ...createDefaultManifest(),
      ...current,
    };
    const updated: WikiManifest = {
      ...safeCurrent,
      ...patch,
      // Deep-merge author (so partial author updates don't lose fields)
      author: { ...safeCurrent.author, ...(patch.author ?? {}) },
      updated: new Date().toISOString(),
    };
    await this.write(updated);
    return updated;
  }

  /**
   * Create a manifest from wiki state if none exists.
   */
  async ensureExists(store: WikiStore, defaults: Partial<WikiManifest> = {}): Promise<WikiManifest> {
    const existing = await this.read();
    if (existing) return existing;
    const generated = await generateManifestFromWiki(store, defaults);
    await this.write(generated);
    return generated;
  }
}

/**
 * Parse a YAML manifest string.
 * Minimal YAML parser focused on our schema.
 */
export function parseManifest(yaml: string): WikiManifest {
  const lines = yaml.split("\n");
  const result: Record<string, any> = {};
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      i++;
      continue;
    }

    const colonIdx = line.indexOf(":");
    if (colonIdx < 0) {
      i++;
      continue;
    }

    const key = line.slice(0, colonIdx).trim();
    const rest = line.slice(colonIdx + 1).trim();

    if (rest === "") {
      // Nested structure
      const subItems: any[] = [];
      const subMap: Record<string, any> = {};
      let isList = false;
      let isMap = false;
      let j = i + 1;
      while (j < lines.length) {
        const subLine = lines[j];
        if (!subLine.trim()) { j++; continue; }
        if (!subLine.startsWith(" ") && !subLine.startsWith("\t")) break;
        const subTrimmed = subLine.trim();
        if (subTrimmed.startsWith("- ")) {
          isList = true;
          // For simple lists (strings), just take the value
          const value = parseYamlValue(subTrimmed.slice(2));
          subItems.push(value);
        } else if (subTrimmed.includes(":")) {
          isMap = true;
          const subColon = subTrimmed.indexOf(":");
          const subKey = subTrimmed.slice(0, subColon).trim();
          const subVal = subTrimmed.slice(subColon + 1).trim();
          subMap[subKey] = subVal ? parseYamlValue(subVal) : null;
        }
        j++;
      }
      if (isList) result[key] = subItems;
      else if (isMap) result[key] = subMap;
      i = j;
    } else {
      result[key] = parseYamlValue(rest);
      i++;
    }
  }

  return result as WikiManifest;
}

function parseYamlValue(value: string): any {
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "null" || value === "~") return null;
  if (/^-?\d+$/.test(value)) return parseInt(value, 10);
  if (/^-?\d+\.\d+$/.test(value)) return parseFloat(value);
  if ((value.startsWith('"') && value.endsWith('"'))) {
    // BUGFIX: Unescape `\"` → `"` and `\\` → `\` inside double-quoted
    // strings. The previous code only stripped the outer quotes, so
    // `\"hello\"` round-tripped as `\"hello\"` (literal backslashes).
    return value.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
  if (value.startsWith("'") && value.endsWith("'")) {
    // Single-quoted YAML: '' is the only escape (represents a literal ').
    return value.slice(1, -1).replace(/''/g, "'");
  }
  return value;
}

/**
 * Serialize a manifest to YAML.
 */
export function manifestToYaml(m: WikiManifest): string {
  const lines: string[] = [];
  lines.push("# WllmConcept Wiki Manifest");
  lines.push(`# Generated: ${new Date().toISOString()}`);
  lines.push("");
  lines.push(`name: ${yamlStr(m.name)}`);
  lines.push(`id: ${yamlStr(m.id)}`);
  lines.push(`version: ${yamlStr(m.version)}`);

  lines.push("author:");
  lines.push(`  name: ${yamlStr(m.author.name)}`);
  if (m.author.handle) lines.push(`  handle: ${yamlStr(m.author.handle)}`);
  if (m.author.email) lines.push(`  email: ${yamlStr(m.author.email)}`);

  lines.push(`license: ${yamlStr(m.license)}`);
  lines.push(`description: ${yamlStr(m.description)}`);
  if (m.longDescription) lines.push(`longDescription: ${yamlStr(m.longDescription)}`);

  if (m.tags && m.tags.length > 0) {
    lines.push("tags:");
    for (const t of m.tags) lines.push(`  - ${yamlStr(t)}`);
  }

  lines.push(`category: ${yamlStr(m.category)}`);

  if (m.github) lines.push(`github: ${yamlStr(m.github)}`);
  if (m.homepage) lines.push(`homepage: ${yamlStr(m.homepage)}`);

  if (m.dependencies && m.dependencies.length > 0) {
    lines.push("dependencies:");
    for (const d of m.dependencies) lines.push(`  - ${yamlStr(d)}`);
  }

  if (m.minHuagentVersion) lines.push(`minHuagentVersion: ${yamlStr(m.minHuagentVersion)}`);
  lines.push(`created: ${yamlStr(m.created)}`);
  lines.push(`updated: ${yamlStr(m.updated)}`);

  return lines.join("\n") + "\n";
}

function yamlStr(s: string): string {
  if (/[:#\[\]{}|>&*!%@`,]/.test(s) || s.startsWith("-") || s.startsWith("?") || s.includes("\n") || s !== s.trim()) {
    // BUGFIX: Escape `\` → `\\` BEFORE `"` → `\"`. The previous order
    // (`"` → `\"` first) caused `\"` to become `\\"` (literal backslash
    // + quote) which YAML parsers misread. Correct order: backslash
    // first, then quote.
    const escaped = s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
    return `"${escaped}"`;
  }
  return s;
}

/**
 * Validate a manifest has required fields.
 */
export function validateManifest(m: WikiManifest): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!m.name) errors.push("Missing 'name'");
  if (!m.id) errors.push("Missing 'id'");
  if (!m.id?.includes(":")) errors.push("'id' must be in 'namespace:slug' format");
  if (!m.version) errors.push("Missing 'version'");
  if (!m.author?.name) errors.push("Missing 'author.name'");
  if (!m.license) errors.push("Missing 'license'");
  if (!m.description) errors.push("Missing 'description'");
  if (!m.category) errors.push("Missing 'category'");
  if (!m.created) errors.push("Missing 'created'");
  if (!m.updated) errors.push("Missing 'updated'");

  return { valid: errors.length === 0, errors };
}

/**
 * Create a unique page ID with namespace prefix.
 * This is for marketplace: prevents collisions when multiple wikis have similar pages.
 */
export function namespacedPageId(wikiId: string, pageSlug: string): string {
  return `${wikiId}:${pageSlug}`;
}

/**
 * Extract the wiki ID from a namespaced page ID.
 */
export function extractWikiId(namespacedId: string): string | null {
  const parts = namespacedId.split(":");
  if (parts.length < 2) return null;
  // wiki ID can have : in it too (e.g., github:user/repo)
  // so take everything except the last part as the wiki ID
  return parts.slice(0, -1).join(":");
}

/**
 * Extract the page slug from a namespaced page ID.
 */
export function extractPageSlug(namespacedId: string): string | null {
  const parts = namespacedId.split(":");
  if (parts.length < 2) return null;
  return parts[parts.length - 1];
}
