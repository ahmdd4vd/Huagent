// Smart Critic: verifies plan results against the goal with 5-dimension rubric
// Returns structured verdict with scores

import type { UnifiedClient } from '../providers/client.js';
import type { Plan, PlanStep } from '../types/index.js';

export interface CritiqueResult {
  verdict: 'pass' | 'refine' | 'fail';
  scores: {
    correctness: number;  // 1-5
    completeness: number; // 1-5
    quality: number;      // 1-5
    safety: number;       // 1-5
    efficiency: number;   // 1-5
  };
  overall: number; // average
  feedback: string;
  issues: string[];
  suggestions: string[];
}

const CRITIC_PROMPT = `You are a senior code reviewer. Evaluate the plan execution against the original goal.

SCORING (1-5 each):
- **correctness**: Does it actually work? No bugs?
- **completeness**: All requirements met? Nothing missing?
- **quality**: Clean code? Maintainable? Idiomatic?
- **safety**: No destructive actions? No security issues?
- **efficiency**: Not wasteful? Reasonable approach?

OUTPUT FORMAT (strict JSON, no markdown):
{
  "scores": {
    "correctness": 4,
    "completeness": 5,
    "quality": 4,
    "safety": 5,
    "efficiency": 4
  },
  "verdict": "pass|refine|fail",
  "issues": ["list of specific problems"],
  "suggestions": ["list of specific improvements"],
  "feedback": "one paragraph summary"
}

VERDICT RULES:
- PASS: overall >= 4.0, no major issues
- REFINE: overall >= 2.5, fixable problems
- FAIL: overall < 2.5, or fundamental issue

Be HONEST and SPECIFIC. Don't sugarcoat.

Original goal: {GOAL}

Executed steps:
{STEPS}

Step results:
{RESULTS}

Evaluate now:`;

export class Critic {
  /** Optional cheaper model for critique (falls back to main client model) */
  private criticModel?: string;

  constructor(private client: UnifiedClient, criticModel?: string) {
    this.criticModel = criticModel;
  }

  /** Set the model used for critique calls (e.g. a cheaper/faster model). */
  setCriticModel(model: string): void {
    this.criticModel = model;
  }

  async critique(plan: Plan): Promise<CritiqueResult> {
    const stepsSummary = plan.steps
      .map((s, i) => `${i + 1}. [${s.status}] ${s.description}${s.tool ? ` (tool: ${s.tool})` : ''}`)
      .join('\n');

    const resultsSummary = plan.steps
      .map((s, i) => {
        if (!s.result) return `${i + 1}. (no result)`;
        if (s.result.error) return `${i + 1}. ERROR: ${s.result.error}`;
        if (typeof s.result === 'string') return `${i + 1}. ${s.result.slice(0, 200)}`;
        if (s.result.output) return `${i + 1}. ${String(s.result.output).slice(0, 200)}`;
        return `${i + 1}. ${JSON.stringify(s.result).slice(0, 200)}`;
      })
      .join('\n');

    const prompt = CRITIC_PROMPT
      .replace('{GOAL}', plan.goal)
      .replace('{STEPS}', stepsSummary)
      .replace('{RESULTS}', resultsSummary);

    let text = '';
    for await (const event of this.client.stream({
      model: this.criticModel || this.client.getModel(),
      system: prompt,
      messages: [{ role: 'user', content: 'Evaluate this plan execution.' }],
      temperature: 0.1,
      maxTokens: 1500,
    })) {
      if (event.type === 'text_delta') text = event.accumulated;
      if (event.type === 'message_stop') break;
      if (event.type === 'error') throw new Error(event.error);
    }

    const parsed = this.extractJson(text);
    if (!parsed) {
      // Fallback heuristic
      const allDone = plan.steps.every((s) => s.status === 'done');
      return {
        verdict: allDone ? 'pass' : 'refine',
        scores: { correctness: 3, completeness: 3, quality: 3, safety: 4, efficiency: 3 },
        overall: 3.2,
        feedback: text.slice(0, 500),
        issues: [],
        suggestions: [],
      };
    }

    const scores = parsed.scores || {};
    const overall = (
      (scores.correctness || 3) +
      (scores.completeness || 3) +
      (scores.quality || 3) +
      (scores.safety || 4) +
      (scores.efficiency || 3)
    ) / 5;

    let verdict: 'pass' | 'refine' | 'fail' = 'pass';
    if (overall < 2.5) verdict = 'fail';
    else if (overall < 4.0) verdict = 'refine';

    return {
      verdict: parsed.verdict || verdict,
      scores: {
        correctness: scores.correctness || 3,
        completeness: scores.completeness || 3,
        quality: scores.quality || 3,
        safety: scores.safety || 4,
        efficiency: scores.efficiency || 3,
      },
      overall,
      feedback: parsed.feedback || text.slice(0, 500),
      issues: parsed.issues || [],
      suggestions: parsed.suggestions || [],
    };
  }

  private extractJson(text: string): any {
    try {
      return JSON.parse(text);
    } catch {}
    const match = text.match(/```(?:json)?\s*([\s\S]+?)\s*```/);
    if (match) {
      try {
        return JSON.parse(match[1]);
      } catch {}
    }
    const objMatch = text.match(/\{[\s\S]+\}/);
    if (objMatch) {
      try {
        return JSON.parse(objMatch[0]);
      } catch {}
    }
    return null;
  }
}
