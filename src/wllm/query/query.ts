/**
 * @fileoverview Query workflow — Tante Perpustakaan (5-memory smart search).
 *
 * Phase 3.1 of WllmConcept.
 *
 * ## What is Query?
 *
 * Query is the workflow that answers questions using the wiki. Unlike a
 * simple text search, the Query engine:
 *
 *  1. **Understands intent** — is the user asking *what* (definisi), *why*
 *     (alasan), *how* (cara), *when* (waktu), or *pattern* (kebiasaan)?
 *  2. **Weights by memory** — different question types favor different
 *     memory systems (see `INTENT_MEMORY_WEIGHTS`).
 *  3. **Ranks by combined score** — relevance × memory-weight × confidence
 *     × freshness.
 *  4. **Surfaces explanation** — tells you WHY each result was picked.
 *
 * ## Why this matters
 *
 * A wiki with 1000 pages is useless if you can't find the right one.
 * Smart ranking is what separates WllmConcept from grep.
 *
 * ## Scoring formula
 *
 * ```
 * finalScore = textRelevance
 *            × memoryWeight      (0.1-5.0, by intent × memory)
 *            × confidenceFactor  (0.5-1.0, by VERIFIED/INFERRED/ASSUMED)
 *            × freshnessFactor   (0.3-1.0, by LOW/MEDIUM/HIGH/STALE)
 *            × titleBoost        (1.0-2.0, exact title match = 2.0)
 * ```
 *
 * @module wllm/query/query
 */

import type {
  WikiPage,
  MemorySystem,
  ConfidenceLevel,
  StalenessLevel,
  QueryIntent,
  PageType,
} from "../types/index.js";
import {
  INTENT_MEMORY_WEIGHTS,
  CONFIDENCE_WEIGHT,
  STALENESS_WEIGHT,
  PAGE_TYPE_TO_MEMORY,
} from "../types/index.js";
import type { WikiStore } from "../graph/wiki-store.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A Query result with full explainability — why this page matched.
 */
export interface QueryResult {
  page: WikiPage;
  score: number;
  breakdown: QueryScoreBreakdown;
  /** 0-1 confidence in the result overall. */
  confidence: number;
}

export interface QueryScoreBreakdown {
  /** How well the query text matches page text (0-1). */
  textRelevance: number;
  /** Memory weight applied (0-5). */
  memoryWeight: number;
  /** Confidence factor (0-1). */
  confidenceFactor: number;
  /** Freshness factor (0-1). */
  freshnessFactor: number;
  /** Title match boost (1.0-2.0). */
  titleBoost: number;
}

export interface QueryOptions {
  /** Detected or explicit intent. If not set, will be inferred. */
  intent?: QueryIntent;
  /** Max results to return (default 10). */
  limit?: number;
  /** Filter by memory systems (default: all). */
  memories?: MemorySystem[];
  /** Filter by tags (any-match). */
  tags?: string[];
  /** Min confidence to include. Default 0 (include all). */
  minConfidence?: ConfidenceLevel;
  /** Min freshness. Default LOW (include all). */
  minFreshness?: StalenessLevel;
  /** If true, return explanation for each result. */
  explain?: boolean;
}

export interface QueryExplanation {
  intent: QueryIntent;
  intentConfidence: number;
  /** Why we picked the top result. */
  topReason: string;
  /** Why we didn't pick other highly-scoring pages. */
  tradeoffs: string[];
  /** Memory systems searched and their weights. */
  memoryWeights: Record<MemorySystem, number>;
  /** Stats: total pages scanned, considered, returned. */
  stats: {
    totalScanned: number;
    considered: number;
    returned: number;
  };
}

export interface FullQueryResult {
  results: QueryResult[];
  explanation?: QueryExplanation;
}

// ---------------------------------------------------------------------------
// Intent detection
// ---------------------------------------------------------------------------

/**
 * Detect query intent from the query text using simple keyword heuristics.
 *
 * The detection is conservative — if we're not sure, we return "unknown",
 * which uses balanced weights across all memory systems. Better to give
 * a balanced result than a wrong one.
 */
export function detectIntent(query: string): {
  intent: QueryIntent;
  confidence: number;
} {
  const q = query.toLowerCase().trim();

  // Strong signals
  if (/^(what|apa|apa itu|definisi|arti)\b/.test(q) || /\bapa\b.*\b(it|itu)?\b/i.test(q)) {
    return { intent: "what", confidence: 0.7 };
  }
  if (/^(how|bagaimana|cara|gimana)\b/.test(q) || /\b(cara|langkah|tutorial)\b/.test(q)) {
    return { intent: "how", confidence: 0.7 };
  }
  if (/^(why|kenapa|mengapa)\b/.test(q) || /\b(kenapa|mengapa|alasan)\b/.test(q)) {
    return { intent: "why", confidence: 0.8 };
  }
  if (/^(when|kapan)\b/.test(q) || /\b(kapan|saat|waktu)\b/.test(q)) {
    return { intent: "when", confidence: 0.7 };
  }
  if (/\b(history|sejarah|kisah|cerita)\b/.test(q)) {
    return { intent: "history", confidence: 0.6 };
  }
  if (/^(compare|bandingkan|versus)\b/.test(q) || /\b(vs\.?|versus|bandingkan)\b/.test(q)) {
    return { intent: "compare", confidence: 0.8 };
  }
  if (/\b(pattern|kebiasaan|trend|umumnya|biasanya)\b/.test(q)) {
    return { intent: "pattern", confidence: 0.6 };
  }

  return { intent: "unknown", confidence: 0.3 };
}

