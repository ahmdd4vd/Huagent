/**
 * v4/critic/mesh.ts
 *
 * The Critic Mesh: 3 independent critics (correctness, style, intent) vote
 * on a result. If they disagree strongly, an arbiter decides.
 *
 * Algorithm:
 * 1. Run 3 critics in parallel (each can be a different model).
 * 2. Aggregate: weighted Borda count with persona-specific weights.
 * 3. If max-min > 0.3 (strong disagreement), trigger arbiter.
 * 4. Final verdict: pass if score >= 0.7, fail if < 0.5, flag otherwise.
 *
 * Why this beats a single critic:
 * - Single LLM judge has known biases (position, self-enhancement).
 * - Three critics with diverse personas catch different issues.
 * - Disagreement is itself a signal — the output is uncertain.
 *
 * Cost considerations:
 * - Default: 3× haiku (~$0.01) ≈ 1× opus ($0.10). Cheaper, smarter.
 * - Critical ops: 3× sonnet or opus. More expensive, higher quality.
 * - Optional arbiter (4th call) only on disagreement.
 */

import { randomUUID } from "node:crypto";
import type { CriticVerdict, MeshVerdict } from "../speculative/types.js";
import { PERSONAS, type PersonaConfig } from "./personas.js";
import { EventFactory, type CriticPersona } from "../stream/cognitive-event.js";

/**
 * LLM call signature for a critic. Different critics may use different
 * models. The persona config dictates the system prompt.
 */
export type CriticLLMCall = (args: {
  persona: PersonaConfig;
  userContent: string;
  model?: string;
  temperature?: number;
}) => Promise<{ content: string; tokensUsed: number; durationMs: number }>;

/**
 * Configuration for the critic mesh.
 */
export interface MeshConfig {
  /** Which personas to use (default: correctness, style, intent) */
  personas?: CriticPersona[];
  /** Pass threshold (default 0.7) */
  passThreshold?: number;
  /** Fail threshold (default 0.5) */
  failThreshold?: number;
  /** Disagreement threshold to trigger arbiter (default 0.3) */
  disagreementThreshold?: number;
  /** Persona weights for Borda aggregation (default equal) */
  personaWeights?: Partial<Record<CriticPersona, number>>;
  /** LLM call for each critic */
  llm: CriticLLMCall;
  /** Optional per-persona model override */
  models?: Partial<Record<CriticPersona, string>>;
  /** Optional per-persona temperature override */
  temperatures?: Partial<Record<CriticPersona, number>>;
  /** Optional EventFactory for emitting events */
  events?: EventFactory;
}

const DEFAULT_PERSONAS: CriticPersona[] = ["correctness", "style", "intent"];

/**
 * The Critic Mesh.
 */
export class CriticMesh {
  private personas: CriticPersona[];
  private passThreshold: number;
  private failThreshold: number;
  private disagreementThreshold: number;
  private weights: Record<CriticPersona, number>;
  private llm: CriticLLMCall;
  private models: Partial<Record<CriticPersona, string>>;
  private temperatures: Partial<Record<CriticPersona, number>>;
  private events?: EventFactory;

  constructor(config: MeshConfig) {
    this.personas = config.personas ?? DEFAULT_PERSONAS;
    this.passThreshold = config.passThreshold ?? 0.7;
    this.failThreshold = config.failThreshold ?? 0.5;
    this.disagreementThreshold = config.disagreementThreshold ?? 0.3;
    this.llm = config.llm;
    this.models = config.models ?? {};
    this.temperatures = config.temperatures ?? { correctness: 0.1, style: 0.2, intent: 0.2 };
    this.events = config.events;

    // Default equal weights
    const defaults: Record<CriticPersona, number> = {
      correctness: 1.0,
      style: 0.7,
      intent: 0.9,
      arbiter: 1.5,
    };
    this.weights = { ...defaults, ...(config.personaWeights ?? {}) };
  }

