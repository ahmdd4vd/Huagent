/**
 * v4/discipline/manager.ts
 *
 * DisciplineManager — the single entry point for the discipline layer.
 * Wires together plan-beat, observe-beat, ground-beat, verify-hook, and
 * diagnose-beat behind a small, focused API.
 *
 * The engine holds ONE DisciplineManager per session. The manager holds
 * ONE DisciplineState, which is the source of truth for file-read
 * tracking, beat history, and the current task.
 *
 * Public API (the only methods the engine needs):
 *   - ground(task)               — at task start
 *   - plan(goal)                 — before each subgoal
 *   - observe(tool, result)      — after each tool result
 *   - verify(filePath, trigger)  — after Edit/Write
 *   - diagnose(tool, error)      — on tool error
 *   - markFileRead(filePath)     — track that we read a file
 *   - checkFreshRead(filePath)   — should we block an edit?
 *   - getState()                 — for tests / introspection
 *
 * Everything else (LLM narration, executors, event emission) is internal.
 */

import { randomUUID } from "node:crypto";
import type {
  DisciplineConfig,
  DisciplineState,
  PlanBeat,
  ObserveBeat,
  GroundBeat,
  VerifyResult,
  Diagnosis,
  GoalContext,
  VerifyHookConfig,
} from "./types.js";
import { createDisciplineState, markFileRead, markFilesRead, checkFreshRead as checkFreshReadInState, computeDisciplineMetrics, snapshotDisciplineState, resetDisciplineState } from "./state.js";
import { generatePlanBeat, generatePlanBeatWithLLM, generatePlanBeatFromSubgoal, type HTNSubgoalLite } from "./plan-beat.js";
import { generateObserveBeat, generateObserveBeatWithLLM } from "./observe-beat.js";
import { generateVerify, runManualVerify, autoDetectTestCommand, type AutoDetectContext, type ShellExecutor } from "./verify-hook.js";
import { generateDiagnosis, generateDiagnosisWithLLM } from "./diagnose-beat.js";
import { generateGroundBeat, generateGroundBeatSync, type GroundContext } from "./ground-beat.js";
import { EventFactory } from "../stream/cognitive-event.js";

/**
 * The DisciplineManager.
 */
export class DisciplineManager {
  private state: DisciplineState;
  private config: Required<Omit<DisciplineConfig, "verifyConfig" | "llmNarrate" | "exec">> & {
    verifyConfig: VerifyHookConfig;
    llmNarrate?: (prompt: string) => Promise<string>;
    exec?: ShellExecutor;
  };
  private events: EventFactory;
  private projectRoot: string;
  private autoDetectCache: AutoDetectContext | null = null;

  constructor(opts: {
    config: DisciplineConfig;
    events: EventFactory;
    projectRoot?: string;
  }) {
    this.state = createDisciplineState();
    this.events = opts.events;
    this.projectRoot = opts.projectRoot ?? process.cwd();
    this.config = {
      planBeat: opts.config.planBeat ?? true,
      observeBeat: opts.config.observeBeat ?? true,
      groundBeat: opts.config.groundBeat ?? true,
      verifyHook: opts.config.verifyHook ?? true,
      diagnoseBeat: opts.config.diagnoseBeat ?? true,
      freshReadCheck: opts.config.freshReadCheck ?? true,
      freshReadTtlMs: opts.config.freshReadTtlMs ?? 5 * 60 * 1000,
      verifyConfig: opts.config.verifyConfig ?? {},
      llmNarrate: opts.config.llmNarrate,
      exec: opts.config.exec,
    };
  }

  // ─── Public API ──────────────────────────────────────────────────

  /**
   * Ground in reality. Runs state checks at task start. Returns the beat.
   */
  async ground(ctx: GroundContext): Promise<GroundBeat> {
    if (!this.config.groundBeat) {
      return generateGroundBeatSync({ state: this.state, context: ctx, events: this.events, checks: [] });
    }
    return generateGroundBeat({
      state: this.state,
      context: { ...ctx, exec: ctx.exec ?? this.config.exec },
      events: this.events,
    });
  }

