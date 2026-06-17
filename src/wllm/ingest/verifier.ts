/**
 * wllm/ingest/verifier.ts
 *
 * Pass 3: Critic mesh verification.
 * Takes Pass 2's semantic analysis and runs 3 LLM "critics" in parallel:
 *   - Correctness: are the claims technically correct?
 *   - Style: are they well-written and useful?
 *   - Intent: do they match what the code actually does?
 *
 * Then aggregates with Borda count (weighted voting).
 * If critics disagree strongly, an arbiter LLM is triggered.
 *
 * Result: confidence level (VERIFIED / INFERRED / ASSUMED / CONTRADICTED)
 *
 * This prevents hallucination: Pass 2 might invent entities that don't really
 * exist in the code. Pass 3 catches that.
 */

import type { SemanticAnalysis, LLMProvider } from "./semantic-extractor.js";

export type ConfidenceLevel = "VERIFIED" | "INFERRED" | "ASSUMED" | "CONTRADICTED" | "RESOLVED";

export interface CriticVerdict {
  persona: "correctness" | "style" | "intent";
  score: number;          // 0-1
  confidence: number;     // 0-1
  rationale: string;
  issues: string[];
  suggestions: string[];
  tokensUsed: number;
  durationMs: number;
}

export interface VerificationResult {
  /** Final aggregated confidence level */
  confidenceLevel: ConfidenceLevel;
  /** Aggregated score (0-1) */
  score: number;
  /** Aggregated confidence (0-1) */
  confidence: number;
  /** Per-critic breakdown */
  critics: CriticVerdict[];
  /** Whether the arbiter was triggered */
  arbiterTriggered: boolean;
  /** Optional arbiter verdict */
  arbiterVerdict?: CriticVerdict;
  /** Total tokens used (all 3 critics + optional arbiter) */
  totalTokens: number;
  /** Total wall time */
  totalDurationMs: number;
}

/**
 * Build prompt for a specific critic persona.
 */
function buildCriticPrompt(persona: "correctness" | "style" | "intent", analysis: SemanticAnalysis): string {
  const personaInstructions: Record<typeof persona, string> = {
    correctness: `You are a senior software engineer reviewing an LLM's code analysis for TECHNICAL CORRECTNESS.
Your job: verify each claim against the actual source code structure.
- Are the entities real (mentioned in code/comments) or invented?
- Are the connections accurate (does the code really use this)?
- Flag anything that looks like a hallucination.`,
    style: `You are a documentation expert reviewing an LLM's analysis for WRITING QUALITY and USEFULNESS.
Your job: evaluate if the analysis is helpful for a developer wiki.
- Are descriptions clear and concise?
- Would a developer find this useful?
- Is anything missing that should be there?`,
    intent: `You are a code reviewer evaluating if the analysis matches the code's ACTUAL PURPOSE.
Your job: ensure the summary and gotchas reflect what the code REALLY does.
- Does the summary match the file's role?
- Are gotchas real (from comments) or invented?
- Does the analysis help future developers understand this code?`,
  };

  return `${personaInstructions[persona]}

ANALYSIS TO REVIEW:
${JSON.stringify({
  summary: analysis.summary,
  entities: analysis.entities,
  concepts: analysis.concepts,
  gotchas: analysis.gotchas,
  connections: analysis.connections,
  contradictions: analysis.contradictions,
}, null, 2)}

Respond with ONLY valid JSON in this exact format:
{
  "score": 0.0-1.0,           // How good is this analysis on YOUR dimension?
  "confidence": 0.0-1.0,       // How confident are you in your score?
  "rationale": "1-2 sentence explanation of your score",
  "issues": ["list of specific problems found"],
  "suggestions": ["list of improvements"]
}

Be honest. If the analysis is bad, give a low score. If great, give high.
`;
}

/**
 * Parse a critic response.
 */
function parseCriticResponse(persona: "correctness" | "style" | "intent", text: string, tokensUsed: number, durationMs: number): CriticVerdict {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return {
      persona,
      score: 0.5,
      confidence: 0.3,
      rationale: "Failed to parse response",
      issues: ["No JSON in response"],
      suggestions: [],
      tokensUsed,
      durationMs,
    };
  }
  const json = JSON.parse(jsonMatch[0]);
  return {
    persona,
    score: typeof json.score === "number" ? Math.max(0, Math.min(1, json.score)) : 0.5,
    confidence: typeof json.confidence === "number" ? Math.max(0, Math.min(1, json.confidence)) : 0.5,
    rationale: typeof json.rationale === "string" ? json.rationale : "",
    issues: Array.isArray(json.issues) ? json.issues : [],
    suggestions: Array.isArray(json.suggestions) ? json.suggestions : [],
    tokensUsed,
    durationMs,
  };
}

/**
 * Aggregate 3 critic verdicts into a final result.
 * Uses Borda count (weighted voting) for the final score.
 */
