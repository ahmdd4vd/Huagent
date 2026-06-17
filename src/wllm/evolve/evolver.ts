/**
 * @fileoverview Evolve workflow — Si Penambah Ilmu (self-reflection).
 *
 * Phase 3.3 of WllmConcept.
 *
 * ## What is Evolve?
 *
 * Evolve is the workflow that makes the wiki **smarter over time**. It runs
 * a battery of self-reflection checks on the wiki and produces suggestions
 * for improvement.
 *
 * ## The 3 jobs
 *
 *  1. **Find Contradictions** — Two pages that disagree. Si Evolve looks
 *     for pages with the same label but different `confidenceLevel`
 *     (especially VERIFIED vs CONTRADICTED), or multiple ACTIVE
 *     decisions on the same topic.
 *
 *  2. **Suggest New Pages** — Coverage gaps. Si Evolve looks at the
 *     tag/category distribution and suggests pages for popular topics
 *     that don't have a dedicated page yet.
 *
 *  3. **Refresh Stale** — Re-verification. Si Evolve identifies pages
 *     that haven't been checked in a long time and queues them for
 *     re-check.
 *
 * ## How it works
 *
 * ```ts
 * const evolver = new Evolver(store);
 * const report = await evolver.evolve();
 * console.log(report.summary);  // { contradictions: 2, suggestions: 5, refreshes: 3 }
 * for (const c of report.contradictions) {
 *   console.log(`${c.pageA.label} vs ${c.pageB.label}: ${c.reason}`);
 * }
 * ```
 *
 * ## Future: auto-apply
 *
 * The `applyRefresh` method can mark pages as freshly-checked after a
 * re-verification. `applyContradictionResolution` can mark the losing
 * page as SUPERSEDED.
 *
 * @module wllm/evolve/evolver
 */

import type { WikiPage, MemorySystem } from "../types/index.js";
import { PAGE_TYPE_TO_MEMORY } from "../types/index.js";
import type { WikiStore } from "../graph/wiki-store.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Two pages that disagree with each other.
 */
export interface Contradiction {
  pageA: WikiPage;
  pageB: WikiPage;
  /** Why we think they conflict. */
  reason: string;
  /** Severity: high = direct conflict, medium = suspicious, low = note. */
  severity: "high" | "medium" | "low";
  /** Suggested resolution. */
  suggestion: string;
}

/**
 * A suggestion for a new page that should exist.
 */
export interface PageSuggestion {
  /** Suggested title. */
  title: string;
  /** Why we think this page should exist. */
  reason: string;
  /** Tags this page would likely have. */
  suggestedTags: string[];
  /** Confidence: how sure are we this gap exists? 0-1. */
  confidence: number;
}

/**
 * A page that should be re-verified.
 */
export interface RefreshSuggestion {
  page: WikiPage;
  /** Why this page needs a refresh. */
  reason: string;
  /** Days since last check. */
  daysSinceCheck: number;
  /** Suggested action. */
  action: "recheck" | "verify-with-tests" | "deprecate";
}

export interface EvolveReport {
  /** When the evolution was run. */
  runAt: string;
  /** Duration in ms. */
  durationMs: number;
  /** All contradictions found. */
  contradictions: Contradiction[];
  /** All suggestions for new pages. */
  suggestions: PageSuggestion[];
  /** All refresh suggestions. */
  refreshes: RefreshSuggestion[];
  /** Summary stats. */
  summary: {
    totalPages: number;
    contradictionCount: number;
    suggestionCount: number;
    refreshCount: number;
  };
}

export interface EvolveOptions {
  /** Minimum days since last check to consider a page stale. */
  staleDays?: number;
  /** Minimum frequency of a tag to suggest a page for it. */
  popularTagThreshold?: number;
  /** Run auto-applies (e.g., mark pages as re-checked). */
  autoApply?: boolean;
}

// ---------------------------------------------------------------------------
// Evolver class
// ---------------------------------------------------------------------------

export class Evolver {
  constructor(private store: WikiStore) {}

