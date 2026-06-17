// Reflector: extracts lessons from completed (or failed) interactions
// Updates memory with insights so future runs are smarter

import type { MemoryManager } from '../memory/manager.js';
import type { Plan } from '../types/index.js';
import type { CritiqueResult } from './critic.js';

export class Reflector {
  constructor(private memory: MemoryManager) {}

  // Learn from a successful interaction
  async reflectSuccess(plan: Plan, critique: CritiqueResult): Promise<void> {
    // Record the episode
    this.memory.recordEpisode(
      `✓ Success: ${plan.goal}`,
      {
        taskType: plan.taskType,
        complexity: plan.complexity,
        steps: plan.steps.length,
        score: critique.overall,
        duration: Date.now() - plan.createdAt,
      },
      // Higher score = higher importance
      Math.min(1.0, 0.5 + critique.overall / 10)
    );

    // If highly successful, extract procedural pattern
    if (critique.overall >= 4.5 && plan.steps.length >= 2) {
      const pattern = this.extractPattern(plan);
      if (pattern) {
        this.memory.learnSkill(pattern, {
          domain: plan.taskType,
          complexity: plan.complexity,
        });
      }
    }
  }

  // Learn from a failed interaction
  async reflectFailure(plan: Plan, critique: CritiqueResult, error?: string): Promise<void> {
    const failureSummary = `✗ Failed: ${plan.goal}
Issues: ${critique.issues.join('; ')}
${error ? `Error: ${error}` : ''}`;

    this.memory.recordEpisode(
      failureSummary,
      {
        taskType: plan.taskType,
        complexity: plan.complexity,
        score: critique.overall,
        status: 'failed',
      },
      // Failures are more important to remember
      0.8
    );

    // Extract anti-pattern to avoid next time
    if (critique.issues.length > 0) {
      this.memory.learnSkill(
        `Avoid: ${critique.issues.join('; ')}`,
        {
          domain: plan.taskType,
          type: 'anti-pattern',
        }
      );
    }
  }

  // Extract a reusable pattern from a successful plan
  private extractPattern(plan: Plan): string | null {
    if (plan.steps.length < 2) return null;

    const tools = plan.steps.filter((s) => s.tool).map((s) => s.tool);
    if (tools.length === 0) return null;

    return `Pattern for "${plan.taskType}" (${plan.complexity}):
${plan.steps.map((s, i) => `  ${i + 1}. ${s.tool || 'think'}: ${s.description}`).join('\n')}
Tools used: ${[...new Set(tools)].join(', ')}`;
  }
}
