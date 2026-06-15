/**
 * wllm/types/index.ts
 *
 * WllmConcept type system — extends HuaEngine v4.0 graph types with
 * 5-memory system, confidence levels, freshness tracking, and
 * Obsidian-compatible wiki page semantics.
 *
 * Design principles:
 * - BACKWARD COMPATIBLE: All extensions are additive (new optional fields).
 * - OBSIDIAN-NATIVE: Wiki files use [[wikilinks]] and YAML frontmatter.
 * - BI-TEMPORAL PRESERVED: We keep validFrom/validTo from the base graph.
 * - CONFIDENCE PROMOTION: ASSUMED → INFERRED → VERIFIED has a defined lifecycle.
 */

import type { GraphNode, GraphEdge, GraphQuery, GraphResult, GraphNodeKind } from "../../engine/v4/graph/types.js";

// =====================================================================
// 1. CONFIDENCE LEVELS (WllmConcept spec § frontmatter.md)
// =====================================================================

/**
 * Knowledge confidence levels. Promotion rules:
 *   ASSUMED → INFERRED: when code/structural evidence is found
 *   INFERRED → VERIFIED: when tests pass, runtime confirms, or user verifies
 *   Any → CONTRADICTED: when conflicting evidence is found
 *   CONTRADICTED → RESOLVED: when human resolves the conflict
 */
export type ConfidenceLevel =
  | "VERIFIED"      // Confirmed by code, tests, or user
  | "INFERRED"      // Deduced from patterns, not directly confirmed
  | "ASSUMED"       // Educated guess, limited evidence
  | "CONTRADICTED"  // Conflicts with other evidence (needs resolution)
  | "RESOLVED";     // Contradiction was resolved by human (was CONTRADICTED)

/**
 * Numeric confidence score (0-1) for ranking.
 * Maps to ConfidenceLevel for display purposes.
 */
export const CONFIDENCE_WEIGHT: Record<ConfidenceLevel, number> = {
  VERIFIED: 1.0,
  INFERRED: 0.8,
  ASSUMED: 0.5,
  CONTRADICTED: 0.2,
  RESOLVED: 0.9,  // Was a contradiction, now resolved → high trust but flag history
};

/**
 * Convert numeric confidence (0-1) to ConfidenceLevel.
 * Used when extracting from LLM (which returns float).
 */
export function numericToConfidence(n: number): ConfidenceLevel {
  if (n >= 0.95) return "VERIFIED";
  if (n >= 0.7) return "INFERRED";
  if (n >= 0.4) return "ASSUMED";
  return "CONTRADICTED";
}

// =====================================================================
// 2. FRESHNESS TRACKING (WllmConcept spec § frontmatter.md)
// =====================================================================

/**
 * Staleness levels. Computed from time-since-last-check vs freshness window.
 *   LOW:     checked within freshness_window
 *   MEDIUM:  checked within 2x freshness_window
 *   HIGH:    checked within 4x freshness_window
 *   STALE:   not checked for longer than 4x freshness_window
 */
export type StalenessLevel = "LOW" | "MEDIUM" | "HIGH" | "STALE";

export const STALENESS_WEIGHT: Record<StalenessLevel, number> = {
  LOW: 1.0,
  MEDIUM: 0.9,
  HIGH: 0.7,
  STALE: 0.5,
};

export interface Freshness {
  /** When this knowledge was last verified/checked (ms since epoch) */
  lastChecked: number;
  /** Computed staleness level */
  staleness: StalenessLevel;
  /** If true, agent auto-rechecks this page on lint */
  autoRecheck?: boolean;
  /** When to recheck next (ms since epoch) */
  checkAgain?: number;
}

/**
 * Compute staleness given a last-checked timestamp and the configured window.
 */
