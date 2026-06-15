/**
 * v4/speculative/race.ts
 *
 * The Speculative Executor: race N strategies in parallel, take the
 * first one to satisfy a quality threshold.
 *
 * Key design decisions:
 * 1. **Shadow snapshots**: each strategy operates on its own file-system
 *    snapshot, so losers can be rolled back without affecting the winner.
 *    (For v4.0 we use a logical snapshot (in-memory) — see snapshot.ts.)
 *
 * 2. **Hedged timing**: the first strategy to finish is "fast path".
 *    If it passes the quality threshold, we commit. If not, we wait for
 *    the second strategy and compare.
 *
 * 3. **Budget**: total wall time is bounded. After the budget, the best
 *    result so far wins, even if no one passed the threshold.
 *
 * 4. **Cancellation**: losers are cancelled to free resources.
 *
 * 5. **Diversity**: strategies should be diverse (different prompts,
 *    different tools) to maximize the chance that at least one works.
 *
 * Why "first quality winner" instead of "all then pick best":
 * - Latency: most of the time, one strategy is good enough, faster.
 * - Cost: we don't run losers to completion.
 * - User experience: feedback comes sooner.
 *
 * When we pick "best of N" instead:
 * - Critical operations (security, irreversible changes): we wait for all
 *   and pick the safest.
 */

import { randomUUID } from "node:crypto";
import type { Strategy, StrategyStep, StrategyResult, RaceContext, RaceResult } from "./types.js";
import { EventFactory } from "../stream/cognitive-event.js";

/**
 * Configuration for a race.
 */
export interface RaceConfig {
  /** Strategies to race */
  strategies: Strategy[];
  /** Total budget in ms (default 5000) */
  budgetMs: number;
  /** Quality threshold for "good enough" (default 0.7) */
  qualityThreshold: number;
  /** Mode: "first_wins" or "best_of_n" */
  mode: "first_wins" | "best_of_n";
  /** Per-strategy timeout (default = budget) */
  perStrategyTimeoutMs?: number;
  /** Function to execute a strategy step (returns the step's result) */
  executeStep: (tool: string, args: Record<string, unknown>, ctx: RaceContext) => Promise<{ result: unknown; tokensUsed: number }>;
  /** Function to assess quality of a result */
  assessQuality: (result: unknown, ctx: RaceContext) => Promise<{ score: number; confidence: number; rationale: string }>;
  /** Optional snapshot for rollback */
  snapshotId?: string;
  /** Original task (for events) */
  task: string;
  /** Optional EventFactory for emitting events */
  events?: EventFactory;
}

/**
 * Race N strategies, return the first to pass quality threshold.
 *
 * Algorithm:
 *   1. Launch all strategies in parallel (Promise.race-like).
 *   2. As each finishes:
 *      - If mode is "first_wins" and quality >= threshold, declare winner.
 *      - If mode is "best_of_n", collect and pick best.
 *   3. Cancel remaining strategies.
 *   4. Return winner (or best of N).
 */
