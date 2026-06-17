/**
 * wllm/sync/markdown-import.ts
 *
 * Markdown import: parse .md file → WikiPage.
 * Handles:
 *   - YAML frontmatter
 *   - # Title (H1)
 *   - Body content with [[wikilinks]]
 *
 * Inverse of markdown-export.ts.
 */

import { readFile, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, basename, extname, dirname } from "node:path";
import type { WikiStore } from "../graph/wiki-store.js";
import type { WikiPage, PageType, ConfidenceLevel, EpisodeCategory, EpisodeOutcome, EpisodeDifficulty, DecisionStatus, StructureSubtype, MetaSubtype } from "../types/index.js";
import { slugify } from "../types/index.js";

/**
 * Parse a markdown file into a WikiPage.
 */
export function markdownToPage(content: string, filePath?: string): WikiPage {
  const { frontmatter, body } = parseMarkdown(content);

  // Extract title from H1 or fall back to filename
  let label = "";
  const h1Match = body.match(/^#\s+(.+)$/m);
  if (h1Match) {
    label = h1Match[1].trim();
  } else if (filePath) {
    label = basename(filePath, extname(filePath));
  } else {
    label = "Untitled";
  }

  // Build the page
  const now = Date.now();
  const pageType = (frontmatter.type as PageType) ?? "concept";
  const confidenceLevel = (frontmatter.confidence as ConfidenceLevel) ?? "ASSUMED";

  // Parse sources
  const sources: string[] = Array.isArray(frontmatter.sources) ? frontmatter.sources.map(String) : [];

  // Parse tags
  const tags: string[] = Array.isArray(frontmatter.tags) ? frontmatter.tags.map(String) : [];

  // Parse related
  const related: string[] = Array.isArray(frontmatter.related) ? frontmatter.related.map(String) : [];
  // Also extract [[wikilinks]] from body to populate related
  const wikilinks = extractWikilinks(body);
  for (const link of wikilinks) {
    if (!related.includes(link)) related.push(link);
  }

  // Parse dates
  const created = frontmatter.created ? new Date(frontmatter.created as string).getTime() : now;
  const updated = frontmatter.updated ? new Date(frontmatter.updated as string).getTime() : now;

  // Parse freshness
  const freshness = frontmatter.freshness as any ?? { lastChecked: updated, staleness: "LOW" };

  // Body without the H1
  const bodyWithoutH1 = body.replace(/^#\s+.+\n+/, "").trim();

  // Build the page
  const page: WikiPage = {
    id: (frontmatter.id as string) ?? generateIdFromLabel(label),
    kind: pageType as any,
    pageType,
    label,
    body: bodyWithoutH1,
    properties: frontmatter as any,
    confidence: confidenceWeight(confidenceLevel),
    confidenceLevel,
    freshness,
    sources,
    tags,
    related,
    frontmatter: frontmatter as any,
    subtype: frontmatter.subtype as string | undefined,
    validFrom: created,
    validTo: null,
    recordedAt: updated,
  };

  // Page-type-specific fields
  if (pageType === "episode" || pageType === "failure") {
    if (frontmatter.episodeDate) page.episodeDate = new Date(frontmatter.episodeDate as string).getTime();
    if (frontmatter.duration && typeof frontmatter.duration === "string") {
      const m = frontmatter.duration.match(/(\d+)/);
      if (m) page.episodeDurationMin = parseInt(m[1], 10);
    }
    if (frontmatter.outcome) page.episodeOutcome = frontmatter.outcome as EpisodeOutcome;
    if (frontmatter.difficulty) page.episodeDifficulty = frontmatter.difficulty as EpisodeDifficulty;
    if (Array.isArray(frontmatter.affected_files)) page.episodeAffectedFiles = frontmatter.affected_files.map(String);
    if (Array.isArray(frontmatter.lessons)) page.episodeLessons = frontmatter.lessons.map(String);
  }

  if (pageType === "decision") {
    if (frontmatter.decisionDate) page.decisionDate = new Date(frontmatter.decisionDate as string).getTime();
    if (frontmatter.status) page.decisionStatus = frontmatter.status as DecisionStatus;
    if (frontmatter.revisit) page.decisionRevisit = new Date(frontmatter.revisit as string).getTime();
    if (Array.isArray(frontmatter.stakeholders)) page.decisionStakeholders = frontmatter.stakeholders.map(String);
    if (Array.isArray(frontmatter.alternatives_rejected)) {
      page.decisionAlternativesRejected = frontmatter.alternatives_rejected.map((a: any) => ({
        name: String(a.name ?? ""),
        reason: String(a.reason ?? ""),
      }));
    }
    if (Array.isArray(frontmatter.tradeoffs_accepted)) page.decisionTradeoffsAccepted = frontmatter.tradeoffs_accepted.map(String);
  }

  return page;
}

/**
 * Parse markdown content into frontmatter + body.
 */
function parseMarkdown(content: string): { frontmatter: Record<string, any>; body: string } {
  // Look for --- at start
  if (!content.startsWith("---")) {
    return { frontmatter: {}, body: content };
  }

  // Find the closing ---
  const endIndex = content.indexOf("\n---", 3);
  if (endIndex < 0) {
    return { frontmatter: {}, body: content };
  }

  const frontmatterStr = content.slice(3, endIndex).trim();
  const body = content.slice(endIndex + 4).trim();

  return { frontmatter: parseYaml(frontmatterStr), body };
}

/**
 * Minimal YAML parser focused on our frontmatter needs.
 * Supports: scalars, lists, nested maps (2 levels).
 * NOT a full YAML implementation, but handles our cases.
 */
function parseYaml(yaml: string): Record<string, any> {
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

    // Find the colon that separates key from value
    const colonIdx = line.indexOf(":");
    if (colonIdx < 0) {
      i++;
      continue;
    }

    const key = line.slice(0, colonIdx).trim();
    const rest = line.slice(colonIdx + 1).trim();

    if (rest === "") {
      // Could be a nested map or a list — peek ahead
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
          const value = parseYamlValue(subTrimmed.slice(2));
          subItems.push(value);
        } else if (subTrimmed.includes(":")) {
          isMap = true;
          const subColon = subTrimmed.indexOf(":");
          const subKey = subTrimmed.slice(0, subColon).trim();
          const subVal = subTrimmed.slice(subColon + 1).trim();
          if (subVal) {
            subMap[subKey] = parseYamlValue(subVal);
          } else {
            // Could be nested
            subMap[subKey] = null; // simplified
          }
        }
        j++;
      }
      if (isList) result[key] = subItems;
      else if (isMap) result[key] = subMap;
      else result[key] = null;
      i = j;
    } else {
      result[key] = parseYamlValue(rest);
      i++;
    }
  }

  return result;
}

