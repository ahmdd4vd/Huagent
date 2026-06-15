/**
 * wllm/graph/wiki-store.ts
 *
 * WikiStore — the central storage layer for WllmConcept.
 * Wraps Huagent v4.0 GraphStore (bi-temporal property graph) and adds:
 *   - 5-memory routing (semantic, episodic, structural, causal, meta)
 *   - WikiPage CRUD with all 5-memory-specific fields
 *   - Bi-temporal versioning (inherited from graph)
 *   - Confidence lifecycle (ASSUMED → INFERRED → VERIFIED)
 *   - Freshness tracking
 *   - Cross-page navigation ([[wikilink]] resolution)
 *
 * This is the SINGLE SOURCE OF TRUTH for all wiki data.
 * Markdown files are a derived view (export/import in sync module).
 */

import { randomUUID } from "node:crypto";
import {
  type GraphStore,
  InMemoryGraphStore,
} from "../../engine/v4/graph/store.js";
import {
  type WikiPage,
  type WikiEdge,
  type PageType,
  type ConfidenceLevel,
  type ConfidenceLevel as _CL, // alias for internal use
  type MemorySystem,
  type Freshness,
  type StalenessLevel,
  type EpisodeCategory,
  type EpisodeOutcome,
  type EpisodeDifficulty,
  type DecisionStatus,
  type SearchHit,
  type QueryIntent,
  type INTENT_MEMORY_WEIGHTS,
  PAGE_TYPE_TO_MEMORY,
  CONFIDENCE_WEIGHT,
  STALENESS_WEIGHT,
  computeStaleness,
  numericToConfidence,
  slugify,
} from "../types/index.js";

/**
 * Options for creating/updating a wiki page.
 * All optional — sensible defaults are applied.
 */
export interface CreatePageOptions {
  /** Optional explicit id (for re-import to preserve identity) */
  id?: string;
  pageType: PageType;
  label: string;
  body: string;
  confidenceLevel?: ConfidenceLevel;
  confidence?: number;
  sources?: string[];
  tags?: string[];
  related?: string[];
  subtype?: string;
  frontmatter?: Record<string, unknown>;
  validFrom?: number;
  // Episode-specific
  episodeDate?: number;
  episodeDurationMin?: number;
  episodeOutcome?: EpisodeOutcome;
  episodeDifficulty?: EpisodeDifficulty;
  episodeAffectedFiles?: string[];
  episodeLessons?: string[];
  // Decision-specific
  decisionDate?: number;
  decisionStatus?: DecisionStatus;
  decisionRevisit?: number;
  decisionStakeholders?: string[];
  decisionAlternativesRejected?: Array<{ name: string; reason: string }>;
  decisionTradeoffsAccepted?: string[];
}

export interface UpdatePageOptions {
  label?: string;
  body?: string;
  confidenceLevel?: ConfidenceLevel;
  sources?: string[];
  tags?: string[];
  related?: string[];
  frontmatter?: Record<string, unknown>;
  /** Mark as just-checked (updates freshness) */
  markChecked?: boolean;
}

export interface WikiStoreOptions {
  /** Underlying graph store (defaults to in-memory) */
  graph?: GraphStore;
  /** Freshness window in days (default: 7) */
  freshnessWindowDays?: number;
}

/**
 * WikiStore — the 5-memory wiki storage.
 */
export class WikiStore {
  readonly graph: GraphStore;
  private readonly freshnessWindowMs: number;

  constructor(opts: WikiStoreOptions = {}) {
    this.graph = opts.graph ?? new InMemoryGraphStore();
    this.freshnessWindowMs = (opts.freshnessWindowDays ?? 7) * 24 * 60 * 60 * 1000;
  }

  // ===================================================================
  // PAGE CRUD
  // ===================================================================