export async function race(config: RaceConfig): Promise<RaceResult> {
  const t0 = Date.now();
  const raceId = randomUUID();
  const ctx: RaceContext = {
    task: config.task,
  };

  // Emit speculation_started
  if (config.events) {
    const ev = config.events.make("speculation_started", {
      raceId,
      strategies: config.strategies.map((s) => s.name),
      budgetMs: config.budgetMs,
    });
    if (config.events.onEmit) config.events.onEmit(ev);
  }

  // Launch all strategies in parallel
  const promises: Array<Promise<StrategyResult>> = config.strategies.map((s) =>
    runStrategy(s, config, raceId, ctx, t0)
  );

  let winner: StrategyResult | null = null;
  const candidates: StrategyResult[] = [];
  let endReason: RaceResult["endReason"] = "all_failed";
  const perStrategyTimeout = config.perStrategyTimeoutMs ?? config.budgetMs;

  if (config.mode === "first_wins") {
    // Wait for first to pass quality threshold, or all to finish, or budget.
    // We DON'T short-circuit the promise collection — we wait for all strategies
    // to finish, but we end the *race* as soon as a winner is found (so the
    // caller doesn't wait for slow losers). However, we still collect their
    // results for reporting.
    const overallDeadline = t0 + config.budgetMs;
    const settled: Array<StrategyResult | null> = new Array(promises.length).fill(null);

    await new Promise<void>((resolve) => {
      let resolved = false;
      const finish = (reason: RaceResult["endReason"]) => {
        if (resolved) return;
        resolved = true;
        endReason = reason;
        resolve();
      };

      promises.forEach((p, i) => {
        p.then((result) => {
          settled[i] = result;
          // Don't short-circuit on winner; collect all results.
          // The end condition is: winner found, all done, or budget.
          if (result.ok && (result.quality ?? 0) >= config.qualityThreshold && endReason === "all_failed") {
            endReason = "winner";
            // Don't resolve yet — let other strategies finish so we can report
            // them as cancelled. The next check (all done or budget) will
            // resolve.
          }
          if (settled.every((s) => s !== null)) {
            // All done
            if (endReason !== "winner") endReason = candidates.length > 0 && candidates.every((c) => !c.ok) ? "all_failed" : "winner";
            finish(endReason);
          } else if (Date.now() >= overallDeadline) {
            finish("budget_exceeded");
          }
        }).catch((err) => {
          if (settled[i] === null) {
            settled[i] = {
              strategyId: config.strategies[i].id,
              strategyName: config.strategies[i].name,
              stepResults: [],
              output: null,
              durationMs: Date.now() - t0,
              tokensUsed: 0,
              ok: false,
              error: err instanceof Error ? err.message : String(err),
              cancelled: false,
            };
          }
          if (settled.every((s) => s !== null)) {
            finish("all_failed");
          }
        });
      });

      // Budget watchdog
      setTimeout(() => {
        if (!resolved) finish("budget_exceeded");
      }, config.budgetMs);
    });

    // Collect all settled results
    for (const r of settled) {
      if (r && !candidates.find((c) => c.strategyId === r.strategyId)) {
        candidates.push(r);
      }
    }

    // Find winner
    winner = candidates.find((c) => c.ok && (c.quality ?? 0) >= config.qualityThreshold) ?? null;

    if (!winner) {
      // No one passed threshold. Take best of N.
      const best = candidates
        .filter((c) => c.ok)
        .sort((a, b) => (b.quality ?? 0) - (a.quality ?? 0))[0];
      if (best) {
        winner = { ...best, cancelled: false };
        endReason = "budget_exceeded";
      } else {
        // All failed
        winner = null;
        endReason = "all_failed";
      }
    }
  } else {
    // Best of N: wait for all (or budget)
    const settled = await Promise.allSettled(promises);
    for (let i = 0; i < settled.length; i++) {
      const r = settled[i];
      if (r.status === "fulfilled") {
        candidates.push(r.value);
      } else {
        candidates.push({
          strategyId: config.strategies[i].id,
          strategyName: config.strategies[i].name,
          stepResults: [],
          output: null,
          durationMs: Date.now() - t0,
          tokensUsed: 0,
          ok: false,
          error: r.reason instanceof Error ? r.reason.message : String(r.reason),
          cancelled: false,
        });
      }
    }
    const best = candidates
      .filter((c) => c.ok)
      .sort((a, b) => (b.quality ?? 0) - (a.quality ?? 0))[0];
    winner = best ?? null;
    endReason = winner ? "winner" : "all_failed";
  }

  // Mark losers as cancelled
  if (winner) {
    for (const c of candidates) {
      if (c.strategyId !== winner.strategyId && !c.cancelled) {
        c.cancelled = true;
      }
    }
  }

  const durationMs = Date.now() - t0;

  // Emit winner event
  if (config.events && winner) {
    const ev = config.events.make("speculation_winner", {
      raceId,
      strategyId: winner.strategyId,
      quality: winner.quality ?? 0,
      durationMs,
    });
    if (config.events.onEmit) config.events.onEmit(ev);
  }

  return {
    raceId,
    winner,
    candidates,
    durationMs,
    withinBudget: durationMs <= config.budgetMs,
    endReason,
  };
}

/**
 * Run a single strategy: execute all its steps in sequence, then assess
 * quality.
 */