// ---------------------------------------------------------------------------
// Freshness & confidence helpers
// ---------------------------------------------------------------------------

/**
 * Get the memory system for a page based on its pageType.
 */
export function pageMemory(page: WikiPage): MemorySystem {
  return PAGE_TYPE_TO_MEMORY[page.pageType] ?? "semantic";
}

/**
 * Compute freshness factor for a page. Pages checked recently get 1.0,
 * pages stale for a long time get 0.3.
 *
 * Formula: `0.3 + weight * 0.7` where weight is in [0, 1].
 *  - STALE (0.5) → 0.65
 *  - HIGH   (0.7) → 0.79
 *  - MEDIUM (0.9) → 0.93
 *  - LOW    (1.0) → 1.00
 */
export function freshnessFactor(page: WikiPage): number {
  const f = page.freshness;
  if (!f) return 0.8; // Unknown freshness — assume OK
  const weight = STALENESS_WEIGHT[f.staleness] ?? 0.5;
  return 0.3 + weight * 0.7;
}

/**
 * Confidence factor (0-1). We treat the numeric confidence field as primary
 * and the level as a fallback.
 */
export function confidenceFactor(page: WikiPage): number {
  if (typeof page.confidence === "number") {
    // Already 0-1 from WikiStore; clamp
    return Math.max(0.5, Math.min(1.0, page.confidence));
  }
  const lvl = (page as { confidenceLevel?: ConfidenceLevel }).confidenceLevel;
  if (lvl) {
    return CONFIDENCE_WEIGHT[lvl] ?? 0.7;
  }
  return 0.7; // Unknown — assume decent
}

/**
 * Title boost: if the query text is contained in the page title (or label),
 * give it a big boost. Exact match = 2.0, partial = 1.5, no match = 1.0.
 */
export function titleBoost(query: string, page: WikiPage): number {
  const q = query.toLowerCase().trim();
  const title = (page.label ?? page.id).toLowerCase();
  if (title === q) return 2.0;
  if (title.includes(q) || q.includes(title)) return 1.5;
  // Word overlap
  const qWords = q.split(/\s+/).filter((w) => w.length > 2);
  const tWords = title.split(/\s+/).filter((w) => w.length > 2);
  if (qWords.length === 0 || tWords.length === 0) return 1.0;
  const overlap = qWords.filter((w) => tWords.includes(w)).length;
  if (overlap > 0) return 1.0 + Math.min(0.5, overlap * 0.15);
  return 1.0;
}

// ---------------------------------------------------------------------------
// Text relevance
// ---------------------------------------------------------------------------

/**
 * Compute how relevant a page is to the query text. Uses a simple but
 * effective token-based score: how many query tokens appear in the page.
 *
 * Returns 0-1.
 */
export function textRelevance(query: string, page: WikiPage): number {
  const q = query.toLowerCase().trim();
  if (!q) return 0;
  const qTokens = new Set(q.split(/\W+/).filter((t) => t.length > 1));
  if (qTokens.size === 0) return 0;

  // Build the searchable text corpus
  const titleText = (page.label ?? page.id).toLowerCase();
  const bodyText = (typeof page.body === "string" ? page.body : "").toLowerCase();
  const tagText = (page.tags ?? []).join(" ").toLowerCase();
  const sourceText = (page.sources ?? []).join(" ").toLowerCase();

  // Title hits are 3x more important than body hits; tag hits 2x; sources 1x.
  let score = 0;
  for (const token of Array.from(qTokens)) {
    if (titleText.includes(token)) score += 3;
    if (tagText.includes(token)) score += 2;
    if (bodyText.includes(token)) score += 1;
    if (sourceText.includes(token)) score += 0.5;
  }

  // Normalize: max possible = qTokens.size * 6.5 (title + tag + body + source)
  const maxScore = qTokens.size * 6.5;
  return Math.min(1.0, score / maxScore);
}

// ---------------------------------------------------------------------------
// The Query class
// ---------------------------------------------------------------------------

export class QueryEngine {
  constructor(private store: WikiStore) {}