  /**
   * Create a new wiki page.
   * Returns the created page with assigned id and timestamps.
   */
  async createPage(opts: CreatePageOptions): Promise<WikiPage> {
    const now = Date.now();
    const confLevel = opts.confidenceLevel ?? numericToConfidence(opts.confidence ?? 0.7);
    const conf = opts.confidence ?? CONFIDENCE_WEIGHT[confLevel];

    // Pack WikiPage-specific fields into properties for roundtrip through GraphStore
    const wikiProps: Record<string, unknown> = {
      pageType: opts.pageType,
      confidenceLevel: confLevel,
      freshness: {
        lastChecked: now,
        staleness: "LOW",
      },
      sources: opts.sources ?? [],
      tags: opts.tags ?? [],
      related: opts.related ?? [],
      frontmatter: opts.frontmatter,
      subtype: opts.subtype,
      episodeDate: opts.episodeDate,
      episodeDurationMin: opts.episodeDurationMin,
      episodeOutcome: opts.episodeOutcome,
      episodeDifficulty: opts.episodeDifficulty,
      episodeAffectedFiles: opts.episodeAffectedFiles,
      episodeLessons: opts.episodeLessons,
      decisionDate: opts.decisionDate,
      decisionStatus: opts.decisionStatus,
      decisionRevisit: opts.decisionRevisit,
      decisionStakeholders: opts.decisionStakeholders,
      decisionAlternativesRejected: opts.decisionAlternativesRejected,
      decisionTradeoffsAccepted: opts.decisionTradeoffsAccepted,
    };

    const page: WikiPage = {
      id: opts.id || randomUUID(),
      kind: opts.pageType as any,
      pageType: opts.pageType,
      label: opts.label,
      body: opts.body,
      properties: wikiProps,
      confidence: conf,
      confidenceLevel: confLevel,
      freshness: {
        lastChecked: now,
        staleness: "LOW",
      },
      sources: opts.sources ?? [],
      tags: opts.tags ?? [],
      related: opts.related ?? [],
      frontmatter: opts.frontmatter,
      subtype: opts.subtype,
      validFrom: opts.validFrom ?? now,
      validTo: null,
      recordedAt: now,
      episodeDate: opts.episodeDate,
      episodeDurationMin: opts.episodeDurationMin,
      episodeOutcome: opts.episodeOutcome,
      episodeDifficulty: opts.episodeDifficulty,
      episodeAffectedFiles: opts.episodeAffectedFiles,
      episodeLessons: opts.episodeLessons,
      decisionDate: opts.decisionDate,
      decisionStatus: opts.decisionStatus,
      decisionRevisit: opts.decisionRevisit,
      decisionStakeholders: opts.decisionStakeholders,
      decisionAlternativesRejected: opts.decisionAlternativesRejected,
      decisionTradeoffsAccepted: opts.decisionTradeoffsAccepted,
    };

    const created = (await this.graph.addNode(page as any)) as unknown as WikiPage;
    return this.hydrate(created);
  }

  /**
   * Hydrate a raw node from graph storage into a full WikiPage.
   * Reads WikiPage-specific fields from `properties` JSON.
   */
  private hydrate(node: any): WikiPage {
    if (!node) return node;
    const props = node.properties ?? {};
    return {
      ...node,
      pageType: props.pageType ?? node.pageType ?? node.kind,
      confidenceLevel: props.confidenceLevel ?? node.confidenceLevel ?? "ASSUMED",
      freshness: props.freshness ?? node.freshness ?? { lastChecked: Date.now(), staleness: "LOW" },
      sources: props.sources ?? node.sources ?? [],
      tags: props.tags ?? node.tags ?? [],
      related: props.related ?? node.related ?? [],
      frontmatter: props.frontmatter ?? node.frontmatter,
      subtype: props.subtype ?? node.subtype,
      episodeDate: props.episodeDate ?? node.episodeDate,
      episodeDurationMin: props.episodeDurationMin ?? node.episodeDurationMin,
      episodeOutcome: props.episodeOutcome ?? node.episodeOutcome,
      episodeDifficulty: props.episodeDifficulty ?? node.episodeDifficulty,
      episodeAffectedFiles: props.episodeAffectedFiles ?? node.episodeAffectedFiles,
      episodeLessons: props.episodeLessons ?? node.episodeLessons,
      decisionDate: props.decisionDate ?? node.decisionDate,
      decisionStatus: props.decisionStatus ?? node.decisionStatus,
      decisionRevisit: props.decisionRevisit ?? node.decisionRevisit,
      decisionStakeholders: props.decisionStakeholders ?? node.decisionStakeholders,
      decisionAlternativesRejected: props.decisionAlternativesRejected ?? node.decisionAlternativesRejected,
      decisionTradeoffsAccepted: props.decisionTradeoffsAccepted ?? node.decisionTradeoffsAccepted,
    } as WikiPage;
  }