export function computeStaleness(
  lastChecked: number,
  freshnessWindowMs: number,
  now: number = Date.now()
): StalenessLevel {
  const elapsed = now - lastChecked;
  if (elapsed <= freshnessWindowMs) return "LOW";
  if (elapsed <= 2 * freshnessWindowMs) return "MEDIUM";
  if (elapsed <= 4 * freshnessWindowMs) return "HIGH";
  return "STALE";
}

// =====================================================================
// 3. PAGE TYPES — 5 Memory Systems (WllmConcept spec § five-memories.md)
// =====================================================================

/**
 * WllmConcept page types. Maps to the 5 memory systems.
 *
 *   SEMANTIC:   facts, concepts, entities, sources
 *   EPISODIC:   debugging sessions, decisions made, failures
 *   STRUCTURAL: code structure (architecture, call-graph, dependencies)
 *   CAUSAL:     design decisions, tradeoffs, migrations
 *   META:       self-reflection, heuristics, learning patterns
 */
export type PageType =
  // SEMANTIC
  | "entity"       // service, library, API, person
  | "concept"      // pattern, architecture, convention
  | "source"       // summary of source document
  | "comparison"   // side-by-side analysis
  // EPISODIC
  | "episode"      // debugging session, decision conversation
  | "failure"      // failed approach (very valuable)
  // STRUCTURAL
  | "structure"    // architecture, call-graph, dependencies
  // CAUSAL
  | "decision"     // architecture decision with reasoning
  | "tradeoff"     // trade-off analysis
  | "migration"    // why something changed
  // META
  | "meta";        // self-reflection, heuristics, performance

/**
 * Map page types to their memory system.
 * Used for the 5-memory search routing.
 */
export const PAGE_TYPE_TO_MEMORY: Record<PageType, MemorySystem> = {
  entity: "semantic",
  concept: "semantic",
  source: "semantic",
  comparison: "semantic",
  episode: "episodic",
  failure: "episodic",
  structure: "structural",
  decision: "causal",
  tradeoff: "causal",
  migration: "causal",
  meta: "meta",
};

export type MemorySystem =
  | "semantic"
  | "episodic"
  | "structural"
  | "causal"
  | "meta";

/**
 * Episode category (subtype of episode pages).
 * From WllmConcept spec § three-memories.md → Memory 2.
 */
export type EpisodeCategory =
  | "debug"
  | "decision"
  | "refactor"
  | "incident"
  | "learning"
  | "failure";

/**
 * Episode outcome — how a debugging/refactor session ended.
 */
export type EpisodeOutcome = "RESOLVED" | "UNRESOLVED" | "WORKAROUND" | "WONTFIX" | "ABANDONED";

/**
 * Episode difficulty — how hard the session was.
 */
export type EpisodeDifficulty = "TRIVIAL" | "EASY" | "MEDIUM" | "HARD" | "EXPERT";

/**
 * Decision status — is this architectural decision still active?
 */
export type DecisionStatus = "ACTIVE" | "SUPERSEDED" | "REVISIT" | "ABANDONED";

/**
 * Structure subtype — what kind of structural information.
 */
export type StructureSubtype =
  | "architecture"
  | "call-graph"
  | "dependencies"
  | "data-flow"
  | "hotspots"
  | "patterns";

/**
 * Meta subtype — what kind of self-knowledge.
 */
export type MetaSubtype =
  | "learning-patterns"
  | "debugging-heuristics"
  | "confidence-audit"
  | "performance-review";

// =====================================================================
// 4. WIKI PAGE — Extends GraphNode with WllmConcept semantics
// =====================================================================

/**
 * A wiki page in the WllmConcept system.
 * Extends GraphNode with:
 *   - pageType: which of the 5 memory systems it belongs to
 *   - confidence: VERIFIED/INFERRED/ASSUMED/CONTRADICTED/RESOLVED
 *   - freshness: when this was last checked
 *   - sources: which raw source files this was derived from
 *   - tags: freeform categorization
 *   - related: [[wikilinks]] to other pages
 *   - body: long-form markdown content
 *   - frontmatter: original YAML (for roundtrip)
 *   - subtype: optional (episode category, decision status, etc.)
 */