function parseYamlValue(value: string): any {
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "null" || value === "~") return null;
  if (/^-?\d+$/.test(value)) return parseInt(value, 10);
  if (/^-?\d+\.\d+$/.test(value)) return parseFloat(value);
  // Strip quotes
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function confidenceWeight(level: ConfidenceLevel): number {
  const weights: Record<ConfidenceLevel, number> = {
    VERIFIED: 1.0,
    INFERRED: 0.8,
    ASSUMED: 0.5,
    CONTRADICTED: 0.2,
    RESOLVED: 0.9,
  };
  return weights[level] ?? 0.5;
}

function generateIdFromLabel(label: string): string {
  // Simple hash
  let hash = 0;
  for (let i = 0; i < label.length; i++) {
    hash = ((hash << 5) - hash + label.charCodeAt(i)) | 0;
  }
  return `md-${Math.abs(hash).toString(36)}`;
}

/**
 * Extract [[wikilinks]] from body content.
 * Returns unique linked labels, preferring display text when present.
 *   [[PostgreSQL]] → "PostgreSQL"
 *   [[JWT|json web token]] → "json web token" (display text)
 */
export function extractWikilinks(body: string): string[] {
  const links = new Set<string>();
  // Match [[target|display]] or [[target]]
  const re = /\[\[([^\]|#]+)(?:(?:#[^\]|]*)?\|([^\]]+))?\]\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    // Prefer display text (group 2) if present, else target (group 1)
    const label = (m[2] ?? m[1]).trim();
    if (label) links.add(label);
  }
  return Array.from(links);
}

/**
 * Import a single markdown file into the wiki.
 * Returns the created/updated page.
 */
export async function importMarkdownFile(store: WikiStore, filePath: string): Promise<WikiPage | null> {
  if (!existsSync(filePath)) return null;
  const content = await readFile(filePath, "utf8");
  const page = markdownToPage(content, filePath);

  // Check if page already exists (by id or label)
  const existing = await store.getPage(page.id) ?? await store.getPageByLabel(page.label);

  if (existing) {
    // Update existing
    return await store.updatePage(existing.id, {
      body: page.body,
      confidenceLevel: page.confidenceLevel,
      sources: page.sources,
      tags: page.tags,
      related: page.related,
      frontmatter: page.frontmatter,
    });
  } else {
    // Create new — preserve id from frontmatter so re-imports keep identity
    return await store.createPage({
      id: page.id,
      pageType: page.pageType,
      label: page.label,
      body: page.body,
      confidenceLevel: page.confidenceLevel,
      sources: page.sources,
      tags: page.tags,
      related: page.related,
      frontmatter: page.frontmatter,
      subtype: page.subtype,
      validFrom: page.validFrom,
      // Episode-specific
      episodeDate: page.episodeDate,
      episodeDurationMin: page.episodeDurationMin,
      episodeOutcome: page.episodeOutcome,
      episodeDifficulty: page.episodeDifficulty,
      episodeAffectedFiles: page.episodeAffectedFiles,
      episodeLessons: page.episodeLessons,
      // Decision-specific
      decisionDate: page.decisionDate,
      decisionStatus: page.decisionStatus,
      decisionRevisit: page.decisionRevisit,
      decisionStakeholders: page.decisionStakeholders,
      decisionAlternativesRejected: page.decisionAlternativesRejected,
      decisionTradeoffsAccepted: page.decisionTradeoffsAccepted,
    });
  }
}

/**
 * Recursively import all .md files from a directory.
 */
export async function importMarkdownDir(store: WikiStore, dirPath: string, options: { recursive?: boolean } = {}): Promise<{ imported: number; failed: number }> {
  let imported = 0;
  let failed = 0;

  if (!existsSync(dirPath)) return { imported: 0, failed: 0 };

  const entries = await readdir(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dirPath, entry.name);
    if (entry.isDirectory() && options.recursive) {
      const sub = await importMarkdownDir(store, fullPath, options);
      imported += sub.imported;
      failed += sub.failed;
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      try {
        const result = await importMarkdownFile(store, fullPath);
        if (result) imported++;
        else failed++;
      } catch (e) {
        console.error(`Failed to import ${fullPath}:`, e);
        failed++;
      }
    }
  }

  return { imported, failed };
}