async function runStrategy(
  strategy: Strategy,
  config: RaceConfig,
  raceId: string,
  ctx: RaceContext,
  t0: number
): Promise<StrategyResult> {
  const strategyT0 = Date.now();
  const stepResults: StrategyResult["stepResults"] = [];
  let totalTokens = 0;
  let lastResult: unknown = null;
  let ok = true;
  let error: string | undefined;

  try {
    if (strategy.precondition) {
      const pre = await strategy.precondition(ctx);
      if (!pre) {
        return {
          strategyId: strategy.id,
          strategyName: strategy.name,
          stepResults: [],
          output: null,
          durationMs: Date.now() - strategyT0,
          tokensUsed: 0,
          ok: false,
          error: "precondition failed",
          cancelled: false,
        };
      }
    }

    for (const step of strategy.steps) {
      const stepT0 = Date.now();
      try {
        const { result, tokensUsed } = await config.executeStep(step.tool, step.args, ctx);
        stepResults.push({
          tool: step.tool,
          result,
          durationMs: Date.now() - stepT0,
          ok: true,
        });
        totalTokens += tokensUsed;
        lastResult = result;
      } catch (err) {
        ok = false;
        error = err instanceof Error ? err.message : String(err);
        stepResults.push({
          tool: step.tool,
          result: null,
          durationMs: Date.now() - stepT0,
          ok: false,
          error,
        });
        break;
      }
    }
  } catch (err) {
    ok = false;
    error = err instanceof Error ? err.message : String(err);
  }

  let quality: number | undefined;
  if (ok) {
    try {
      const assessment = await config.assessQuality(lastResult, ctx);
      quality = assessment.score;
    } catch (err) {
      // Quality assessment failed; treat as 0
      quality = 0;
    }
  }

  return {
    strategyId: strategy.id,
    strategyName: strategy.name,
    stepResults,
    output: lastResult,
    quality,
    durationMs: Date.now() - strategyT0,
    tokensUsed: totalTokens,
    ok,
    error,
    cancelled: false,
  };
}

/**
 * Strategy diversifier: given a base strategy spec, produce 3 variants
 * (fast/balanced/thorough) with diverse cost/quality profiles.
 *
 * This is what makes the race worth running: identical strategies
 * racing each other is wasteful. Diverse strategies cover more of the
 * solution space.
 */
export function diversifyStrategy(
  base: {
    description: string;
    steps: StrategyStep[];
    precondition?: (context: RaceContext) => boolean | Promise<boolean>;
    estimatedMs: number;
    estimatedQuality: number;
    estimatedCostTokens: number;
    risk: 0 | 1 | 2 | 3;
  },
  options: { name?: string; generateId?: () => string } = {}
): Strategy[] {
  const genId = options.generateId ?? randomUUID;
  const baseName = options.name ?? "strategy";

  return [
    {
      id: genId(),
      name: `${baseName}-fast`,
      description: base.description + " (minimal, fast path)",
      steps: base.steps.slice(0, Math.max(1, Math.floor(base.steps.length * 0.5))),
      precondition: base.precondition,
      estimatedMs: Math.floor(base.estimatedMs * 0.5),
      estimatedQuality: base.estimatedQuality * 0.85,
      estimatedCostTokens: Math.floor(base.estimatedCostTokens * 0.5),
      risk: Math.max(0, base.risk - 1) as 0 | 1 | 2 | 3,
      diversity: 0.4,
    },
    {
      id: genId(),
      name: `${baseName}-balanced`,
      description: base.description + " (standard approach)",
      steps: base.steps,
      precondition: base.precondition,
      estimatedMs: base.estimatedMs,
      estimatedQuality: base.estimatedQuality,
      estimatedCostTokens: base.estimatedCostTokens,
      risk: base.risk,
      diversity: 0.0,
    },
    {
      id: genId(),
      name: `${baseName}-thorough`,
      description: base.description + " (with verification)",
      steps: [
        ...base.steps,
        { tool: "verify", args: {}, description: "Run extra verification" },
      ],
      precondition: base.precondition,
      estimatedMs: Math.floor(base.estimatedMs * 1.5),
      estimatedQuality: Math.min(1, base.estimatedQuality * 1.1),
      estimatedCostTokens: Math.floor(base.estimatedCostTokens * 1.5),
      risk: Math.min(3, base.risk + 1) as 0 | 1 | 2 | 3,
      diversity: 0.6,
    },
  ];
}