export interface WikiPage extends GraphNode {
  /** Which of the 5 memory systems */
  pageType: PageType;

  /** Confidence level (overrides the numeric `confidence` field) */
  confidenceLevel: ConfidenceLevel;

  /** Freshness tracking */
  freshness: Freshness;

  /** Source files this page was derived from (relative paths) */
  sources: string[];

  /** Freeform tags */
  tags: string[];

  /** Related pages (Obsidian [[wikilinks]]) */
  related: string[];

  /** Long-form markdown body */
  body: string;

  /** Raw YAML frontmatter (preserved for roundtrip) */
  frontmatter?: Record<string, unknown>;

  /** Page-type-specific subtype */
  subtype?: EpisodeCategory | DecisionStatus | StructureSubtype | MetaSubtype | string;

  // Episode-specific (only when pageType === 'episode' or 'failure')
  episodeDate?: number;          // ms since epoch
  episodeDurationMin?: number;
  episodeOutcome?: EpisodeOutcome;
  episodeDifficulty?: EpisodeDifficulty;
  episodeAffectedFiles?: string[];
  episodeLessons?: string[];

  // Decision-specific (only when pageType === 'decision')
  decisionDate?: number;
  decisionStatus?: DecisionStatus;
  decisionRevisit?: number;
  decisionStakeholders?: string[];
  decisionAlternativesRejected?: Array<{ name: string; reason: string }>;
  decisionTradeoffsAccepted?: string[];

  // Meta-specific (only when pageType === 'meta')
  metaPeriod?: { from: number; to: number };
  metaReviewPeriodDays?: number;
}

/**
 * A wiki edge (link between pages). Extends GraphEdge with relation type.
 */
export interface WikiEdge extends GraphEdge {
  /** Relation type: "wikilink", "caused", "decided", "related", etc. */
  relation: string;
}

// =====================================================================
// 5. QUERY & RESULT TYPES (WllmConcept spec § workflows/query.md)
// =====================================================================

/**
 * Query intent — what kind of question the user is asking.
 * Used to weight the 5 memories differently.
 */
export type QueryIntent =
  | "what"        // facts, concepts, entities → SEMANTIC primary
  | "how"         // request flow, code structure → STRUCTURAL primary
  | "why"         // design decisions, tradeoffs → CAUSAL primary
  | "when"        // history, timeline → EPISODIC primary
  | "history"     // debugging attempts, sessions → EPISODIC primary
  | "compare"     // A vs B → SEMANTIC primary
  | "pattern"     // debugging heuristics, approach → META primary
  | "unknown";    // default to all memories equally

/**
 * Per-intent memory weights. Higher = more relevant.
 * From WllmConcept spec § query.md → Step 2.
 */
export const INTENT_MEMORY_WEIGHTS: Record<QueryIntent, Record<MemorySystem, number>> = {
  what:     { semantic: 5, structural: 3, causal: 2, episodic: 1, meta: 1 },
  how:      { semantic: 3, structural: 5, causal: 2, episodic: 1, meta: 1 },
  why:      { semantic: 3, structural: 1, causal: 5, episodic: 3, meta: 1 },
  when:     { semantic: 2, structural: 1, causal: 2, episodic: 5, meta: 1 },
  history:  { semantic: 2, structural: 1, causal: 3, episodic: 5, meta: 1 },
  compare:  { semantic: 5, structural: 2, causal: 3, episodic: 1, meta: 1 },
  pattern:  { semantic: 2, structural: 1, causal: 1, episodic: 3, meta: 5 },
  unknown:  { semantic: 3, structural: 3, causal: 3, episodic: 3, meta: 3 },
};

/**
 * A search result with confidence/freshness scoring.
 */