  /**
   * Get a page by id, optionally at a specific time (bi-temporal).
   */
  async getPage(id: string, asOf?: number): Promise<WikiPage | null> {
    const n = await this.graph.getNode(id, asOf);
    if (!n) return null;
    return this.hydrate(n);
  }

  /**
   * Get a page by label (slug).
   * Returns the first match (most recent if multiple).
   * Match priority: exact slug > exact label (case-insensitive) > prefix match.
   */
  async getPageByLabel(label: string, asOf?: number): Promise<WikiPage | null> {
    const slug = slugify(label);
    const labelLower = label.toLowerCase().trim();
    const all = await this.listAll();

    // 1. Exact slug match
    for (const p of all) {
      if (slugify(p.label) === slug) return p;
    }
    // 2. Exact label match (case-insensitive, trimmed)
    for (const p of all) {
      if (p.label.toLowerCase().trim() === labelLower) return p;
    }
    // 3. Slug is a prefix of the page slug (e.g., "redis" matches "redis-cache")
    for (const p of all) {
      const pSlug = slugify(p.label);
      if (pSlug.startsWith(slug + "-") || pSlug === slug) return p;
    }
    return null;
  }

  /**
   * Update a page (creates a new version, preserves history).
   */
  async updatePage(id: string, opts: UpdatePageOptions, newValidFrom?: number): Promise<WikiPage | null> {
    const now = Date.now();
    const current = await this.getPage(id);
    if (!current) return null;

    // Build patch with both top-level fields AND properties (for roundtrip through graph store)
    const patch: Record<string, unknown> = {};
    if (opts.label !== undefined) {
      patch.label = opts.label;
    }
    if (opts.body !== undefined) {
      patch.body = opts.body;
    }
    if (opts.confidenceLevel !== undefined) {
      patch.confidenceLevel = opts.confidenceLevel;
      patch.confidence = CONFIDENCE_WEIGHT[opts.confidenceLevel];
    }
    if (opts.sources !== undefined) {
      patch.sources = opts.sources;
    }
    if (opts.tags !== undefined) {
      patch.tags = opts.tags;
    }
    if (opts.related !== undefined) {
      patch.related = opts.related;
    }
    if (opts.frontmatter !== undefined) {
      patch.frontmatter = opts.frontmatter;
    }
    if (opts.markChecked) {
      patch.freshness = {
        lastChecked: now,
        staleness: "LOW",
      };
    }

    // Merge into properties (for roundtrip through graph store)
    const updatedProps = { ...(current.properties ?? {}) };
    for (const k of Object.keys(patch)) {
      if (["pageType","confidenceLevel","freshness","sources","tags","related","frontmatter","subtype","episodeDate","episodeDurationMin","episodeOutcome","episodeDifficulty","episodeAffectedFiles","episodeLessons","decisionDate","decisionStatus","decisionRevisit","decisionStakeholders","decisionAlternativesRejected","decisionTradeoffsAccepted"].includes(k)) {
        updatedProps[k] = patch[k];
      }
    }
    patch.properties = updatedProps;

    const updated = (await this.graph.updateNode(id, patch as any, newValidFrom)) as unknown as WikiPage | null;
    if (!updated) return null;
    // Re-hydrate from current to get all fields (graph only stores the patched ones)
    return this.getPage(id);
  }

  /**
   * Promote a page's confidence (ASSUMED → INFERRED → VERIFIED).
   * Returns the updated page, or null if promotion is invalid.
   */
  async promoteConfidence(id: string, to: ConfidenceLevel): Promise<WikiPage | null> {
    const current = await this.getPage(id);
    if (!current) return null;

    // Validate promotion direction
    const currentWeight = CONFIDENCE_WEIGHT[current.confidenceLevel];
    const targetWeight = CONFIDENCE_WEIGHT[to];
    if (targetWeight <= currentWeight && to !== "CONTRADICTED" && to !== "RESOLVED") {
      return null;  // Cannot demote (except to CONTRADICTED)
    }

    return this.updatePage(id, { confidenceLevel: to, markChecked: true });
  }

  /**
   * Mark a page as CONTRADICTED (used by lint).
   */
  async markContradicted(id: string): Promise<WikiPage | null> {
    return this.updatePage(id, { confidenceLevel: "CONTRADICTED" });
  }

