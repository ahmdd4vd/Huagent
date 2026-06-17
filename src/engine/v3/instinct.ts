// ✦ Instinct Synthesizer — Continuous Learning ✦
// Inspired by ECC's continuous-learning-v2 + instincts system
// Innovation: Auto-synthesize actionable instincts from episode clusters

import type { MemoryManager } from '../../memory/manager.js';
import type { Plan, PlanStep } from '../../types/index.js';
import type { CritiqueResult } from '../critic.js';

export type InstinctType = 'recipe' | 'anti_pattern' | 'convention' | 'preference';
export type InstinctScope = 'project' | 'global';

export interface Instinct {
  id: string;
  type: InstinctType;
  scope: InstinctScope;
  trigger: string;          // Pattern that triggers this instinct
  action: string;           // What to do / not do
  confidence: number;       // 0-1
  evidence: number;         // how many episodes support this
  createdAt: number;
  lastReinforced: number;
  projectPath?: string;
}

export class InstinctSynthesizer {
  private instincts = new Map<string, Instinct>();
  private minEvidenceForSynthesis = 3;
  private minConfidenceForApplication = 0.6;

  constructor(private memory: MemoryManager, private projectPath: string = '') {}

  /**
   * Analyze recent episodes and synthesize instincts.
   * Called after every successful task completion.
   */
  async synthesizeFromEpisodes(plan: Plan, critique: CritiqueResult): Promise<Instinct[]> {
    const newInstincts: Instinct[] = [];

    if (critique.verdict === 'pass' && critique.overall >= 4.5) {
      // Success pattern → synthesize recipe
      const recipe = this.synthesizeRecipe(plan, critique);
      if (recipe) {
        this.record(recipe);
        newInstincts.push(recipe);
      }
    }

    if (critique.verdict === 'fail' || critique.overall < 2.5) {
      // Failure pattern → synthesize anti-pattern
      const anti = this.synthesizeAntiPattern(plan, critique);
      if (anti) {
        this.record(anti);
        newInstincts.push(anti);
      }
    }

    return newInstincts;
  }

  /**
   * Get applicable instincts for a task type.
   */
  getApplicable(taskType: string, complexity: string): Instinct[] {
    return [...this.instincts.values()].filter((inst) => {
      if (inst.confidence < this.minConfidenceForApplication) return false;
      if (inst.scope === 'project' && inst.projectPath !== this.projectPath) return false;
      return inst.trigger.toLowerCase().includes(taskType.toLowerCase()) ||
             inst.trigger.toLowerCase().includes(complexity.toLowerCase());
    }).sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * Get all instincts (for /status display).
   */
  getAll(): Instinct[] {
    return [...this.instincts.values()].sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * Record an instinct (from CLI command or external source).
   */
  record(instinct: Instinct): void {
    this.instincts.set(instinct.id, instinct);

    // Persist to memory
    this.memory.recordEpisode(
      `Instinct [${instinct.type}]: ${instinct.trigger} → ${instinct.action}`,
      {
        kind: 'instinct',
        type: instinct.type,
        scope: instinct.scope,
        confidence: instinct.confidence,
        evidence: instinct.evidence,
      },
      Math.min(1.0, 0.5 + instinct.confidence / 2)
    );
  }

  /**
   * Render applicable instincts for injection into system prompt.
   */
  renderForPrompt(taskType: string, complexity: string): string {
    const applicable = this.getApplicable(taskType, complexity).slice(0, 5);
    if (applicable.length === 0) return '';

    let out = `\n## Learned Instincts (apply automatically)\n`;
    for (const inst of applicable) {
      const icon = inst.type === 'recipe' ? '📋' :
                   inst.type === 'anti_pattern' ? '⚠️' :
                   inst.type === 'convention' ? '📐' : '💭';
      out += `${icon} [${inst.type}, conf=${(inst.confidence * 100).toFixed(0)}%] ${inst.trigger} → ${inst.action}\n`;
    }
    return out;
  }

  // ═══════════════════════════════════════════════════
  // Private synthesis
  // ═══════════════════════════════════════════════════

  private synthesizeRecipe(plan: Plan, critique: CritiqueResult): Instinct | null {
    if (plan.steps.length < 2) return null;

    const toolSequence = plan.steps
      .filter((s) => s.tool)
      .map((s) => s.tool!)
      .join(' → ');

    if (!toolSequence) return null;

    return {
      id: `instinct_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type: 'recipe',
      scope: 'project',
      trigger: `${plan.taskType} ${plan.complexity} tasks`,
      action: `Use tool sequence: ${toolSequence}`,
      confidence: Math.min(1.0, critique.overall / 5),
      evidence: 1,
      createdAt: Date.now(),
      lastReinforced: Date.now(),
      projectPath: this.projectPath,
    };
  }

  private synthesizeAntiPattern(plan: Plan, critique: CritiqueResult): Instinct | null {
    if (critique.issues.length === 0) return null;

    const mainIssue = critique.issues[0];
    const failedTool = plan.steps.find((s) => s.status === 'failed')?.tool;

    return {
      id: `antipattern_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type: 'anti_pattern',
      scope: 'project',
      trigger: failedTool ? `${plan.taskType} using ${failedTool}` : plan.taskType || 'unknown',
      action: `Avoid: ${mainIssue}`,
      confidence: 0.7,
      evidence: 1,
      createdAt: Date.now(),
      lastReinforced: Date.now(),
      projectPath: this.projectPath,
    };
  }
}