export interface SearchHit {
  page: WikiPage;
  /** How relevant to the query (0-1) */
  relevance: number;
  /** Confidence weight (0-1) */
  confidenceWeight: number;
  /** Freshness weight (0-1) */
  freshnessWeight: number;
  /** Memory system this came from */
  memory: MemorySystem;
  /** Combined score = relevance × confidence × freshness × memory_weight */
  score: number;
  /** Snippet from the body (first 200 chars) */
  snippet: string;
}

/**
 * A query result — ranked list of search hits with synthesis.
 */
export interface QueryResult {
  query: string;
  intent: QueryIntent;
  hits: SearchHit[];
  /** Synthesized answer text (LLM-generated) */
  answer?: string;
  /** Citations: list of page labels referenced in the answer */
  citations: string[];
  /** Total time taken (ms) */
  durationMs: number;
  /** Number of pages searched across all 5 memories */
  pagesSearched: number;
}

// =====================================================================
// 6. INGEST TYPES (WllmConcept spec § workflows/ingest.md)
// =====================================================================

/**
 * A raw source to be ingested.
 */
export interface IngestSource {
  /** Absolute or relative path */
  path: string;
  /** File content (text) */
  content: string;
  /** SHA256 of the content (for incremental skip) */
  hash: string;
  /** Last modified time (ms since epoch) */
  mtime: number;
  /** File size in bytes */
  size: number;
  /** Detected language (e.g., "typescript", "python") */
  language?: string;
}

/**
 * Result of a Pass-1 analysis (extraction without generation).
 */
export interface IngestAnalysis {
  source: IngestSource;
  /** Entities found (services, libraries, APIs) */
  entities: Array<{ name: string; kind: string; description: string; confidence: number }>;
  /** Concepts found (patterns, techniques) */
  concepts: Array<{ name: string; description: string; confidence: number }>;
  /** Key facts (configs, behaviors) */
  facts: Array<{ claim: string; evidence: string; confidence: number }>;
  /** Connections to existing wiki pages */
  connections: Array<{ targetPage: string; relation: string; confidence: number }>;
  /** Contradictions found with existing pages */
  contradictions: Array<{ existingPage: string; existingClaim: string; newClaim: string; confidence: number }>;
  /** Recommended wiki pages to create or update */
  recommendations: Array<{ action: "create" | "update"; pageType: PageType; label: string; reason: string }>;
}

/**
 * Result of Pass-2 generation (actual pages to write).
 */
export interface IngestGeneration {
  source: IngestSource;
  analysis: IngestAnalysis;
  /** Pages to create */
  newPages: WikiPage[];
  /** Pages to update (by id, with patch) */
  updatedPages: Array<{ id: string; patch: Partial<WikiPage> }>;
  /** Edges to create */
  newEdges: WikiEdge[];
  /** Total tokens used in generation */
  tokensUsed: number;
}

/**
 * Ingest pipeline result (Pass-1 + Pass-2 + Pass-3 verify).
 */
export interface IngestResult {
  source: IngestSource;
  generation: IngestGeneration;
  /** Whether Pass-3 verification passed (no hallucinations detected) */
  verified: boolean;
  /** Issues found in verification (if any) */
  verificationIssues: string[];
  /** Was this source skipped due to cache? */
  skipped: boolean;
  /** Reason for skip (if skipped) */
  skipReason?: string;
  /** Total time taken (ms) */
  durationMs: number;
  /** Total tokens used (all 3 passes) */
  tokensUsed: number;
}

// =====================================================================
// 7. LINT TYPES (WllmConcept spec § workflows/lint.md)
// =====================================================================

/**
 * Severity of a lint issue.
 */
export type LintSeverity = "critical" | "important" | "minor";

/**
 * A single lint finding.
 */
export interface LintIssue {
  id: string;
  check: LintCheck;
  severity: LintSeverity;
  /** Page(s) affected */
  pages: string[];
  /** Human-readable description */
  message: string;
  /** Suggested fix (if auto-fixable) */
  suggestedFix?: string;
  /** Whether the fix was applied */
  autoFixed: boolean;
  /** Whether human review is required */
  requiresReview: boolean;
}