  /**
   * Set a custom freshness for a page (used by tests and for manually marking stale).
   * Unlike markChecked (which uses "now"), this lets you set a specific lastChecked.
   */
  async setFreshness(id: string, freshness: Freshness): Promise<WikiPage | null> {
    const now = Date.now();
    const current = await this.getPage(id);
    if (!current) return null;

    const updatedProps = { ...(current.properties ?? {}), freshness };
    const updated = (await this.graph.updateNode(id, { properties: updatedProps } as any, now)) as unknown as WikiPage | null;
    return this.getPage(id);
  }

  /**
   * Update freshness for a page (used by periodic recheck).
   */
  async refreshFreshness(id: string, now: number = Date.now()): Promise<WikiPage | null> {
    const current = await this.getPage(id);
    if (!current) return null;
    return this.updatePage(id, {
      markChecked: true,
    });
  }

  /**
   * Delete a page (supersedes by setting validTo).
   * History is preserved.
   */
  async deletePage(id: string): Promise<boolean> {
    const updated = await this.updatePage(id, {}, Date.now());
    // Also need to set validTo on the current version
    const current = await this.graph.getNode(id);
    if (current) {
      (current as any).validTo = Date.now();
      await this.graph.updateNode(id, { validTo: Date.now() } as any);
    }
    return updated !== null;
  }

  // ===================================================================
  // EDGE OPERATIONS
  // ===================================================================

  /**
   * Add a wiki edge (link from one page to another).
   */
  async addEdge(fromId: string, toId: string, relation: string, weight: number = 1.0, properties: Record<string, unknown> = {}): Promise<WikiEdge> {
    const e = await this.graph.addEdge({
      fromNode: fromId,
      toNode: toId,
      kind: relation as any,
      weight,
      properties,
      validFrom: Date.now(),
      validTo: null,
      confidence: 1.0,
    } as any);
    return { ...(e as any), relation };
  }

  /**
   * Get all edges from a page (outgoing).
   */
  async getOutgoingEdges(pageId: string): Promise<WikiEdge[]> {
    const result = await this.graph.query({
      from: [pageId],
      direction: "out",
      maxDepth: 1,
    });
    return result.edges as unknown as WikiEdge[];
  }

  /**
   * Get all edges to a page (incoming — for backlinks).
   */
  async getIncomingEdges(pageId: string): Promise<WikiEdge[]> {
    const result = await this.graph.query({
      from: [pageId],
      direction: "in",
      maxDepth: 1,
    });
    return result.edges as unknown as WikiEdge[];
  }

  /**
   * Get all pages that link TO this page (backlinks).
   */
  async getBacklinks(pageId: string): Promise<WikiPage[]> {
    const incoming = await this.getIncomingEdges(pageId);
    const pageIds = Array.from(new Set(incoming.map(e => e.fromNode)));
    const pages: WikiPage[] = [];
    for (const id of pageIds) {
      const p = await this.getPage(id);
      if (p) pages.push(p);
    }
    return pages;
  }

  // ===================================================================
  // 5-MEMORY QUERIES
  // ===================================================================

  /**
   * List all pages of a given memory system (or all).
   * Returns the current versions (validTo === null).
   */
  async listByMemory(memory?: MemorySystem, limit: number = 1000): Promise<WikiPage[]> {
    const all = await this.listAll(limit);
    if (!memory) return all;
    return all.filter(p => PAGE_TYPE_TO_MEMORY[p.pageType] === memory);
  }

  /**
   * List all pages of a given page type.
   */
  async listByType(pageType: PageType, limit: number = 1000): Promise<WikiPage[]> {
    const all = await this.listAll(limit);
    return all.filter(p => p.pageType === pageType);
  }

  /**
   * List all current pages.
   */
  async listAll(limit: number = 1000): Promise<WikiPage[]> {
    const all = await this.graph.search("", limit * 2);
    return all.filter(p => p.validTo === null).map(p => this.hydrate(p));
  }