export function aggregate(critics: CriticVerdict[]): { score: number; confidence: number; level: ConfidenceLevel } {
  // Weighted Borda: correctness (40%), style (25%), intent (35%)
  const weights: Record<string, number> = {
    correctness: 0.4,
    style: 0.25,
    intent: 0.35,
  };
  let totalWeight = 0;
  let weightedScore = 0;
  let weightedConfidence = 0;
  for (const c of critics) {
    const w = weights[c.persona] ?? 0.33;
    totalWeight += w;
    weightedScore += c.score * w;
    weightedConfidence += c.confidence * w;
  }
  const score = totalWeight > 0 ? weightedScore / totalWeight : 0.5;
  const confidence = totalWeight > 0 ? weightedConfidence / totalWeight : 0.5;

  // Determine confidence level
  let level: ConfidenceLevel;
  if (score >= 0.95) level = "VERIFIED";
  else if (score >= 0.7) level = "INFERRED";
  else if (score >= 0.4) level = "ASSUMED";
  else level = "CONTRADICTED";

  return { score, confidence, level };
}

/**
 * Check if arbiter should be triggered (strong disagreement).
 */
export function shouldTriggerArbiter(critics: CriticVerdict[]): boolean {
  if (critics.length < 3) return false;
  const scores = critics.map(c => c.score);
  const min = Math.min(...scores);
  const max = Math.max(...scores);
  // If spread > 0.4, critics disagree strongly
  return (max - min) > 0.4;
}

/**
 * Build arbiter prompt.
 */
function buildArbiterPrompt(critics: CriticVerdict[], analysis: SemanticAnalysis): string {
  return `You are an arbiter resolving a disagreement between 3 critic verdicts on an LLM-generated code analysis.

CRITICS (disagreement detected):
${critics.map(c => `- ${c.persona} (weight): score=${c.score.toFixed(2)}, confidence=${c.confidence.toFixed(2)}
  Rationale: ${c.rationale}
  Issues: ${c.issues.join("; ")}
  Suggestions: ${c.suggestions.join("; ")}`).join("\n")}

ORIGINAL ANALYSIS:
${JSON.stringify({
  summary: analysis.summary,
  entities: analysis.entities,
  gotchas: analysis.gotchas,
}, null, 2)}

Your job: make a final judgment. Respond with ONLY valid JSON:
{
  "score": 0.0-1.0,
  "confidence": 0.0-1.0,
  "rationale": "1-2 sentence final verdict",
  "issues": ["final list of issues"],
  "suggestions": ["final suggestions"]
}
`;
}

/**
 * Run the 3-critic verification mesh on a semantic analysis.
 */
export async function verify(
  analysis: SemanticAnalysis,
  provider: LLMProvider,
  options: { withArbiter?: boolean } = {}
): Promise<VerificationResult> {
  const t0 = Date.now();
  const personas: Array<"correctness" | "style" | "intent"> = ["correctness", "style", "intent"];

  // Run all 3 critics in parallel
  const criticPromises = personas.map(async (persona) => {
    const prompt = buildCriticPrompt(persona, analysis);
    const t0c = Date.now();
    const result = await provider.generateText(prompt);
    const durationMs = Date.now() - t0c;
    return parseCriticResponse(persona, result.text, result.tokensUsed, durationMs);
  });

  const critics = await Promise.all(criticPromises);

  // Aggregate
  const agg = aggregate(critics);

  // Maybe trigger arbiter
  let arbiterVerdict: CriticVerdict | undefined;
  let arbiterTriggered = false;
  if (options.withArbiter !== false && shouldTriggerArbiter(critics)) {
    arbiterTriggered = true;
    const arbiterPrompt = buildArbiterPrompt(critics, analysis);
    const t0a = Date.now();
    const arbiterResult = await provider.generateText(arbiterPrompt);
    arbiterVerdict = parseCriticResponse("correctness", arbiterResult.text, arbiterResult.tokensUsed, Date.now() - t0a);
    arbiterVerdict.persona = "correctness";  // mark as arbiter
    // Override aggregation with arbiter.
    // BUGFIX: confidenceLevel was derived from `agg.score` (the
    // aggregated critic score) but `score` is `arbiterVerdict.score`.
    // If the arbiter scored 0.3 but critics aggregated 0.8, the result
    // reported `confidenceLevel: "INFERRED"` with `score: 0.3` —
    // internally inconsistent. Now derive confidenceLevel from the
    // ARBITER's score so they match.
    const arbiterScore = arbiterVerdict.score;
    return {
      confidenceLevel: arbiterScore >= 0.95 ? "VERIFIED" : arbiterScore >= 0.7 ? "INFERRED" : arbiterScore >= 0.4 ? "ASSUMED" : "CONTRADICTED",
      score: arbiterScore,
      confidence: arbiterVerdict.confidence,
      critics,
      arbiterTriggered,
      arbiterVerdict,
      totalTokens: critics.reduce((s, c) => s + c.tokensUsed, 0) + arbiterVerdict.tokensUsed,
      totalDurationMs: Date.now() - t0,
    };
  }

  return {
    confidenceLevel: agg.level,
    score: agg.score,
    confidence: agg.confidence,
    critics,
    arbiterTriggered,
    totalTokens: critics.reduce((s, c) => s + c.tokensUsed, 0),
    totalDurationMs: Date.now() - t0,
  };
}
