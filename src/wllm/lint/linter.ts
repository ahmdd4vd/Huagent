/**
 * @fileoverview Lint workflow — Om Guru PR (quality checks).
 *
 * Phase 3.2 of WllmConcept.
 *
 * ## What is Lint?
 *
 * Lint is the workflow that audits a wiki for quality issues. It runs a
 * battery of checks on every page and produces a structured "report card"
 * with severity, location, and suggested fixes.
 *
 * ## The 7 checks
 *
 *  1. **title** — Is the page label descriptive and non-empty?
 *  2. **confidence** — Is the page's confidence level high enough?
 *  3. **freshness** — Is the page still fresh, or has it gone stale?
 *  4. **backlinks** — Does the page have incoming links from others?
 *  5. **tags** — Does the page have at least one tag?
 *  6. **body** — Is the body non-empty and meaningful?
 *  7. **conflicts** — Does the page contradict another?
 *
 * Each check produces a list of `LintIssue` records. The linter also
 * produces a `LintSummary` with per-check pass/warn/fail counts and an
 * overall "report card" grade (A/B/C/D/F).
 *
 * ## Severity levels
 *
 *  - `error` — must fix (e.g. empty body on a referenced page)
 *  - `warning` — should fix (e.g. no tags)
 *  - `info` — nice to have (e.g. consider adding an example)
 *
 * ## Usage
 *
 * ```ts
 * const linter = new Linter(store);
 * const report = await linter.lint({ failOnError: true });
 * console.log(report.summary.grade); // "A"
 * for (const issue of report.issues) {
 *   console.log(`${issue.severity}: ${issue.message} (${issue.pageId})`);
 * }
 * ```
 *
 * @module wllm/lint/linter
 */

import type {
  WikiPage,
  ConfidenceLevel,
  StalenessLevel,
} from "../types/index.js";
import { CONFIDENCE_WEIGHT, STALENESS_WEIGHT } from "../types/index.js";
import type { WikiStore } from "../graph/wiki-store.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LintSeverity = "error" | "warning" | "info";
export type LintCheckId = "title" | "confidence" | "freshness" | "backlinks" | "tags" | "body" | "conflicts";
export type LintGrade = "A" | "B" | "C" | "D" | "F";

export interface LintIssue {
  /** Which check produced this issue. */
  check: LintCheckId;
  /** Severity level. */
  severity: LintSeverity;
  /** The page this issue applies to (or null for wiki-wide issues). */
  pageId: string | null;
  /** Human-readable message. */
  message: string;
  /** Optional suggested fix (markdown). */
  suggestion?: string;
}

export interface LintCheckStat {
  check: LintCheckId;
  pass: number;
  warn: number;
  fail: number;
}

export interface LintSummary {
  /** Total pages checked. */
  totalPages: number;
  /** Total issues found, by severity. */
  totalIssues: number;
  bySeverity: Record<LintSeverity, number>;
  /** Per-check stats. */
  byCheck: LintCheckStat[];
  /** Overall grade. */
  grade: LintGrade;
  /** Numeric score 0-100. */
  score: number;
}

export interface LintReport {
  /** When the lint was run. */
  runAt: string;
  /** Duration in ms. */
  durationMs: number;
  /** All issues found. */
  issues: LintIssue[];
  /** Summary stats. */
  summary: LintSummary;
}

export interface LintOptions {
  /** Which checks to run (default: all). */
  checks?: LintCheckId[];
  /** Minimum confidence level to require (default: ASSUMED). */
  minConfidence?: ConfidenceLevel;
  /** Maximum acceptable staleness (default: HIGH). */
  maxStaleness?: StalenessLevel;
  /** Minimum body length to require (default: 10 chars). */
  minBodyLength?: number;
  /** If true, return only errors. */
  errorsOnly?: boolean;
  /** Throw if any error-level issue is found. */
  failOnError?: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Compute a numeric score (0-100) from a list of issues. We weight errors
 * heavily, warnings moderately, and infos lightly.
 */
export function scoreFromIssues(issues: LintIssue[]): number {
  if (issues.length === 0) return 100;
  const weights: Record<LintSeverity, number> = { error: 10, warning: 3, info: 1 };
  const penalty = issues.reduce((acc, i) => acc + weights[i.severity], 0);
  return Math.max(0, 100 - penalty);
}

/**
 * Convert a numeric score to a letter grade.
 */
export function gradeFromScore(score: number): LintGrade {
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  if (score >= 70) return "C";
  if (score >= 60) return "D";
  return "F";
}

// ---------------------------------------------------------------------------
// Linter class
// ---------------------------------------------------------------------------

export class Linter {
  constructor(private store: WikiStore) {}