  /**
   * Run all evolution checks and return a report.
   */
  async evolve(opts: EvolveOptions = {}): Promise<EvolveReport> {
    const start = Date.now();
    const {
      staleDays = 30,
      popularTagThreshold = 3,
      autoApply = false,
    } = opts;

    const allPages = await this.store.listAll();

    const contradictions = this.findContradictions(allPages);
    const suggestions = this.suggestNewPages(allPages, popularTagThreshold);
    const refreshes = this.findStalePages(allPages, staleDays);

    if (autoApply) {
      // Auto-mark recheck suggestions as checked.
      for (const r of refreshes) {
        if (r.action === "recheck") {
          await this.store.updatePage(r.page.id, { markChecked: true });
        }
      }
    }

    return {
      runAt: new Date().toISOString(),
      durationMs: Date.now() - start,
      contradictions,
      suggestions,
      refreshes,
      summary: {
        totalPages: allPages.length,
        contradictionCount: contradictions.length,
        suggestionCount: suggestions.length,
        refreshCount: refreshes.length,
      },
    };
  }

  // -------------------------------------------------------------------------
  // Find Contradictions
  // -------------------------------------------------------------------------

  /**
   * Find pages that contradict each other. Strategy:
   *  1. Group pages by normalized label.
   *  2. Within each group, look for confidence level conflicts.
   *  3. Look for multiple ACTIVE decisions.
   */
  findContradictions(pages: WikiPage[]): Contradiction[] {
    const contradictions: Contradiction[] = [];

    // Group by normalized label
    const byLabel = new Map<string, WikiPage[]>();
    for (const p of pages) {
      const key = p.label.toLowerCase().trim();
      if (!byLabel.has(key)) byLabel.set(key, []);
      byLabel.get(key)!.push(p);
    }

    for (const [label, group] of Array.from(byLabel)) {
      if (group.length < 2) continue;

      // Check 1: Different confidence levels for same topic
      const levels = new Set(group.map((p) => p.confidenceLevel));
      if (levels.size > 1) {
        // If one is VERIFIED and another is CONTRADICTED, that's a hard conflict
        const verified = group.find((p) => p.confidenceLevel === "VERIFIED");
        const contradicted = group.find((p) => p.confidenceLevel === "CONTRADICTED");
        if (verified && contradicted) {
          contradictions.push({
            pageA: verified,
            pageB: contradicted,
            reason: `Same topic "${label}" has both VERIFIED and CONTRADICTED pages`,
            severity: "high",
            suggestion: "Investigate which is correct. Mark the wrong one as CONTRADICTED→RESOLVED with explanation.",
          });
          continue;
        }
        // Otherwise, mixed confidence levels is a softer concern
        contradictions.push({
          pageA: group[0],
          pageB: group[1],
          reason: `Same topic "${label}" has multiple pages with different confidence levels: ${Array.from(levels).join(", ")}`,
          severity: "medium",
          suggestion: "Consider merging or cross-referencing these pages.",
        });
      }

      // Check 2: Multiple ACTIVE decisions on same topic
      const decisions = group.filter((p) => p.pageType === "decision");
      const activeDecisions = decisions.filter(
        (p) => (p as { decisionStatus?: string }).decisionStatus === "ACTIVE"
      );
      if (activeDecisions.length > 1) {
        for (let i = 0; i < activeDecisions.length - 1; i++) {
          contradictions.push({
            pageA: activeDecisions[i],
            pageB: activeDecisions[i + 1],
            reason: `Topic "${label}" has ${activeDecisions.length} ACTIVE decisions; only one should be ACTIVE`,
            severity: "high",
            suggestion: "Mark superseded decisions as SUPERSEDED.",
          });
        }
      }
    }

    return contradictions;
  }

  // -------------------------------------------------------------------------
  // Suggest New Pages
  // -------------------------------------------------------------------------

