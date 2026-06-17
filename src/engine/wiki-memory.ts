/**
 * WikiMemory — WikiStore wrapper with MemoryManager-compatible API
 * 
 * Provides backward compatibility while using WikiStore (5-memory system) under the hood.
 * Maps old memory operations to wiki page operations:
 *   - recordEpisode → createPage (pageType: 'episode')
 *   - recordPattern → createPage (pageType: 'concept')
 *   - saveProjectFact → createPage (pageType: 'entity')
 *   - recall → search (with intent detection)
 */

import type { WikiStore, CreatePageOptions } from '../wllm/graph/wiki-store.js';
import type { WikiPage, PageType, ConfidenceLevel, MemorySystem, QueryIntent } from '../wllm/types/index.js';
import type { MemoryEntry } from '../types/index.js';

export class WikiMemory {
  constructor(private wikiStore: WikiStore) {}

  /**
   * Get the underlying WikiStore (for advanced operations like Evolve)
   */
  getStore(): WikiStore {
    return this.wikiStore;
  }

  /**
   * Record an episodic memory (event that happened).
   * Maps to: WikiPage with pageType='episode'
   */
  recordEpisode(
    content: string,
    metadata: Record<string, any> = {},
    importance: number = 0.5
  ): string {
    const opts: CreatePageOptions = {
      pageType: 'episode',
      label: content.slice(0, 100), // Use first 100 chars as label
      body: content,
      confidenceLevel: this.importanceToConfidence(importance),
      tags: metadata.tags || [],
      sources: metadata.sources || [],
      subtype: metadata.subtype || 'general',
      episodeDate: Date.now(),
      episodeDurationMin: metadata.durationMin,
      episodeOutcome: metadata.outcome || 'RESOLVED',
      episodeDifficulty: metadata.difficulty || 'MEDIUM',
      episodeAffectedFiles: metadata.affectedFiles || [],
      episodeLessons: metadata.lessons || [],
    };

    // Create page asynchronously, but return id synchronously
    const id = `ep-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    opts.id = id;
    
    this.wikiStore.createPage(opts).catch(err => {
      console.error('[WikiMemory] Failed to record episode:', err);
    });

    return id;
  }

  /**
   * Record a semantic fact (project fact).
   * Maps to: WikiPage with pageType='entity'
   */
  saveProjectFact(key: string, value: string): void {
    const opts: CreatePageOptions = {
      pageType: 'entity',
      label: key,
      body: value,
      confidenceLevel: 'VERIFIED',
      tags: ['project-fact'],
    };

    this.wikiStore.createPage(opts).catch(err => {
      console.error('[WikiMemory] Failed to save project fact:', err);
    });
  }

  /**
   * Record a procedural pattern (how-to).
   * Maps to: WikiPage with pageType='concept'
   */
  recordPattern(
    name: string,
    description: string,
    pattern: string,
    examples: string[] = []
  ): void {
    const body = `${description}\n\n## Pattern\n${pattern}\n\n## Examples\n${examples.join('\n')}`;
    
    const opts: CreatePageOptions = {
      pageType: 'concept',
      label: name,
      body,
      confidenceLevel: 'INFERRED',
      tags: ['pattern', 'procedural'],
      subtype: 'procedural',
    };

    this.wikiStore.createPage(opts).catch(err => {
      console.error('[WikiMemory] Failed to record pattern:', err);
    });
  }

  /**
   * Recall memories relevant to a query.
   * Maps to: WikiStore.search with intent detection
   */
  async recall(query: string, limit: number = 5): Promise<MemoryEntry[]> {
    // Detect query intent
    const intent = this.detectIntent(query);
    
    // Search wiki with 5-memory routing
    const hits = await this.wikiStore.search(query, limit, intent);
    
    // Convert SearchHit[] to MemoryEntry[]
    return hits.map(hit => ({
      id: hit.page.id,
      content: hit.page.body || hit.page.label,
      type: this.pageTypeToMemoryType(hit.page),
      importance: this.confidenceToImportance(hit.page.confidenceLevel),
      lastAccessed: hit.page.freshness.lastChecked,
      createdAt: hit.page.validFrom,
      accessCount: 0, // TODO: track access count
      metadata: {
        pageType: hit.page.pageType,
        confidenceLevel: hit.page.confidenceLevel,
        staleness: hit.page.freshness.staleness,
        tags: hit.page.tags,
        sources: hit.page.sources,
        score: hit.score,
        snippet: hit.snippet,
      },
    }));
  }

