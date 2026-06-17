/**
 * v4/speculative/types.ts
 *
 * Data types for speculative execution.
 *
 * Mental model:
 *   The engine is uncertain about how to execute a step. Instead of
 *   picking one strategy, it races N strategies in parallel. The first
 *   one to produce a "good enough" result wins. Others are cancelled.
 *
 * This is borrowed from:
 *   - Speculative decoding (Leviathan 2023, Chen 2023)
 *   - Hedged requests (Dean & Barroso 2013, "The Tail at Scale")
 *   - Branch prediction in CPUs
 *   - Multi-agent debate (Du 2023)
 */
import type { CognitiveEvent, CausalEdgeKind } from "../stream/cognitive-event.js";

/**
 * A strategy: a complete plan to execute a step. Different strategies
 * can use different tools, different prompts, different orderings.
 */
export interface Strategy {
  /** Stable id (uuid) */
  id: string;
  /** Human name, e.g., "conservative", "aggressive", "creative" */
  name: string;
  /** Description */
  description: string;
  /** The tool calls this strategy will make (in order) */
  steps: StrategyStep[];
  /** Pre-condition: only enter this strategy if the condition holds */
  precondition?: (context: RaceContext) => boolean | Promise<boolean>;
  /** Estimate: how long will this take? (ms) */
  estimatedMs: number;
  /** Estimate: quality (0-1) of this strategy's expected output */
  estimatedQuality: number;
  /** Cost in tokens (estimated) */
  estimatedCostTokens: number;
  /** Risk level: 0-3 */
  risk: 0 | 1 | 2 | 3;
  /** Diversity: how different is this from other strategies? (0-1) */
  diversity: number;
}

export interface StrategyStep {
  tool: string;
  args: Record<string, unknown>;
  description?: string;
}

/**
 * Context passed to strategies and preconditions.
 */
export interface RaceContext {
  /** The user's original task */
  task: string;
  /** Project info */
  project?: { root: string; language?: string; framework?: string };
  /** Prior results (for chained races) */
  priorResults?: Map<string, unknown>;
  /** Memory graph (for context lookup) */
  graph?: unknown;
}

/**
 * A strategy's output.
 */
export interface StrategyResult {
  strategyId: string;
  strategyName: string;
  /** Tool results in order */
  stepResults: Array<{ tool: string; result: unknown; durationMs: number; ok: boolean; error?: string }>;
  /** Final output (whatever the strategy produces) */
  output: unknown;
  /** Quality score 0-1 (filled by critic) */
  quality?: number;
  /** Wall time */
  durationMs: number;
  /** Tokens used */
  tokensUsed: number;
  /** Whether the strategy succeeded */
  ok: boolean;
  /** Error if not ok */
  error?: string;
  /** Whether the strategy was cancelled (lost the race) */
  cancelled?: boolean;
  /** Snapshot id (for rollback) */
  snapshotId?: string;
}

/**
 * The race result: the winner + all candidates.
 */
export interface RaceResult {
  raceId: string;
  /** The winning strategy's result (or null if all failed) */
  winner: StrategyResult | null;
  /** All candidates */
  candidates: StrategyResult[];
  /** Total wall time (winner time, not sum) */
  durationMs: number;
  /** Whether we made the budget */
  withinBudget: boolean;
  /** Reason for ending */
  endReason: "winner" | "budget_exceeded" | "all_failed" | "cancelled";
}

/**
 * Verdict from the critic mesh.
 */
export interface MeshVerdict {
  raceId?: string;
  stepId?: string;
  /** Aggregated score 0-1 */
  score: number;
  /** Aggregated confidence 0-1 */
  confidence: number;
  /** Verdict */
  verdict: "pass" | "flag" | "fail";
  /** Per-critic breakdown */
  critics: CriticVerdict[];
  /** Whether the arbiter was triggered (critics disagreed strongly) */
  arbiterTriggered: boolean;
  /** Optional arbiter verdict if triggered */
  arbiterVerdict?: CriticVerdict;
}

export interface CriticVerdict {
  persona: "correctness" | "style" | "intent" | "arbiter";
  /** Score 0-1 */
  score: number;
  /** Confidence 0-1 */
  confidence: number;
  /** Rationale (LLM-generated) */
  rationale: string;
  /** Issues found (for code: bugs, security, style) */
  issues: string[];
  /** Suggestions for improvement */
  suggestions: string[];
  /** Whether this critic passed (score >= threshold) */
  pass: boolean;
  /** Tokens used */
  tokensUsed: number;
  /** Wall time */
  durationMs: number;
}