  /**
   * Search across the wiki with a text query.
   * Returns ranked SearchHit[].
   */
  async search(query: string, limit: number = 20, intent: QueryIntent = "unknown"): Promise<SearchHit[]> {
    const t = query.toLowerCase().trim();
    if (!t) return [];

    // Import weights here to avoid circular dep at top
    const { INTENT_MEMORY_WEIGHTS } = await import("../types/index.js");

    const allPages = await this.listAll(1000);
    const hits: SearchHit[] = [];

    for (const p of allPages) {
      const memory = PAGE_TYPE_TO_MEMORY[p.pageType];
      const memoryWeight = INTENT_MEMORY_WEIGHTS[intent][memory];

      // Relevance: simple keyword match
      const labelMatch = p.label.toLowerCase().includes(t);
      const bodyMatch = p.body?.toLowerCase().includes(t) ?? false;
      const tagMatch = p.tags.some(tag => tag.toLowerCase().includes(t));
      const relatedMatch = p.related.some(r => r.toLowerCase().includes(t));

      let relevance = 0;
      if (labelMatch) relevance += 0.5;
      if (bodyMatch) relevance += 0.3;
      if (tagMatch) relevance += 0.1;
      if (relatedMatch) relevance += 0.1;

      if (relevance === 0) continue;

      const confidenceWeight = CONFIDENCE_WEIGHT[p.confidenceLevel] ?? 0.5;
      const freshnessWeight = STALENESS_WEIGHT[p.freshness.staleness] ?? 0.5;

      const score = relevance * confidenceWeight * freshnessWeight * (memoryWeight / 5);

      // Snippet
      let snippet = "";
      if (p.body) {
        const idx = p.body.toLowerCase().indexOf(t);
        if (idx >= 0) {
          const start = Math.max(0, idx - 50);
          const end = Math.min(p.body.length, idx + 150);
          snippet = (start > 0 ? "..." : "") + p.body.slice(start, end) + (end < p.body.length ? "..." : "");
        } else {
          snippet = p.body.slice(0, 200);
        }
      }

      hits.push({
        page: p,
        relevance,
        confidenceWeight,
        freshnessWeight,
        memory,
        score,
        snippet,
      });
    }

    hits.sort((a, b) => b.score - a.score);
    return hits.slice(0, limit);
  }

  /**
   * Get all pages that need re-checking (staleness > LOW).
   */
  async getStalePages(): Promise<WikiPage[]> {
    const all = await this.listAll();
    const now = Date.now();
    return all.filter(p => {
      const s = computeStaleness(p.freshness.lastChecked, this.freshnessWindowMs, now);
      return s !== "LOW";
    });
  }

  /**
   * Update all pages' freshness (called by periodic cron).
   */
  async refreshAllFreshness(): Promise<number> {
    const all = await this.listAll();
    let count = 0;
    for (const p of all) {
      await this.refreshFreshness(p.id);
      count++;
    }
    return count;
  }

  // ===================================================================
  // STATS
  // ===================================================================

  /**
   * Get stats about the wiki.
   */
  async getStats(): Promise<{
    totalPages: number;
    byMemory: Record<MemorySystem, number>;
    byConfidence: Record<ConfidenceLevel, number>;
    byStaleness: Record<StalenessLevel, number>;
    totalEdges: number;
  }> {
    const all = await this.listAll();
    const edges = await this.graph.count();

    const byMemory: Record<MemorySystem, number> = {
      semantic: 0, episodic: 0, structural: 0, causal: 0, meta: 0,
    };
    const byConfidence: Record<string, number> = {
      VERIFIED: 0, INFERRED: 0, ASSUMED: 0, CONTRADICTED: 0, RESOLVED: 0,
    };
    const byStaleness: Record<string, number> = {
      LOW: 0, MEDIUM: 0, HIGH: 0, STALE: 0,
    };

    const now = Date.now();
    for (const p of all) {
      const mem = PAGE_TYPE_TO_MEMORY[p.pageType];
      byMemory[mem]++;
      byConfidence[p.confidenceLevel] = (byConfidence[p.confidenceLevel] ?? 0) + 1;
      const s = computeStaleness(p.freshness.lastChecked, this.freshnessWindowMs, now);
      byStaleness[s] = (byStaleness[s] ?? 0) + 1;
    }

    return {
      totalPages: all.length,
      byMemory,
      byConfidence: byConfidence as Record<ConfidenceLevel, number>,
      byStaleness: byStaleness as Record<StalenessLevel, number>,
      totalEdges: edges.edges,
    };
  }

  /**
   * Clear all data (for testing).
   */
  async clear(): Promise<void> {
    await this.graph.clear();
  }
}