  /**
   * Run all (or specified) checks and return a report.
   */
  async lint(opts: LintOptions = {}): Promise<LintReport> {
    const start = Date.now();
    const {
      checks = ["title", "confidence", "freshness", "backlinks", "tags", "body", "conflicts"],
      minConfidence = "ASSUMED",
      maxStaleness = "HIGH",
      minBodyLength = 10,
      errorsOnly = false,
      failOnError = false,
    } = opts;

    const allPages = await this.store.listAll();
    const issues: LintIssue[] = [];

    // Build an index of wikilinks (for backlinks check)
    const outgoingLinks = new Map<string, Set<string>>();
    for (const p of allPages) {
      const set = new Set<string>();
      // Add IDs from the `related` field (outgoing wikilinks).
      for (const r of p.related ?? []) {
        if (r) set.add(r);
      }
      // Also extract [[wikilinks]] from body
      if (typeof p.body === "string") {
        const re = /\[\[([^\]]+)\]\]/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(p.body)) !== null) {
          // Strip display text: "target|display" → "target"
          const target = m[1].split("|")[0].trim();
          if (target) set.add(target);
        }
      }
      outgoingLinks.set(p.id, set);
    }
    // Invert to get backlinks
    const backlinks = new Map<string, Set<string>>();
    for (const [fromId, targets] of Array.from(outgoingLinks)) {
      for (const t of Array.from(targets)) {
        if (!backlinks.has(t)) backlinks.set(t, new Set());
        backlinks.get(t)!.add(fromId);
      }
    }

    // Check 1: Title
    if (checks.includes("title")) {
      for (const p of allPages) {
        if (!p.label || p.label.trim().length === 0) {
          issues.push({
            check: "title",
            severity: "error",
            pageId: p.id,
            message: "Page has no title",
            suggestion: "Add a descriptive label: `updatePage(id, { label: '...' })`",
          });
        } else if (p.label.length < 3) {
          issues.push({
            check: "title",
            severity: "warning",
            pageId: p.id,
            message: `Title is very short: "${p.label}"`,
            suggestion: "Use at least 3 characters for clarity",
          });
        } else if (p.label.toLowerCase() === p.id.toLowerCase()) {
          issues.push({
            check: "title",
            severity: "info",
            pageId: p.id,
            message: "Title is the same as the page ID — consider a more descriptive label",
          });
        }
      }
    }

    // Check 2: Confidence
    if (checks.includes("confidence")) {
      const minW = CONFIDENCE_WEIGHT[minConfidence];
      for (const p of allPages) {
        const w = CONFIDENCE_WEIGHT[p.confidenceLevel] ?? 0.5;
        if (w < minW) {
          issues.push({
            check: "confidence",
            severity: w < 0.5 ? "error" : "warning",
            pageId: p.id,
            message: `Page confidence is ${p.confidenceLevel} (below ${minConfidence} threshold)`,
            suggestion: "Verify the claim with code, tests, or user confirmation, then promote.",
          });
        }
      }
    }

    // Check 3: Freshness
    if (checks.includes("freshness")) {
      // Rank: LOW=0 (best), MEDIUM=1, HIGH=2, STALE=3 (worst)
      const rank: Record<string, number> = { LOW: 0, MEDIUM: 1, HIGH: 2, STALE: 3 };
      const maxRank = rank[maxStaleness] ?? 2;
      for (const p of allPages) {
        const curRank = rank[p.freshness?.staleness ?? "MEDIUM"] ?? 1;
        if (curRank > maxRank) {
          // Page is more stale than the threshold allows
          issues.push({
            check: "freshness",
            severity: p.freshness?.staleness === "STALE" ? "error" : "warning",
            pageId: p.id,
            message: `Page is ${p.freshness?.staleness ?? "unknown"} (threshold: ${maxStaleness})`,
            suggestion: "Re-verify the content and call `updatePage(id, { markChecked: true })`",
          });
        }
      }
    }

    // Check 4: Backlinks
    if (checks.includes("backlinks")) {
      for (const p of allPages) {
        const count = backlinks.get(p.id)?.size ?? 0;
        if (count === 0) {
          issues.push({
            check: "backlinks",
            severity: "info",
            pageId: p.id,
            message: "Page has no incoming links from other pages",
            suggestion: "Reference this page from related pages using [[wikilinks]]",
          });
        }
      }
    }

    // Check 5: Tags
    if (checks.includes("tags")) {
      for (const p of allPages) {
        if (!p.tags || p.tags.length === 0) {
          issues.push({
            check: "tags",
            severity: "warning",
            pageId: p.id,
            message: "Page has no tags",
            suggestion: "Add 1-3 tags to make the page discoverable",
          });
        }
      }
    }

    // Check 6: Body
    if (checks.includes("body")) {
      for (const p of allPages) {
        const body = typeof p.body === "string" ? p.body : "";
        if (body.trim().length === 0) {
          issues.push({
            check: "body",
            severity: "error",
            pageId: p.id,
            message: "Page body is empty",
            suggestion: "Add at least a sentence explaining what this page is about",
          });
        } else if (body.length < minBodyLength) {
          issues.push({
            check: "body",
            severity: "warning",
            pageId: p.id,
            message: `Page body is very short (${body.length} chars, threshold: ${minBodyLength})`,
            suggestion: "Add more detail to make the page useful",
          });
        }
      }
    }

    // Check 7: Conflicts (decision with same topic, different status)
    if (checks.includes("conflicts")) {
      const decisions = allPages.filter((p) => p.pageType === "decision");
      const byTopic = new Map<string, WikiPage[]>();
      for (const d of decisions) {
        // Group by normalized label
        const key = d.label.toLowerCase().trim();
        if (!byTopic.has(key)) byTopic.set(key, []);
        byTopic.get(key)!.push(d);
      }
      for (const [topic, pages] of Array.from(byTopic)) {
        if (pages.length > 1) {
          // Check for conflicts: one ACTIVE, another ACTIVE, or status mismatch
          const activeCount = pages.filter((p) => (p as { decisionStatus?: string }).decisionStatus === "ACTIVE").length;
          if (activeCount > 1) {
            for (const p of pages) {
              issues.push({
                check: "conflicts",
                severity: "warning",
                pageId: p.id,
                message: `Multiple ACTIVE decisions for "${topic}"; only one should be ACTIVE`,
                suggestion: "Mark superseded ones as SUPERSEDED",
              });
            }
          }
        }
      }
    }

    // Filter to errors only if requested
    const filtered = errorsOnly ? issues.filter((i) => i.severity === "error") : issues;

    // Build summary
    const bySeverity: Record<LintSeverity, number> = { error: 0, warning: 0, info: 0 };
    for (const i of filtered) bySeverity[i.severity]++;

    const byCheckMap = new Map<LintCheckId, LintCheckStat>();
    for (const c of checks) byCheckMap.set(c, { check: c, pass: 0, warn: 0, fail: 0 });
    for (const i of filtered) {
      const stat = byCheckMap.get(i.check);
      if (!stat) continue;
      if (i.severity === "error") stat.fail++;
      else if (i.severity === "warning") stat.warn++;
      else stat.pass++;
    }
    // Calculate pass counts
    for (const stat of Array.from(byCheckMap.values())) {
      // We don't know exact pass count from issues alone; we infer:
      // pass = (pages that should be checked by this check) - warn - fail
      // For simplicity, mark pass as >= 0 and report totalPages - failed - warned
      const checked = allPages.length; // rough
      stat.pass = Math.max(0, checked - stat.warn - stat.fail);
    }
    const byCheck = Array.from(byCheckMap.values());

    const score = scoreFromIssues(filtered);
    const grade = gradeFromScore(score);
    const summary: LintSummary = {
      totalPages: allPages.length,
      totalIssues: filtered.length,
      bySeverity,
      byCheck,
      grade,
      score,
    };

    const report: LintReport = {
      runAt: new Date().toISOString(),
      durationMs: Date.now() - start,
      issues: filtered,
      summary,
    };

    if (failOnError && bySeverity.error > 0) {
      throw new LintError(`Lint failed with ${bySeverity.error} error(s)`, report);
    }

    return report;
  }
}