  /**
   * Get memory statistics.
   */
  async stats(): Promise<{ memories: number; skills: number; facts: number; sessions: number }> {
    const stats = await this.wikiStore.getStats();
    
    return {
      memories: stats.totalPages,
      skills: stats.byMemory.structural + stats.byMemory.meta, // patterns + meta
      facts: stats.byMemory.semantic + stats.byMemory.episodic, // entities + episodes
      sessions: 0, // Sessions are handled separately
    };
  }

  /**
   * Get learned skills (procedural patterns).
   */
  async getLearnedSkills(): Promise<Array<{ name: string; description: string; useCount: number; successRate: number }>> {
    const concepts = await this.wikiStore.listByType('concept');
    
    return concepts
      .filter(p => p.subtype === 'procedural')
      .map(p => ({
        name: p.label,
        description: p.body?.slice(0, 200) || '',
        useCount: 0, // TODO: track usage
        successRate: this.confidenceToImportance(p.confidenceLevel),
      }));
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  /**
   * Convert importance (0-1) to confidence level.
   */
  private importanceToConfidence(importance: number): ConfidenceLevel {
    if (importance >= 0.9) return 'VERIFIED';
    if (importance >= 0.7) return 'INFERRED';
    if (importance >= 0.5) return 'ASSUMED';
    return 'ASSUMED';
  }

  /**
   * Convert confidence level to importance (0-1).
   */
  private confidenceToImportance(confidence: ConfidenceLevel): number {
    const map: Record<ConfidenceLevel, number> = {
      VERIFIED: 1.0,
      INFERRED: 0.8,
      ASSUMED: 0.5,
      CONTRADICTED: 0.2,
      RESOLVED: 0.9,
    };
    return map[confidence] ?? 0.5;
  }

  /**
   * Convert page type to memory type.
   *
   * The new 5-memory system (semantic / episodic / structural / causal / meta)
   * is collapsed onto the legacy 4-type MemoryEntry union
   * (episodic / semantic / procedural / project) like this:
   *
   *   semantic   → semantic      (entity, concept, source, comparison)
   *   episodic   → episodic      (episode, failure)
   *   structural → procedural    (structure — code/architecture how-to)
   *   causal     → semantic      (decision, tradeoff, migration — facts about
   *                               decisions we made)
   *   meta       → procedural    (meta — heuristics/lessons are procedural)
   *
   * Additionally, a `concept` page with subtype `'procedural'` (created by
   * `recordPattern`) maps to `'procedural'` rather than `'semantic'` — this
   * preserves the original "patterns are procedural" semantic that the
   * legacy MemoryManager API promised.
   */
  private pageTypeToMemoryType(page: WikiPage): 'episodic' | 'semantic' | 'procedural' | 'project' {
    // Special case: procedural concept patterns stay procedural.
    if (page.pageType === 'concept' && page.subtype === 'procedural') {
      return 'procedural';
    }

    const map: Record<PageType, 'episodic' | 'semantic' | 'procedural' | 'project'> = {
      episode: 'episodic',
      entity: 'semantic',
      concept: 'semantic',
      decision: 'semantic',
      failure: 'episodic',
      tradeoff: 'semantic',
      migration: 'semantic',
      structure: 'procedural',
      meta: 'procedural',
      source: 'semantic',
      comparison: 'semantic',
    };
    return map[page.pageType] ?? 'episodic';
  }

  /**
   * Detect query intent for 5-memory routing.
   */
  private detectIntent(query: string): QueryIntent {
    const q = query.toLowerCase();
    
    // "what is X" → what (semantic)
    if (q.includes('what is') || q.includes('define') || q.includes('apa itu')) {
      return 'what';
    }
    
    // "how to X" → how (structural)
    if (q.includes('how to') || q.includes('how do') || q.includes('gimana') || q.includes('bagaimana')) {
      return 'how';
    }
    
    // "why X" → why (causal)
    if (q.includes('why') || q.includes('reason') || q.includes('kenapa') || q.includes('mengapa')) {
      return 'why';
    }
    
    // "when X" → when (episodic)
    if (q.includes('when') || q.includes('time') || q.includes('kapan')) {
      return 'when';
    }
    
    // "compare X vs Y" → compare (semantic)
    if (q.includes('compare') || q.includes('vs') || q.includes('versus') || q.includes('bandingin')) {
      return 'compare';
    }
    
    // "pattern X" → pattern (meta)
    if (q.includes('pattern') || q.includes('pola') || q.includes('heuristic')) {
      return 'pattern';
    }
    
    // "history X" → history (episodic)
    if (q.includes('history') || q.includes('riwayat') || q.includes('session')) {
      return 'history';
    }
    
    // Default to unknown
    return 'unknown';
  }
}
