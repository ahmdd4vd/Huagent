// Memory manager - high-level operations on top of the store
// Handles: episodic, semantic, procedural, project memory

import { MemoryStore } from './store.js';
import type { MemoryEntry, Message, Plan } from '../types/index.js';

export class MemoryManager {
  private store: MemoryStore;
  private contextBudget: number;

  constructor(store: MemoryStore, contextBudget = 100000) {
    this.store = store;
    this.contextBudget = contextBudget;
  }

  // Record an episodic memory (event that happened)
  recordEpisode(content: string, metadata: Record<string, any> = {}, importance = 0.5): string {
    return this.store.save({
      type: 'episodic',
      content,
      metadata: { ...metadata, recordedAt: Date.now() },
      importance,
    });
  }

  // Record a semantic fact (learned knowledge)
  recordFact(content: string, metadata: Record<string, any> = {}, importance = 0.7): string {
    return this.store.save({
      type: 'semantic',
      content,
      metadata,
      importance,
    });
  }

  // Record a procedural pattern (how to do something)
  recordPattern(name: string, description: string, pattern: string, examples: any[] = []): void {
    this.store.saveSkill(name, description, pattern, examples);

    // Also save to memories for retrieval
    this.store.save({
      type: 'procedural',
      content: `Pattern: ${name}\n${description}\n\n${pattern}`,
      metadata: { patternName: name, examples },
      importance: 0.8,
    });
  }

  // Save project context
  saveProjectFact(key: string, value: string, confidence = 1.0): void {
    this.store.saveFact(key, value, 'user', confidence);
  }

  // Retrieve relevant memories for current context
  // Combines: recency + importance + semantic match
  recall(query: string, limit = 10): MemoryEntry[] {
    const results: MemoryEntry[] = [];

    // 1. Semantic search (simple LIKE for now)
    const semantic = this.store.search(query, { limit });
    results.push(...semantic);

    // 2. Recent high-importance
    const recent = this.store.recent(20);
    for (const r of recent) {
      if (!results.find((x) => x.id === r.id)) {
        results.push(r);
        if (results.length >= limit) break;
      }
    }

    // 3. Project facts
    const facts = this.store.getFacts();
    for (const [key, value] of Object.entries(facts)) {
      if (key.toLowerCase().includes(query.toLowerCase()) ||
          value.toLowerCase().includes(query.toLowerCase())) {
        results.push({
          id: `fact-${key}`,
          type: 'project',
          content: `${key}: ${value}`,
          metadata: { key, value },
          createdAt: Date.now(),
          lastAccessed: Date.now(),
          accessCount: 0,
          importance: 0.9,
        });
      }
    }

    // Sort by importance + recency (exponential decay for time)
    // Half-life: 24 hours. A memory from 1 day ago scores 0.5x, 2 days = 0.25x, etc.
    const now = Date.now();
    const HALF_LIFE_MS = 24 * 60 * 60 * 1000;
    return results
      .sort((a, b) => {
        const ageA = Math.max(0, now - a.lastAccessed);
        const ageB = Math.max(0, now - b.lastAccessed);
        const recencyA = Math.pow(0.5, ageA / HALF_LIFE_MS);
        const recencyB = Math.pow(0.5, ageB / HALF_LIFE_MS);
        const scoreA = a.importance * 0.6 + recencyA * 0.4;
        const scoreB = b.importance * 0.6 + recencyB * 0.4;
        return scoreB - scoreA;
      })
      .slice(0, limit);
  }

  // Build context for LLM: relevant memories + recent messages
  buildContext(query: string, recentMessages: Message[]): string {
    const memories = this.recall(query, 5);
    const facts = this.store.getFacts();

    let context = '';

    if (Object.keys(facts).length > 0) {
      context += '## Project Facts\n';
      for (const [k, v] of Object.entries(facts)) {
        context += `- ${k}: ${v}\n`;
      }
      context += '\n';
    }

    if (memories.length > 0) {
      context += '## Relevant Memories\n';
      for (const m of memories) {
        context += `- [${m.type}] ${m.content.slice(0, 200)}\n`;
      }
      context += '\n';
    }

    // Recent messages summary
    if (recentMessages.length > 0) {
      context += `## Recent Conversation (last ${recentMessages.length} messages)\n`;
      for (const m of recentMessages.slice(-5)) {
        context += `[${m.role}] ${m.content.slice(0, 150)}\n`;
      }
    }

    return context;
  }

  // Learn a new skill/procedural pattern
  learnSkill(content: string, metadata: Record<string, any> = {}): void {
    this.recordPattern(
      `learned_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      metadata.domain ? `Pattern for ${metadata.domain}` : 'Learned pattern',
      content,
      []
    );
  }

  // Learn from a completed plan
  learnFromPlan(plan: Plan, outcome: 'success' | 'failure' | 'partial'): void {
    this.recordEpisode(
      `Plan: ${plan.goal}\nOutcome: ${outcome}\nSteps: ${plan.steps.length}\nCritique: ${plan.critique || 'none'}`,
      { planId: plan.id, outcome },
      outcome === 'success' ? 0.7 : 0.9 // failures are more important to remember
    );

    // Extract reusable patterns from successful plans
    if (outcome === 'success' && plan.steps.length > 0) {
      const patternName = `auto_${plan.goal.slice(0, 30).replace(/\W/g, '_')}`;
      const pattern = plan.steps
        .map((s) => `${s.tool || 'think'}: ${s.description}`)
        .join('\n');
      this.recordPattern(patternName, `Auto-learned from: ${plan.goal}`, pattern, []);
    }
  }

  // Get all skills learned
  getLearnedSkills() {
    return this.store.listSkills();
  }

  // Stats
  stats() {
    return this.store.stats();
  }
}
