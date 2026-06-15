// ✦ Architect — Stage 2: Spec-Driven Generation ✦
// Inspired by Aider's architect-editor split
// Innovation: Spec first, then code (anti-hallucination)

import type { UnifiedClient } from '../../providers/client.js';
import type { TaskType, ComplexityLevel } from '../../types/index.js';

export interface Spec {
  goal: string;
  requirements: string[];
  filesAffected: string[];
  dataFlow?: string;
  acceptance: string[];
  tests: string[];
  risks: string[];
  estimatedComplexity: ComplexityLevel;
  taskType: TaskType;
}

const ARCHITECT_PROMPT = `You are a senior software architect. Your job is to produce a CONCRETE, VERIFIABLE specification BEFORE any code is written.

This is an ANTI-HALLUCINATION step. Vague specs = hallucinated code.

For the user's request, produce a structured spec with these fields:
- goal: 1 sentence, what we're building
- requirements: list of specific, testable requirements
- filesAffected: list of files (relative paths) to create or modify
- dataFlow: (optional) how data moves through the system
- acceptance: list of acceptance criteria (testable conditions)
- tests: list of test files to create
- risks: list of potential risks and how to mitigate
- estimatedComplexity: trivial | simple | moderate | complex
- taskType: code_write | code_read | code_fix | code_refactor | question | research | action

RULES:
- Each requirement must be TESTABLE (you can write a test for it)
- Each acceptance criterion must be VERIFIABLE (a human can check it)
- Files must have ACTUAL PATHS (no "TBD" or "various files")
- If you don't know, say so explicitly (don't make up)

OUTPUT FORMAT (strict JSON, no markdown):
{
  "goal": "string",
  "requirements": ["req1", "req2"],
  "filesAffected": ["path/to/file1.ts", "path/to/file2.ts"],
  "dataFlow": "string or null",
  "acceptance": ["criterion 1", "criterion 2"],
  "tests": ["test1.test.ts"],
  "risks": ["risk1: mitigation"],
  "estimatedComplexity": "moderate",
  "taskType": "code_write"
}

User request: {REQUEST}

Project context:
{PROJECT_CONTEXT}

Tools available:
{TOOLS}

Produce the spec now:`;

export class Architect {
  constructor(private client: UnifiedClient) {}

  async design(request: string, projectContext: string, availableTools: string[]): Promise<Spec> {
    const prompt = ARCHITECT_PROMPT
      .replace('{REQUEST}', request)
      .replace('{PROJECT_CONTEXT}', projectContext || 'No project context')
      .replace('{TOOLS}', availableTools.join(', ') || 'none');

    let text = '';
    for await (const event of this.client.stream({
      model: this.client.getModel(),
      system: prompt,
      messages: [{ role: 'user', content: 'Produce the spec.' }],
      temperature: 0.2,
      maxTokens: 2000,
    })) {
      if (event.type === 'text_delta') text = event.accumulated;
      if (event.type === 'message_stop') break;
      if (event.type === 'error') throw new Error(event.error);
    }

    const parsed = this.extractJson(text);
    if (!parsed) {
      // Fallback minimal spec
      return this.fallbackSpec(request);
    }

    return this.validateSpec(parsed, request);
  }

  /**
   * Validate spec is concrete enough (not hallucinated).
   * Reject specs with vague fields.
   */
  validateSpecIsConcrete(spec: Spec): { valid: boolean; issues: string[] } {
    const issues: string[] = [];

    if (!spec.goal || spec.goal.length < 10) {
      issues.push('Goal is too vague');
    }

    if (spec.requirements.length === 0) {
      issues.push('No requirements specified');
    }

    for (const req of spec.requirements) {
      if (this.isVague(req)) {
        issues.push(`Vague requirement: "${req}"`);
      }
    }

    if (spec.acceptance.length === 0) {
      issues.push('No acceptance criteria — spec is not verifiable');
    }

    for (const acc of spec.acceptance) {
      if (this.isVague(acc)) {
        issues.push(`Vague acceptance: "${acc}"`);
      }
    }

    return { valid: issues.length === 0, issues };
  }

  // ═══════════════════════════════════════════════════
  // Private
  // ═══════════════════════════════════════════════════

  private fallbackSpec(request: string): Spec {
    return {
      goal: request,
      requirements: [request],
      filesAffected: [],
      acceptance: [`The task "${request}" was completed`],
      tests: [],
      risks: ['Spec could not be parsed, falling back to minimal'],
      estimatedComplexity: 'simple',
      taskType: 'unknown',
    };
  }

  private validateSpec(parsed: any, request: string): Spec {
    return {
      goal: parsed.goal || request,
      requirements: Array.isArray(parsed.requirements) ? parsed.requirements : [request],
      filesAffected: Array.isArray(parsed.filesAffected) ? parsed.filesAffected : [],
      dataFlow: parsed.dataFlow || undefined,
      acceptance: Array.isArray(parsed.acceptance) ? parsed.acceptance : [],
      tests: Array.isArray(parsed.tests) ? parsed.tests : [],
      risks: Array.isArray(parsed.risks) ? parsed.risks : [],
      estimatedComplexity: parsed.estimatedComplexity || 'simple',
      taskType: parsed.taskType || 'unknown',
    };
  }

  private isVague(text: string): boolean {
    const vaguePhrases = [
      'tbd', 'todo', 'various', 'some', 'maybe', 'perhaps',
      'should work', 'should be fine', 'etc', 'and so on',
      'as needed', 'as appropriate', 'whatever', 'things like',
    ];
    const lower = text.toLowerCase();
    return vaguePhrases.some((p) => lower.includes(p));
  }

  private extractJson(text: string): any {
    try { return JSON.parse(text); } catch {}
    const match = text.match(/```(?:json)?\s*([\s\S]+?)\s*```/);
    if (match) {
      try { return JSON.parse(match[1]); } catch {}
    }
    const objMatch = text.match(/\{[\s\S]+\}/);
    if (objMatch) {
      try { return JSON.parse(objMatch[0]); } catch {}
    }
    return null;
  }
}