  /**
   * Generate a plan beat for a goal. Returns the beat.
   */
  plan(ctx: GoalContext, opts?: { subgoalId?: string; stepId?: string; useLLM?: boolean }): PlanBeat {
    if (!this.config.planBeat) {
      // Return a minimal beat (still recorded for tests)
      return generatePlanBeat({ state: this.state, context: ctx, events: this.events, subgoalId: opts?.subgoalId, stepId: opts?.stepId });
    }
    return generatePlanBeat({ state: this.state, context: ctx, events: this.events, subgoalId: opts?.subgoalId, stepId: opts?.stepId });
  }

  /**
   * Async plan with LLM narration. Falls back to heuristic if LLM errors.
   */
  async planAsync(ctx: GoalContext, opts?: { subgoalId?: string; stepId?: string }): Promise<PlanBeat> {
    if (!this.config.planBeat) {
      return this.plan(ctx, opts);
    }
    if (this.config.llmNarrate) {
      return generatePlanBeatWithLLM({
        state: this.state,
        context: ctx,
        events: this.events,
        llmNarrate: this.config.llmNarrate,
        subgoalId: opts?.subgoalId,
        stepId: opts?.stepId,
      });
    }
    return this.plan(ctx, opts);
  }

  /**
   * Generate a plan beat from an HTN subgoal (heuristic, fast).
   */
  planFromSubgoal(subgoal: HTNSubgoalLite): PlanBeat {
    if (!this.config.planBeat) {
      return generatePlanBeat({
        state: this.state,
        context: { goal: subgoal.description },
        events: this.events,
        subgoalId: subgoal.id,
      });
    }
    return generatePlanBeatFromSubgoal(this.state, subgoal, this.events);
  }

  /**
   * Generate an observe beat for a tool result. Returns the beat.
   */
  observe(tool: string, result: unknown, opts?: {
    planBeat?: PlanBeat;
    subgoalId?: string;
    stepId?: string;
  }): ObserveBeat {
    if (!this.config.observeBeat) {
      // Still record, but make it minimal
      return generateObserveBeat({
        state: this.state,
        tool,
        result,
        events: this.events,
        planBeat: opts?.planBeat,
        subgoalId: opts?.subgoalId,
        stepId: opts?.stepId,
        decision: "continue",
        summary: "(observe disabled)",
        matches: true,
      });
    }
    return generateObserveBeat({
      state: this.state,
      tool,
      result,
      events: this.events,
      planBeat: opts?.planBeat,
      subgoalId: opts?.subgoalId,
      stepId: opts?.stepId,
    });
  }

  /**
   * Async observe with LLM narration.
   */
  async observeAsync(tool: string, result: unknown, opts?: {
    planBeat?: PlanBeat;
    subgoalId?: string;
    stepId?: string;
  }): Promise<ObserveBeat> {
    if (!this.config.observeBeat) return this.observe(tool, result, opts);
    if (this.config.llmNarrate) {
      return generateObserveBeatWithLLM({
        state: this.state,
        tool,
        result,
        events: this.events,
        planBeat: opts?.planBeat,
        subgoalId: opts?.subgoalId,
        stepId: opts?.stepId,
        llmNarrate: this.config.llmNarrate,
      });
    }
    return this.observe(tool, result, opts);
  }

  /**
   * Generate a verify result for an edit. Returns the result.
   * No-op (skipped) if verifyHook is disabled.
   */
  async verify(filePath: string, trigger: VerifyResult["trigger"], opts?: {
    autoDetect?: AutoDetectContext;
  }): Promise<VerifyResult> {
    if (!this.config.verifyHook) {
      const id = randomUUID();
      const ts = Date.now();
      const result: VerifyResult = {
        id,
        filePath,
        trigger,
        command: "",
        exitCode: 0,
        output: "",
        passed: true,
        durationMs: 0,
        ts,
        skipped: true,
        reason: "verifyHook disabled",
      };
      this.events.make("verify_completed", { result });
      return result;
    }
    const ctx = opts?.autoDetect ?? this.autoDetectCache ?? this.buildAutoDetect();
    return generateVerify({
      state: this.state,
      filePath,
      trigger,
      config: this.config.verifyConfig,
      projectRoot: this.projectRoot,
      autoDetect: ctx,
      events: this.events,
      exec: this.config.exec,
    });
  }

