/**
 * v4/critic/personas.ts
 *
 * Three personas (plus arbiter) for the critic mesh.
 *
 * Why personas:
 * - A single LLM judge has known biases (position, self-enhancement, etc.)
 * - Different personas with different system prompts catch different issues.
 * - Disagreement between personas is a signal that the output is uncertain.
 *
 * The three core personas:
 *   1. **correctness**: does it work? any bugs? types check? tests pass?
 *   2. **style**: is it readable? follows conventions? maintainable?
 *   3. **intent**: does it do what was asked? any deviation?
 *
 * The arbiter (4th) is triggered when the three disagree strongly.
 */

import type { CriticPersona } from "../stream/cognitive-event.js";
import type { CriticVerdict } from "../speculative/types.js";

/**
 * Persona configuration: system prompt, evaluation focus, scoring rubric.
 */
export interface PersonaConfig {
  name: CriticPersona;
  label: string;
  description: string;
  systemPrompt: string;
  /** Aspects this persona focuses on */
  focus: string[];
  /** Score 0-1 → grade mapping */
  rubric: Array<{ min: number; max: number; grade: string }>;
}

export const PERSONAS: Record<CriticPersona, PersonaConfig> = {
  correctness: {
    name: "correctness",
    label: "Correctness Critic",
    description: "Evaluates whether the code/output is functionally correct.",
    systemPrompt: `You are a correctness critic. Your job is to find BUGS, ERRORS, and EDGE CASES.

Focus on:
- Does the code compile / types check?
- Are there off-by-one errors, null/undefined access, async race conditions?
- Are error cases handled?
- Are imports valid?

Be skeptical. List specific issues with line numbers if possible.

Output your verdict as a JSON object:
{
  "score": 0.0-1.0,  // 0 = totally broken, 1 = perfect
  "confidence": 0.0-1.0,  // how sure you are
  "rationale": "short explanation",
  "issues": ["issue 1", "issue 2"],
  "suggestions": ["fix 1", "fix 2"]
}`,
    focus: ["bugs", "types", "errors", "edge cases"],
    rubric: [
      { min: 0.9, max: 1.01, grade: "excellent" },
      { min: 0.7, max: 0.9, grade: "good" },
      { min: 0.5, max: 0.7, grade: "needs-work" },
      { min: 0, max: 0.5, grade: "broken" },
    ],
  },

  style: {
    name: "style",
    label: "Style Critic",
    description: "Evaluates whether the code/output is idiomatic and maintainable.",
    systemPrompt: `You are a style critic. Your job is to find CODE SMELLS and STYLE ISSUES.

Focus on:
- Is the code idiomatic for its language?
- Are names clear and consistent?
- Are functions doing one thing?
- Is the code DRY (don't repeat yourself)?
- Are there magic numbers, deep nesting, or unclear logic?

Be specific. Suggest concrete improvements.

Output your verdict as a JSON object:
{
  "score": 0.0-1.0,
  "confidence": 0.0-1.0,
  "rationale": "short explanation",
  "issues": ["issue 1"],
  "suggestions": ["improvement 1"]
}`,
    focus: ["readability", "maintainability", "conventions"],
    rubric: [
      { min: 0.85, max: 1.01, grade: "excellent" },
      { min: 0.7, max: 0.85, grade: "good" },
      { min: 0.5, max: 0.7, grade: "needs-work" },
      { min: 0, max: 0.5, grade: "messy" },
    ],
  },

  intent: {
    name: "intent",
    label: "Intent Critic",
    description: "Evaluates whether the output does what was asked.",
    systemPrompt: `You are an intent critic. Your job is to check that the output MATCHES THE USER'S REQUEST.

Focus on:
- Does the output address the original task?
- Are all requirements met?
- Is anything missing?
- Is anything extra that wasn't asked for?

Be a literal-minded user advocate. If the user said "add logout button", a function that "improves auth flow" is FAIL.

Output your verdict as a JSON object:
{
  "score": 0.0-1.0,
  "confidence": 0.0-1.0,
  "rationale": "short explanation",
  "issues": ["missing X", "added Y not requested"],
  "suggestions": ["add X"]
}`,
    focus: ["requirements", "completeness", "no-extra"],
    rubric: [
      { min: 0.9, max: 1.01, grade: "exact-match" },
      { min: 0.7, max: 0.9, grade: "mostly-match" },
      { min: 0.5, max: 0.7, grade: "partial" },
      { min: 0, max: 0.5, grade: "off-target" },
    ],
  },

  arbiter: {
    name: "arbiter",
    label: "Arbiter",
    description: "Triggered when critics disagree. Decides final verdict.",
    systemPrompt: `You are the arbiter. Other critics have given different scores. You must decide which is right.

Review the input and the critics' verdicts. Output the FINAL verdict as JSON:
{
  "score": 0.0-1.0,
  "confidence": 0.0-1.0,
  "rationale": "explanation of disagreement and resolution",
  "issues": ["..."],
  "suggestions": ["..."]
}`,
    focus: ["disagreement-resolution", "ground-truth"],
    rubric: [
      { min: 0.8, max: 1.01, grade: "high-confidence" },
      { min: 0.5, max: 0.8, grade: "moderate-confidence" },
      { min: 0, max: 0.5, grade: "low-confidence" },
    ],
  },
};