export type LintCheck =
  | "orphan"           // Page with no inbound links
  | "contradiction"    // Pages with conflicting claims
  | "staleness"        // Page not checked recently
  | "code-sync"        // Wiki out of sync with code
  | "low-confidence"   // Page with confidence ≤ ASSUMED that could be verified
  | "duplicate"        // Two pages covering same content
  | "missing-page";    // [[wikilink]] target doesn't exist

/**
 * Lint report — collection of all issues found.
 */
export interface LintReport {
  /** When this lint ran (ms since epoch) */
  timestamp: number;
  /** Wiki health score 0-100 */
  healthScore: number;
  /** Total pages analyzed */
  totalPages: number;
  /** Issues found, grouped by severity */
  issues: LintIssue[];
  /** Summary counts */
  summary: {
    critical: number;
    important: number;
    minor: number;
    autoFixed: number;
    requiresReview: number;
  };
}

// =====================================================================
// 8. EVOLVE TYPES (WllmConcept spec § workflows/evolve.md)
// =====================================================================

/**
 * A lesson extracted from a session.
 */
export interface Lesson {
  /** Type of lesson */
  type: "PATTERN" | "HEURISTIC" | "REGRET" | "INSIGHT" | "ANTI-PATTERN";
  /** The lesson text */
  text: string;
  /** Confidence in this lesson (0-1) */
  confidence: number;
  /** Source episode this came from */
  sourceEpisode?: string;
}

/**
 * An episode to be created from a session.
 */
export interface NewEpisode {
  title: string;
  body: string;
  category: EpisodeCategory;
  outcome: EpisodeOutcome;
  difficulty: EpisodeDifficulty;
  durationMin: number;
  affectedFiles: string[];
  lessons: Lesson[];
}

/**
 * Evolve result.
 */
export interface EvolveResult {
  /** Episode created (if significant) */
  newEpisode?: WikiPage;
  /** Pages updated across the 5 memories */
  updatedPages: string[];
  /** Heuristics added to meta memory */
  newHeuristics: string[];
  /** Confidence promotions (ASSUMED → INFERRED → VERIFIED) */
  promotions: Array<{ page: string; from: ConfidenceLevel; to: ConfidenceLevel }>;
  /** Time taken (ms) */
  durationMs: number;
}

// =====================================================================
// 9. CONFIG (WllmConcept spec § specs/schema.md → config.yaml)
// =====================================================================

/**
 * WllmConcept configuration (mirrors config.yaml).
 */
export interface WllmConfig {
  version: string;
  language: "en" | "id" | "zh" | "ja" | "ko";
  agent: {
    name: string;
    role: string;
  };
  memory: {
    semantic: { enabled: boolean; maxPages: number; autoLink: boolean; confidenceThreshold: ConfidenceLevel; freshnessWindowDays: number };
    episodic: { enabled: boolean; retentionDays: number; autoSummarize: boolean; minSignificance: "LOW" | "MEDIUM" | "HIGH" };
    structural: { enabled: boolean; autoScan: boolean; scanOnCommit: boolean; parser: "typescript-compiler-api" | "tree-sitter" | "regex"; languages: string[] };
    causal: { enabled: boolean; requireEvidence: boolean; revisitIntervalDays: number; autoDetectDecisions: boolean };
    meta: { enabled: boolean; reflectAfterSession: boolean; reviewIntervalDays: number; trackConfidence: boolean };
  };
  ingest: {
    twoPass: boolean;
    incremental: boolean;
    maxConcurrent: number;
    batchSize: number;
    skipPatterns: string[];
  };
  query: {
    multiMemory: boolean;
    confidenceInAnswer: boolean;
    autoFileAnswers: boolean;
    maxContextPages: number;
  };
  lint: {
    autoRun: boolean;
    intervalHours: number;
    checks: Record<LintCheck, boolean>;
  };
  evolve: {
    autoExtractLessons: boolean;
    propagateChanges: boolean;
    selfReflect: boolean;
    reflectionIntervalDays: number;
    maxPropagationDepth: number;
  };
  paths: {
    wikiRoot: string;       // absolute path to .wllmconcept/wiki
    configFile: string;     // absolute path to .wllmconcept/config.yaml
    schemaFile: string;     // absolute path to .wllmconcept/schema.md
    purposeFile: string;    // absolute path to .wllmconcept/purpose.md
  };
}