  /**
   * Generate a diagnosis for a tool error. Returns the diagnosis.
   * No-op (heuristic only) if diagnoseBeat is disabled.
   */
  diagnose(tool: string, error: string, opts?: {
    args?: unknown;
    planBeatId?: string;
    subgoalId?: string;
    stepId?: string;
  }): Diagnosis {
    if (!this.config.diagnoseBeat) {
      return generateDiagnosis({
        state: this.state,
        tool,
        error,
        events: this.events,
        category: "unknown",
        recommendedAction: "(diagnose disabled)",
        isRetryable: false,
        subgoalId: opts?.subgoalId,
        stepId: opts?.stepId,
      });
    }
    return generateDiagnosis({
      state: this.state,
      tool,
      error,
      args: opts?.args,
      planBeatId: opts?.planBeatId,
      subgoalId: opts?.subgoalId,
      stepId: opts?.stepId,
      events: this.events,
    });
  }

  /**
   * Async diagnosis with LLM narration.
   */
  async diagnoseAsync(tool: string, error: string, opts?: {
    args?: unknown;
    planBeatId?: string;
    subgoalId?: string;
    stepId?: string;
  }): Promise<Diagnosis> {
    if (!this.config.diagnoseBeat) return this.diagnose(tool, error, opts);
    if (this.config.llmNarrate) {
      return generateDiagnosisWithLLM({
        state: this.state,
        tool,
        error,
        args: opts?.args,
        planBeatId: opts?.planBeatId,
        subgoalId: opts?.subgoalId,
        stepId: opts?.stepId,
        events: this.events,
        llmNarrate: this.config.llmNarrate,
      });
    }
    return this.diagnose(tool, error, opts);
  }

  /**
   * Mark a file as read. Subsequent edits will pass the fresh-read check
   * (within TTL).
   */
  markFileRead(filePath: string, ts?: number): void {
    markFileRead(this.state, filePath, ts);
  }

  /**
   * Mark multiple files as read.
   */
  markFilesRead(filePaths: readonly string[], ts?: number): void {
    markFilesRead(this.state, filePaths, ts);
  }

  /**
   * Check whether a file has a fresh read. If not, the engine should
   * read the file first (or accept the staleness).
   */
  checkFreshRead(filePath: string): { ok: boolean; lastReadAt: number | null; ageMs: number; reason?: string } {
    if (!this.config.freshReadCheck) {
      return { ok: true, lastReadAt: null, ageMs: 0 };
    }
    return checkFreshReadInState(this.state, filePath, this.config.freshReadTtlMs);
  }

  /**
   * Get the discipline state (read-only snapshot).
   */
  getState(): DisciplineState {
    return this.state;
  }

  /**
   * Get a serializable snapshot of the state.
   */
  snapshot() {
    return snapshotDisciplineState(this.state);
  }

  /**
   * Compute current discipline metrics.
   */
  metrics() {
    return computeDisciplineMetrics(this.state);
  }

  /**
   * Reset the state. Used between sessions in long-running engines.
   */
  reset(): void {
    resetDisciplineState(this.state);
  }

  // ─── Internals ───────────────────────────────────────────────────

  /**
   * Build the auto-detect context for verify. Caches the result.
   */
  private buildAutoDetect(): AutoDetectContext {
    if (this.autoDetectCache) return this.autoDetectCache;
    // For now, return a minimal context with no file info. The verify
    // hook will skip if it can't find a test command.
    const ctx: AutoDetectContext = {
      projectRoot: this.projectRoot,
      fileNames: [],
    };
    this.autoDetectCache = ctx;
    return ctx;
  }
}