  /**
   * Suggest new pages based on coverage gaps. Strategy:
   *  1. Find popular tags (used in many pages).
   *  2. If a popular tag has no dedicated overview page, suggest one.
   *  3. Find memory systems with very few pages, suggest filling them.
   */
  suggestNewPages(pages: WikiPage[], threshold: number): PageSuggestion[] {
    const suggestions: PageSuggestion[] = [];

    // 1. Count tag usage
    const tagCounts = new Map<string, number>();
    for (const p of pages) {
      for (const t of p.tags ?? []) {
        tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
      }
    }

    // 2. For popular tags, check if there's an "overview" page
    const existingLabels = new Set(pages.map((p) => p.label.toLowerCase()));
    for (const [tag, count] of Array.from(tagCounts)) {
      if (count < threshold) continue;
      const overviewName = `${tag} overview`;
      const indexName = `${tag} index`;
      if (
        !existingLabels.has(overviewName.toLowerCase()) &&
        !existingLabels.has(indexName.toLowerCase()) &&
        !existingLabels.has(tag.toLowerCase())
      ) {
        suggestions.push({
          title: overviewName,
          reason: `Tag "${tag}" is used in ${count} pages but has no dedicated overview page. An overview would help readers find their way.`,
          suggestedTags: [tag, "overview"],
          confidence: Math.min(1.0, count / (threshold * 3)),
        });
      }
    }

    // 3. Memory systems with low coverage
    const memCounts: Record<MemorySystem, number> = {
      semantic: 0, episodic: 0, structural: 0, causal: 0, meta: 0,
    };
    for (const p of pages) {
      const mem = PAGE_TYPE_TO_MEMORY[p.pageType] ?? "semantic";
      memCounts[mem]++;
    }
    const total = pages.length;
    for (const [mem, count] of Array.from(Object.entries(memCounts)) as [MemorySystem, number][]) {
      if (total === 0) continue;
      const ratio = count / total;
      if (ratio < 0.05 && total > 10) {
        suggestions.push({
          title: `${mem} memory primer`,
          reason: `Only ${count}/${total} pages (${(ratio * 100).toFixed(0)}%) use ${mem} memory. Consider documenting patterns for this memory system.`,
          suggestedTags: [mem, "memory-system"],
          confidence: 0.5,
        });
      }
    }

    return suggestions;
  }

  // -------------------------------------------------------------------------
  // Find Stale Pages
  // -------------------------------------------------------------------------

  /**
   * Find pages that should be re-checked. A page is stale if:
   *  - Its freshness.staleness is HIGH or STALE
   *  - Or its lastChecked is more than `staleDays` ago
   */
  findStalePages(pages: WikiPage[], staleDays: number): RefreshSuggestion[] {
    const refreshes: RefreshSuggestion[] = [];
    const now = Date.now();
    // BUGFIX: `staleMs` was computed but never used (the logic below
    // uses `daysSinceCheck > staleDays` instead). Removed the dead
    // variable to avoid confusion.

    for (const p of pages) {
      const staleness = p.freshness?.staleness ?? "MEDIUM";
      const lastChecked = p.freshness?.lastChecked ?? now;
      const ageMs = now - lastChecked;
      const daysSinceCheck = Math.floor(ageMs / (24 * 60 * 60 * 1000));

      // High or STALE staleness
      if (staleness === "STALE") {
        refreshes.push({
          page: p,
          reason: "Marked STALE (long since last verification)",
          daysSinceCheck,
          action: "recheck",
        });
        continue;
      }
      if (staleness === "HIGH" && daysSinceCheck > staleDays) {
        refreshes.push({
          page: p,
          reason: `Marked HIGH staleness, ${daysSinceCheck} days since last check`,
          daysSinceCheck,
          action: "recheck",
        });
        continue;
      }
      if (daysSinceCheck > staleDays * 2) {
        // Way over the threshold
        refreshes.push({
          page: p,
          reason: `Not checked in ${daysSinceCheck} days (threshold: ${staleDays})`,
          daysSinceCheck,
          action: "recheck",
        });
      }
    }

    return refreshes;
  }

  // -------------------------------------------------------------------------
  // Apply actions
  // -------------------------------------------------------------------------

  /**
   * Mark a refresh suggestion as applied (mark the page as checked).
   */
  async applyRefresh(suggestion: RefreshSuggestion): Promise<boolean> {
    if (suggestion.action === "deprecate") {
      // No-op for now; would need a delete API
      return false;
    }
    await this.store.updatePage(suggestion.page.id, { markChecked: true });
    return true;
  }