/**
 * Thrown when `failOnError: true` and at least one error-level issue.
 */
export class LintError extends Error {
  constructor(message: string, public report: LintReport) {
    super(message);
    this.name = "LintError";
  }
}

// ---------------------------------------------------------------------------
// Pretty-printing
// ---------------------------------------------------------------------------

/**
 * Format a lint report as a human-readable string.
 */
export function formatReport(report: LintReport): string {
  const lines: string[] = [];
  lines.push(`╔════════════════════════════════════════════════════════════╗`);
  lines.push(`║  Lint Report — Grade ${report.summary.grade} (${report.summary.score}/100)              ║`);
  lines.push(`╚════════════════════════════════════════════════════════════╝`);
  lines.push(`Pages checked: ${report.summary.totalPages}`);
  lines.push(`Issues: ${report.summary.totalIssues} (${report.summary.bySeverity.error} errors, ${report.summary.bySeverity.warning} warnings, ${report.summary.bySeverity.info} info)`);
  lines.push(``);

  if (report.issues.length === 0) {
    lines.push(`✅ No issues found!`);
    return lines.join("\n");
  }

  // Group by check
  const byCheck = new Map<LintCheckId, LintIssue[]>();
  for (const i of report.issues) {
    if (!byCheck.has(i.check)) byCheck.set(i.check, []);
    byCheck.get(i.check)!.push(i);
  }
  for (const [check, issues] of Array.from(byCheck)) {
    lines.push(`\n[${check}] (${issues.length})`);
    for (const i of issues.slice(0, 5)) {
      const icon = i.severity === "error" ? "🔴" : i.severity === "warning" ? "🟡" : "🔵";
      lines.push(`  ${icon} ${i.message}${i.pageId ? ` (${i.pageId})` : ""}`);
    }
    if (issues.length > 5) {
      lines.push(`  ... and ${issues.length - 5} more`);
    }
  }

  return lines.join("\n");
}
