/**
 * v4/htn/types.ts
 *
 * Hierarchical Task Network (HTN) data model.
 *
 * Mental model:
 *   Task  (user request)
 *     └── Subgoal  (high-level objective)
 *           ├── Step  (atomic tool call)
 *           └── Subgoal  (recursive)
 *                 └── Step
 *
 * Subgoals can have dependencies on other subgoals (DAG, not tree).
 * Steps within a subgoal are sequential.
 * Subgoals with no `dependsOn` edges run in parallel.
 *
 * Pyhop-style:
 * - Methods decompose a task into subgoals.
 * - Operators are atomic (no further decomposition).
 * - A plan is a sequence of operators, grouped by subgoal, ordered by
 *   dependency and parallel groups.
 */

import type { Intent, Complexity } from "../stream/cognitive-event.js";

/**
 * An atomic step: a single tool call.
 */
export interface HTNStep {
  /** Stable id (uuid-like, generated) */
  id: string;
  /** Tool name (e.g., "read_file", "edit_search_replace", "bash") */
  tool: string;
  /** Tool arguments */
  args: Record<string, unknown>;
  /** Estimated duration in ms (best guess, used for budgeting) */
  estimatedMs?: number;
  /** Risk level: 0=trivial, 1=low, 2=medium, 3=high (reversibility matters) */
  risk?: 0 | 1 | 2 | 3;
  /** Human description for logging */
  description?: string;
  /** Whether this step can be safely retried on failure */
  retryable?: boolean;
}

/**
 * A subgoal: a high-level objective decomposed into steps (and possibly
 * sub-subgoals).
 */
export interface HTNSubgoal {
  /** Stable id */
  id: string;
  /** Human description */
  description: string;
  /** Steps in this subgoal, executed sequentially */
  steps: HTNStep[];
  /** Subgoals this depends on (must complete first) */
  dependsOn: string[];
  /** Parallel group: subgoals in the same group run together. */
  parallelGroup?: number;
  /** Acceptance criteria: how we know this subgoal succeeded. */
  acceptance?: string;
  /** Rollback strategy: how to undo this subgoal if it fails */
  rollback?: HTNStep[];
}

/**
 * The full HTN plan: tree of subgoals, plus a flat sequence for execution.
 */
export interface HTNPlan {
  /** Stable plan id */
  id: string;
  /** Original task */
  task: string;
  /** Detected intent (drives method selection) */
  intent: Intent;
  /** Detected complexity */
  complexity: Complexity;
  /** Top-level subgoals */
  subgoals: HTNSubgoal[];
  /** Execution order: topologically sorted list of subgoal ids, grouped by parallel batch */
  executionOrder: string[][];
  /** Total estimated cost in ms */
  estimatedMs: number;
  /** Methods used (for explainability) */
  methodsUsed: string[];
  /** Created at (ms since engine start) */
  createdAt: number;
  /** Whether this plan was synthesized by LLM (vs cached/built-in) */
  synthesizedBy: "llm" | "cache" | "built-in" | "v3-fallback" | "synthesized";
}

/**
 * Method: how to decompose a task into subgoals.
 *
 * A method matches if its `precondition(task, context)` returns true.
 * It then returns subgoals (and recursively, more methods can be applied
 * to those subgoals).
 */
export interface HTNMethod {
  /** Method name (e.g., "decompose-add-feature") */
  name: string;
  /** Description of what this method does */
  description: string;
  /** Which intent(s) this method applies to */
  appliesTo: Intent[];
  /** Decide if this method applies to a task */
  precondition: (task: string, context: PlanContext) => boolean | Promise<boolean>;
  /** Produce subgoals */
  apply: (task: string, context: PlanContext) => HTNSubgoal[] | Promise<HTNSubgoal[]>;
  /** Source of this method: built-in, learned, or synthesized */
  source: "built-in" | "learned" | "synthesized";
  /** Confidence / success rate (for ranking) */
  confidence: number;
  /** Cost in tokens (estimated) when invoking LLM */
  costTokens?: number;
}

/**
 * Context passed to methods: project info, identity, prior episodes, etc.
 */
export interface PlanContext {
  /** Detected project stack (from coldstart) */
  project?: {
    root: string;
    language?: string;
    framework?: string;
    testFramework?: string;
    packageManager?: string;
  };
  /** Files relevant to this task (from grep / glob) */
  relevantFiles?: string[];
  /** Prior episodes (graph recall) */
  priorEpisodes?: Array<{ id: string; task: string; ok: boolean; summary: string }>;
  /** Applicable insights (from instinct synthesis) */
  insights?: Array<{ kind: "recipe" | "anti"; text: string; confidence: number }>;
  /** User identity / persona (for personalization) */
  user?: { name: string; preferences: Record<string, string> };
}

/**
 * Result of plan execution.
 */
export interface PlanResult {
  plan: HTNPlan;
  /** Per-subgoal results */
  subgoals: Map<string, { ok: boolean; durationMs: number; error?: string; steps: Map<string, { ok: boolean; durationMs: number; result?: unknown; error?: string }> }>;
  /** Total wall time */
  totalMs: number;
  /** Overall success */
  ok: boolean;
}