  /**
   * Resolve a contradiction by marking the losing page as superseded.
   *
   * For decisions: marks the loser as SUPERSEDED.
   * For other types: marks the loser as CONTRADICTED via updatePage.
   */
  async resolveContradiction(
    contradiction: Contradiction,
    winner: "a" | "b"
  ): Promise<boolean> {
    const loser = winner === "a" ? contradiction.pageB : contradiction.pageA;
    if (loser.pageType === "decision") {
      // Use WikiStore's graph directly, patching both the top-level
      // decisionStatus AND the nested properties.decisionStatus (which is
      // what hydrate() reads from).
      const graph = (this.store as unknown as {
        graph: { updateNode: (id: string, patch: Record<string, unknown>) => Promise<unknown> };
        getPage: (id: string) => Promise<{ properties?: Record<string, unknown> } | null>;
      }).graph;
      const current = await (this.store as unknown as {
        getPage: (id: string) => Promise<{ properties?: Record<string, unknown> } | null>;
      }).getPage(loser.id);
      const props = { ...(current?.properties ?? {}), decisionStatus: "SUPERSEDED" };
      await graph.updateNode(loser.id, {
        decisionStatus: "SUPERSEDED",
        properties: props,
      });
      return true;
    }
    // For non-decision pages, mark the loser as CONTRADICTED
    await this.store.updatePage(loser.id, {
      confidenceLevel: "CONTRADICTED",
    });
    return true;
  }
}

// ---------------------------------------------------------------------------
// Pretty-printing
// ---------------------------------------------------------------------------

/**
 * Format an evolve report as a human-readable string.
 */
export function formatEvolveReport(report: EvolveReport): string {
  const lines: string[] = [];
  lines.push(`╔════════════════════════════════════════════════════════════╗`);
  lines.push(`║  Evolve Report                                              ║`);
  lines.push(`╚════════════════════════════════════════════════════════════╝`);
  lines.push(`Pages: ${report.summary.totalPages}`);
  lines.push(
    `Found: ${report.summary.contradictionCount} contradictions, ` +
    `${report.summary.suggestionCount} new-page suggestions, ` +
    `${report.summary.refreshCount} refresh suggestions`
  );
  lines.push(``);

  if (report.contradictions.length > 0) {
    lines.push(`\n⚔️  CONTRADICTIONS (${report.contradictions.length})`);
    for (const c of report.contradictions.slice(0, 5)) {
      const icon = c.severity === "high" ? "🔴" : c.severity === "medium" ? "🟡" : "🔵";
      lines.push(`  ${icon} ${c.reason}`);
      lines.push(`     ${c.pageA.label} (id: ${c.pageA.id})`);
      lines.push(`     vs ${c.pageB.label} (id: ${c.pageB.id})`);
      lines.push(`     → ${c.suggestion}`);
    }
    if (report.contradictions.length > 5) {
      lines.push(`  ... and ${report.contradictions.length - 5} more`);
    }
  }

  if (report.suggestions.length > 0) {
    lines.push(`\n💡 NEW PAGE SUGGESTIONS (${report.suggestions.length})`);
    for (const s of report.suggestions.slice(0, 5)) {
      lines.push(`  📄 "${s.title}" (confidence: ${(s.confidence * 100).toFixed(0)}%)`);
      lines.push(`     ${s.reason}`);
    }
    if (report.suggestions.length > 5) {
      lines.push(`  ... and ${report.suggestions.length - 5} more`);
    }
  }

  if (report.refreshes.length > 0) {
    lines.push(`\n🔄 REFRESH SUGGESTIONS (${report.refreshes.length})`);
    for (const r of report.refreshes.slice(0, 5)) {
      lines.push(`  🔁 "${r.page.label}" — ${r.reason}`);
    }
    if (report.refreshes.length > 5) {
      lines.push(`  ... and ${report.refreshes.length - 5} more`);
    }
  }

  if (
    report.contradictions.length === 0 &&
    report.suggestions.length === 0 &&
    report.refreshes.length === 0
  ) {
    lines.push(`\n✅ No issues found! Wiki is in great shape.`);
  }

  return lines.join("\n");
}