  /**
   * Run a query and return ranked results.
   */
  async query(
    queryText: string,
    opts: QueryOptions = {}
  ): Promise<FullQueryResult> {
    const {
      intent: explicitIntent,
      limit = 10,
      memories,
      tags,
      minConfidence,
      minFreshness,
      explain = false,
    } = opts;

    // 1. Detect intent
    const detected = explicitIntent
      ? { intent: explicitIntent, confidence: 1.0 }
      : detectIntent(queryText);
    const intent = detected.intent;
    const memoryWeights = INTENT_MEMORY_WEIGHTS[intent];

    // 2. Get all pages (we filter in memory — wiki is small, this is fine)
    const allPages = await this.store.listAll();
    const totalScanned = allPages.length;

    // 3. Filter
    let considered = allPages;
    if (memories && memories.length > 0) {
      const memSet = new Set(memories);
      considered = considered.filter((p) => memSet.has(pageMemory(p)));
    }
    if (tags && tags.length > 0) {
      const tagSet = new Set(tags);
      considered = considered.filter((p) =>
        p.tags.some((t) => tagSet.has(t))
      );
    }
    if (minConfidence) {
      const minWeight = CONFIDENCE_WEIGHT[minConfidence];
      considered = considered.filter((p) => {
        const w = typeof p.confidence === "number" ? p.confidence : CONFIDENCE_WEIGHT[(p as { confidenceLevel?: ConfidenceLevel }).confidenceLevel ?? "ASSUMED"];
        return w >= minWeight;
      });
    }
    if (minFreshness) {
      const minW = STALENESS_WEIGHT[minFreshness];
      considered = considered.filter((p) => {
        const w = STALENESS_WEIGHT[p.freshness?.staleness ?? "MEDIUM"];
        return w >= minW;
      });
    }

    // 4. Score each page
    const scored: QueryResult[] = considered.map((page) => {
      const textR = textRelevance(queryText, page);
      const mem = pageMemory(page);
      const memW = memoryWeights[mem] ?? 1;
      const confF = confidenceFactor(page);
      const freshF = freshnessFactor(page);
      const titleB = titleBoost(queryText, page);

      const score = textR * memW * confF * freshF * titleB;

      return {
        page,
        score,
        breakdown: {
          textRelevance: textR,
          memoryWeight: memW,
          confidenceFactor: confF,
          freshnessFactor: freshF,
          titleBoost: titleB,
        },
        confidence: Math.min(1.0, confF * freshF * (textR > 0 ? 1.0 : 0.5)),
      };
    });

    // 5. Sort and trim
    scored.sort((a, b) => b.score - a.score);
    const results = scored.slice(0, limit);

    // 6. Build explanation if requested
    let explanation: QueryExplanation | undefined;
    if (explain && results.length > 0) {
      const top = results[0];
      const topReason = [
        `Page "${top.page.label}" matched because:`,
        `  • text relevance ${top.breakdown.textRelevance.toFixed(2)} (how well words match)`,
        `  • memory weight ${top.breakdown.memoryWeight.toFixed(1)} (${pageMemory(top.page)} memory for "${intent}" intent)`,
        `  • confidence factor ${top.breakdown.confidenceFactor.toFixed(2)}`,
        `  • freshness factor ${top.breakdown.freshnessFactor.toFixed(2)}`,
        `  • title boost ${top.breakdown.titleBoost.toFixed(2)}`,
      ].join("\n");

      const tradeoffs: string[] = [];
      for (let i = 1; i < Math.min(results.length, 3); i++) {
        const r = results[i];
        tradeoffs.push(
          `Alternative #${i + 1}: "${r.page.label}" (${pageMemory(r.page)}) — score ${r.score.toFixed(2)}`
        );
      }

      explanation = {
        intent,
        intentConfidence: detected.confidence,
        topReason,
        tradeoffs,
        memoryWeights,
        stats: {
          totalScanned,
          considered: considered.length,
          returned: results.length,
        },
      };
    } else if (explain) {
      explanation = {
        intent,
        intentConfidence: detected.confidence,
        topReason: "No results matched the query.",
        tradeoffs: [],
        memoryWeights,
        stats: {
          totalScanned,
          considered: considered.length,
          returned: 0,
        },
      };
    }

    return { results, explanation };
  }

  /**
   * Convenience: just the page list, no breakdown.
   * Only returns pages with text relevance > 0 (i.e., actually matched).
   */
  async search(
    queryText: string,
    opts: QueryOptions = {}
  ): Promise<WikiPage[]> {
    const { results } = await this.query(queryText, opts);
    return results
      .filter((r) => r.breakdown.textRelevance > 0)
      .map((r) => r.page);
  }
}

// ---------------------------------------------------------------------------
// Compare two pages (the "compare" intent)
// ---------------------------------------------------------------------------

/**
 * Find pages that compare/contrast two concepts. Returns the union of
 * top results for each concept, with a small penalty for pages that
 * mention BOTH (they're more relevant for comparisons).
 */
export async function compareQuery(
  engine: QueryEngine,
  conceptA: string,
  conceptB: string,
  opts: QueryOptions = {}
): Promise<{ aResults: WikiPage[]; bResults: WikiPage[]; both: WikiPage[] }> {
  const a = await engine.search(conceptA, { ...opts, intent: "compare", limit: 20 });
  const b = await engine.search(conceptB, { ...opts, intent: "compare", limit: 20 });
  const aIds = new Set(a.map((p) => p.id));
  const bIds = new Set(b.map((p) => p.id));
  const both = a.filter((p) => bIds.has(p.id));
  const aOnly = a.filter((p) => !bIds.has(p.id));
  const bOnly = b.filter((p) => !aIds.has(p.id));
  return { aResults: aOnly, bResults: bOnly, both };
}