  /**
   * Run the critic mesh on a result. Returns aggregated verdict.
   */
  async evaluate(content: string, context?: { raceId?: string; stepId?: string }): Promise<MeshVerdict> {
    const t0 = Date.now();
    // Run all persona critics in parallel
    const verdicts = await Promise.all(
      this.personas.map((p) => this.runCritic(p, content))
    );

    // Emit per-critic events
    if (this.events) {
      for (const v of verdicts) {
        const ev = this.events.make("critic_verdict", {
          critic: v.persona,
          score: v.score,
          confidence: v.confidence,
          rationale: v.rationale,
        });
        void ev;
      }
    }

    // Check for strong disagreement
    const scores = verdicts.map((v) => v.score);
    const min = Math.min(...scores);
    const max = Math.max(...scores);
    const disagreement = max - min;
    const needsArbiter = disagreement > this.disagreementThreshold;

    // Aggregate via weighted Borda
    const aggregatedScore = this.aggregate(verdicts);
    const aggregatedConfidence = this.aggregateConfidence(verdicts);

    let arbiterVerdict: CriticVerdict | undefined;
    let arbiterTriggered = false;
    let finalScore = aggregatedScore;
    let finalConfidence = aggregatedConfidence;
    let finalRationale = `Aggregated from ${verdicts.length} critics`;

    if (needsArbiter) {
      arbiterTriggered = true;
      const arb = await this.runCritic("arbiter", content, verdicts);
      arbiterVerdict = arb;
      // Arbiter counts more than individual critics
      const arbiterWeight = this.weights.arbiter;
      const totalWeight = verdicts.reduce((s, v) => s + this.weights[v.persona], 0) + arbiterWeight;
      finalScore = (
        verdicts.reduce((s, v) => s + v.score * this.weights[v.persona], 0) +
        arb.score * arbiterWeight
      ) / totalWeight;
      finalConfidence = Math.min(0.95, aggregatedConfidence * 0.5 + arb.confidence * 0.5);
      finalRationale = `Arbiter: ${arb.rationale}`;
    }

    const verdict: MeshVerdict["verdict"] =
      finalScore >= this.passThreshold ? "pass" : finalScore < this.failThreshold ? "fail" : "flag";

    const meshVerdict: MeshVerdict = {
      raceId: context?.raceId,
      stepId: context?.stepId,
      score: finalScore,
      confidence: finalConfidence,
      verdict,
      critics: verdicts,
      arbiterTriggered,
      arbiterVerdict,
    };

    // Emit mesh_verdict event
    if (this.events) {
      this.events.make("mesh_verdict", {
        raceId: meshVerdict.raceId,
        stepId: meshVerdict.stepId,
        score: meshVerdict.score,
        confidence: meshVerdict.confidence,
        verdict: meshVerdict.verdict,
        critics: meshVerdict.critics.map((c) => ({
          persona: c.persona,
          score: c.score,
          confidence: c.confidence,
        })),
        arbiterTriggered: meshVerdict.arbiterTriggered,
      });
    }

    void t0;
    return meshVerdict;
  }

  /**
   * Run a single critic. Returns the verdict.
   */
  private async runCritic(persona: CriticPersona, content: string, priorVerdicts?: CriticVerdict[]): Promise<CriticVerdict> {
    const personaCfg = PERSONAS[persona];
    const userContent = priorVerdicts
      ? `Original content to evaluate:
${content}

Prior critic verdicts:
${priorVerdicts.map((v) => `- ${v.persona}: ${v.score.toFixed(2)} (conf ${v.confidence.toFixed(2)}) — ${v.rationale}`).join("\n")}

These critics disagree. Decide the final verdict.`
      : content;

    const t0 = Date.now();
    const response = await this.llm({
      persona: personaCfg,
      userContent,
      model: this.models[persona],
      temperature: this.temperatures[persona],
    });

    // Parse JSON from response
    let parsed: any = {};
    try {
      // Try to extract JSON from response (LLMs often add prose)
      const match = response.content.match(/\{[\s\S]*\}/);
      if (match) parsed = JSON.parse(match[0]);
    } catch {
      // Fall back to a default
      parsed = { score: 0.5, confidence: 0.3, rationale: "Could not parse critic response" };
    }

    const score = typeof parsed.score === "number" ? Math.max(0, Math.min(1, parsed.score)) : 0.5;
    const confidence = typeof parsed.confidence === "number" ? Math.max(0, Math.min(1, parsed.confidence)) : 0.5;
    const rationale = String(parsed.rationale ?? "no rationale provided").slice(0, 500);
    const issues = Array.isArray(parsed.issues) ? parsed.issues.slice(0, 20).map(String) : [];
    const suggestions = Array.isArray(parsed.suggestions) ? parsed.suggestions.slice(0, 20).map(String) : [];

    return {
      persona,
      score,
      confidence,
      rationale,
      issues,
      suggestions,
      pass: score >= this.passThreshold,
      tokensUsed: response.tokensUsed,
      durationMs: Date.now() - t0,
    };
  }

  /**
   * Weighted Borda aggregation. Critics with higher weight count more.
   */
  private aggregate(verdicts: CriticVerdict[]): number {
    let totalWeight = 0;
    let totalScore = 0;
    for (const v of verdicts) {
      const w = this.weights[v.persona];
      totalWeight += w;
      totalScore += v.score * w;
    }
    return totalWeight > 0 ? totalScore / totalWeight : 0;
  }

  /**
   * Confidence aggregation: weighted average, but penalize low-confidence
   * critics.
   */
  private aggregateConfidence(verdicts: CriticVerdict[]): number {
    let totalWeight = 0;
    let totalConf = 0;
    for (const v of verdicts) {
      const w = this.weights[v.persona] * v.confidence;  // weight × confidence
      totalWeight += w;
      totalConf += v.confidence * w;
    }
    return totalWeight > 0 ? totalConf / totalWeight : 0;
  }
}