/**
 * Default configuration (matches WllmConcept spec defaults).
 */
export const DEFAULT_CONFIG: WllmConfig = {
  version: "1.0",
  language: "en",
  agent: { name: "WllmConcept", role: "Senior Developer & Knowledge Maintainer" },
  memory: {
    semantic: { enabled: true, maxPages: 1000, autoLink: true, confidenceThreshold: "ASSUMED", freshnessWindowDays: 7 },
    episodic: { enabled: true, retentionDays: 90, autoSummarize: true, minSignificance: "LOW" },
    structural: { enabled: true, autoScan: true, scanOnCommit: true, parser: "typescript-compiler-api", languages: ["typescript", "javascript"] },
    causal: { enabled: true, requireEvidence: true, revisitIntervalDays: 30, autoDetectDecisions: true },
    meta: { enabled: true, reflectAfterSession: true, reviewIntervalDays: 7, trackConfidence: true },
  },
  ingest: {
    twoPass: true,
    incremental: true,
    maxConcurrent: 1,
    batchSize: 10,
    skipPatterns: ["node_modules/**", ".git/**", "dist/**", "*.min.js", "*.lock"],
  },
  query: {
    multiMemory: true,
    confidenceInAnswer: true,
    autoFileAnswers: true,
    maxContextPages: 20,
  },
  lint: {
    autoRun: true,
    intervalHours: 24,
    checks: { orphan: true, contradiction: true, staleness: true, "code-sync": true, "low-confidence": true, duplicate: true, "missing-page": true },
  },
  evolve: {
    autoExtractLessons: true,
    propagateChanges: true,
    selfReflect: true,
    reflectionIntervalDays: 7,
    maxPropagationDepth: 5,
  },
  paths: {
    wikiRoot: "",
    configFile: "",
    schemaFile: "",
    purposeFile: "",
  },
};

// =====================================================================
// 10. UTILITIES
// =====================================================================

/**
 * Generate a stable, human-readable slug from a label.
 * "PostgreSQL over MongoDB" → "postgresql-over-mongodb"
 */
export function slugify(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")  // remove special chars
    .replace(/\s+/g, "-")        // spaces → hyphens
    .replace(/-+/g, "-")         // collapse multiple hyphens
    .replace(/^-+|-+$/g, "");    // trim leading/trailing
}

/**
 * Convert a PageType + label to a relative file path within the wiki.
 * Mirrors WllmConcept directory structure (spec § architecture.md).
 */
export function pageToFilePath(pageType: PageType, label: string, date?: number): string {
  const slug = slugify(label);
  switch (pageType) {
    case "entity":
      return `pages/entities/${slug}.md`;
    case "concept":
      return `pages/concepts/${slug}.md`;
    case "source":
      return `pages/sources/${slug}.md`;
    case "comparison":
      return `pages/comparisons/${slug}.md`;
    case "episode":
    case "failure":
      const dateStr = date ? new Date(date).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
      return `episodes/${dateStr}-${slug}.md`;
    case "structure":
      return `structure/${slug}.md`;
    case "decision":
      const dDateStr = date ? new Date(date).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
      return `causation/decisions/${dDateStr}-${slug}.md`;
    case "tradeoff":
      return `causation/tradeoffs/${slug}.md`;
    case "migration":
      return `causation/migrations/${slug}.md`;
    case "meta":
      return `meta/${slug}.md`;
  }
}

/**
 * Re-export core graph types for convenience.
 */
export type { GraphNode, GraphEdge, GraphQuery, GraphResult, GraphNodeKind };
