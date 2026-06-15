/**
 * wllm/sync/markdown-export.ts
 *
 * Markdown export: convert WikiPage → Obsidian-compatible .md file.
 *
 * Format:
 *   ---
 *   type: ...
 *   confidence: ...
 *   created: ...
 *   updated: ...
 *   sources: [...]
 *   tags: [...]
 *   related: [...]
 *   ... (page-type-specific fields)
 *   ---
 *
 *   # Page Title
 *
 *   Body content with [[wikilinks]] preserved.
 */

import { writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import type { WikiStore } from "../graph/wiki-store.js";
import type { WikiPage, PageType } from "../types/index.js";
import { pageToFilePath, slugify } from "../types/index.js";

/**
 * Convert a WikiPage to markdown with frontmatter.
 */
export function pageToMarkdown(page: WikiPage): string {
  const frontmatter = buildFrontmatter(page);
  const body = page.body ?? "";
  return `${frontmatter}\n# ${page.label}\n\n${body}\n`;
}

/**
 * Build YAML frontmatter for a page.
 */
function buildFrontmatter(page: WikiPage): string {
  const lines: string[] = ["---"];

  // Universal fields
  lines.push(`type: ${page.pageType}`);
  lines.push(`id: ${page.id}`);
  lines.push(`confidence: ${page.confidenceLevel}`);
  lines.push(`created: ${new Date(page.validFrom).toISOString()}`);
  lines.push(`updated: ${new Date(page.recordedAt).toISOString()}`);

  if (page.subtype) {
    lines.push(`subtype: ${page.subtype}`);
  }

  if (page.sources.length > 0) {
    lines.push(`sources:`);
    for (const s of page.sources) {
      lines.push(`  - ${yamlEscape(s)}`);
    }
  }

  if (page.tags.length > 0) {
    lines.push(`tags:`);
    for (const t of page.tags) {
      lines.push(`  - ${yamlEscape(t)}`);
    }
  }

  if (page.related.length > 0) {
    lines.push(`related:`);
    for (const r of page.related) {
      lines.push(`  - ${yamlEscape(r)}`);
    }
  }

  // Page-type-specific fields
  if (page.pageType === "episode" || page.pageType === "failure") {
    if (page.episodeDate) lines.push(`episodeDate: ${new Date(page.episodeDate).toISOString()}`);
    if (page.episodeDurationMin !== undefined) lines.push(`duration: ${page.episodeDurationMin}min`);
    if (page.episodeOutcome) lines.push(`outcome: ${page.episodeOutcome}`);
    if (page.episodeDifficulty) lines.push(`difficulty: ${page.episodeDifficulty}`);
    if (page.episodeAffectedFiles && page.episodeAffectedFiles.length > 0) {
      lines.push(`affected_files:`);
      for (const f of page.episodeAffectedFiles) {
        lines.push(`  - ${yamlEscape(f)}`);
      }
    }
    if (page.episodeLessons && page.episodeLessons.length > 0) {
      lines.push(`lessons:`);
      for (const l of page.episodeLessons) {
        lines.push(`  - ${yamlEscape(l)}`);
      }
    }
  }

  if (page.pageType === "decision") {
    if (page.decisionDate) lines.push(`decisionDate: ${new Date(page.decisionDate).toISOString()}`);
    if (page.decisionStatus) lines.push(`status: ${page.decisionStatus}`);
    if (page.decisionRevisit) lines.push(`revisit: ${new Date(page.decisionRevisit).toISOString()}`);
    if (page.decisionStakeholders && page.decisionStakeholders.length > 0) {
      lines.push(`stakeholders:`);
      for (const s of page.decisionStakeholders) {
        lines.push(`  - ${yamlEscape(s)}`);
      }
    }
    if (page.decisionAlternativesRejected && page.decisionAlternativesRejected.length > 0) {
      lines.push(`alternatives_rejected:`);
      for (const a of page.decisionAlternativesRejected) {
        lines.push(`  - name: ${yamlEscape(a.name)}`);
        lines.push(`    reason: ${yamlEscape(a.reason)}`);
      }
    }
    if (page.decisionTradeoffsAccepted && page.decisionTradeoffsAccepted.length > 0) {
      lines.push(`tradeoffs_accepted:`);
      for (const t of page.decisionTradeoffsAccepted) {
        lines.push(`  - ${yamlEscape(t)}`);
      }
    }
  }

  // Freshness
  lines.push(`freshness:`);
  lines.push(`  last_checked: ${new Date(page.freshness.lastChecked).toISOString()}`);
  lines.push(`  staleness: ${page.freshness.staleness}`);

  lines.push("---");
  return lines.join("\n");
}

/**
 * Escape a string for YAML (handle quotes, special chars).
 */
function yamlEscape(s: string): string {
  // If it contains special chars, wrap in quotes
  if (/[:#\[\]{}|>&*!%@`,]/.test(s) || s.startsWith("-") || s.startsWith("?") || s.includes("\n")) {
    return `"${s.replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`;
  }
  return s;
}

/**
 * Export all pages from a WikiStore to markdown files.
 * Returns the list of files written.
 */
export async function exportAllPages(store: WikiStore, wikiRoot: string): Promise<{ written: number; paths: string[] }> {
  const pages = await store.listAll();
  const paths: string[] = [];

  for (const page of pages) {
    const relPath = pageToFilePath(page.pageType, page.label, page.episodeDate ?? page.decisionDate);
    const fullPath = join(wikiRoot, relPath);
    await writePageMarkdown(page, fullPath);
    paths.push(fullPath);
  }

  return { written: paths.length, paths };
}

/**
 * Write a single page to a markdown file.
 */
export async function writePageMarkdown(page: WikiPage, filePath: string): Promise<void> {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
  const md = pageToMarkdown(page);
  await writeFile(filePath, md, "utf8");
}
