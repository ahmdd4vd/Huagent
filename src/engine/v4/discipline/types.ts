/**
 * v4/discipline/types.ts
 *
 * Types for the Discipline Layer — a Fable-5-inspired set of guards that
 * sit alongside the existing v4 primitives (HTN, Critic, Speculation, …) to
 * enforce the Fable 5 working habits:
 *
 *   1. Reason before the first action          (plan-beat)
 *   2. Re-evaluate after every tool result     (observe-beat)
 *   3. Ground in reality first                 (ground-beat)
 *   4. Read the exact region before editing    (fresh-read check)
 *   5. Run the real check after editing        (verify-hook)
 *   6. Diagnose, do not flail                  (diagnose-beat)
 *   7. Narrate decisions                       (beats emit to event stream)
 *
 * The discipline layer is OPTIONAL. Engines opt in by passing a
 * `discipline` config block. When disabled, the engine behaves exactly
 * as before.
 *
 * Why a layer, not new primitives:
 *   The 7 v4 primitives (Stream, HTN, Speculation, Critic, Graph, Capability,
 *   Actor) already do the heavy lifting. The discipline layer WRAPS them
 *   with reasoning beats and state tracking that the primitives do not
 *   provide. It's a sidecar, not a replacement.
 */

import type { CognitiveEvent } from "../stream/cognitive-event.js";

/**
 * Context for generating a plan beat. The engine fills these in based on
 * the current subgoal and the plan it just synthesized.
 */
export interface GoalContext {
  /** What we're trying to achieve (1 sentence) */
  goal: string;
  /** What we believe is true before we look (1 sentence, optional) */
  hypothesis?: string;
  /** First 1-3 concrete steps (free-form, may be HTN step ids) */
  steps?: string[];
  /** Why this approach over alternatives (optional) */
  rationale?: string;
  /** What could go wrong (optional) */
  risks?: string[];
  /** How we know we're done (optional) */
  acceptance?: string;
}

// ─── Plan beat ──────────────────────────────────────────────────────

/**
 * A plan beat is what the engine emits at the start of a (sub)goal,
 * BEFORE the first tool call. It answers: "what am I about to do, and why?"
 *
 * This is the Fable 5 principle 1: "Reason before the first action."
 */
export interface PlanBeat {
  /** Stable id */
  id: string;
  /** What we're trying to achieve */
  goal: string;
  /** What we believe is true before we look (the prediction) */
  hypothesis: string;
  /** First 1-3 concrete steps (free-form, may be HTN step ids) */
  plan: string[];
  /** Why this approach over alternatives */
  rationale: string;
  /** What could go wrong */
  risks: string[];
  /** How we know we're done */
  acceptance: string;
  /** When this beat was emitted (ms since epoch) */
  ts: number;
  /** Which subgoal triggered this beat (if any) */
  subgoalId?: string;
  /** Which step triggered this beat (if any) */
  stepId?: string;
}

// ─── Observe beat ───────────────────────────────────────────────────

/**
 * An observe beat is what the engine emits AFTER a tool returns, BEFORE
 * the next action is decided. It answers: "what just came back, does the
 * plan still hold, do I need to change course?"
 *
 * This is the Fable 5 principle 2: "Re-evaluate after every result."
 */
export interface ObserveBeat {
  /** Stable id */
  id: string;
  /** Which tool returned */
  tool: string;
  /** Summary of the result (engine-generated, may use LLM) */
  summary: string;
  /** Did the result match the hypothesis in the preceding plan beat? */
  matchesHypothesis: boolean;
  /** What we learned that wasn't in the hypothesis (1-3 items) */
  newInfo: string[];
  /** What to do next: keep the plan, or change it */
  decision: "continue" | "adjust" | "abort";
  /** If adjust: what to change (1-3 items) */
  adjustments?: string[];
  /** When this beat was emitted (ms since epoch) */
  ts: number;
  /** The plan beat this observation re-evaluates (if any) */
  planBeatId?: string;
  /** Which subgoal this belongs to */
  subgoalId?: string;
  /** Which step this belongs to */
  stepId?: string;
}

// ─── Ground beat ────────────────────────────────────────────────────

/**
 * A ground beat is what the engine emits at the START of a task, BEFORE
 * the planner runs. It answers: "what's the actual state of the world?"
 *
 * This is the Fable 5 principle 3: "Ground in reality first."
 */
export interface GroundBeat {
  /** Stable id */
  id: string;
  /** What state did we check (e.g., "git status", "tsc --noEmit", "ls") */
  checks: GroundCheck[];
  /** The user task being grounded */
  task: string;
  /** When the ground beat ran (ms since epoch) */
  ts: number;
  /** Total duration of all checks */
  totalDurationMs: number;
}

export interface GroundCheck {
  /** What we ran (e.g., "git status --porcelain") */
  command: string;
  /** Short label for logging (e.g., "git_status") */
  label: string;
  /** Exit code (0 = success) */
  exitCode: number;
  /** Output (truncated to 4 KB) */
  output: string;
  /** Duration in ms */
  durationMs: number;
  /** When this check ran (ms since epoch) */
  ts: number;
}

// ─── Verify ─────────────────────────────────────────────────────────

/**
 * A verify result is what the verify-hook emits after an Edit/Write
 * tool call. It answers: "did the change pass the real test?"
 *
 * This is the Fable 5 principle 5: "Run the real check after editing."
 * Fable 5 only did this 54.5% of the time — the discipline layer fires
 * it on EVERY Edit/Write.
 */
export interface VerifyResult {
  /** Stable id */
  id: string;
  /** The file that was edited (or affected) */
  filePath: string;
  /** The tool that triggered verification (Edit, Write, MultiEdit) */
  trigger: "Edit" | "Write" | "MultiEdit" | "manual";
  /** The command we ran (or empty if skipped) */
  command: string;
  /** Exit code (0 = pass) */
  exitCode: number;
  /** Output (truncated to 4 KB) */
  output: string;
  /** Whether the verify passed */
  passed: boolean;
  /** Duration in ms */
  durationMs: number;
  /** When this verify ran (ms since epoch) */
  ts: number;
  /** If skipped, the reason */
  skipped: boolean;
  reason?: string;
}

// ─── Diagnosis ──────────────────────────────────────────────────────

/**
 * A diagnosis is what the diagnose-beat emits when a tool call errors,
 * BEFORE the engine retries (or gives up). It answers: "what went wrong,
 * what's the fix?"
 *
 * This is the Fable 5 principle 6: "Diagnose, then fix. Never retry blind."
 */
export interface Diagnosis {
  /** Stable id */
  id: string;
  /** The tool that errored */
  tool: string;
  /** The original error message */
  error: string;
  /** Category of error */
  category: ErrorCategory;
  /** Evidence we gathered (stderr lines, file contents, etc.) */
  evidence: string[];
  /** Hypotheses for what went wrong (1-3) */
  hypotheses: string[];
  /** Recommended next action (free-form, engine reads it) */
  recommendedAction: string;
  /** Whether retry with the same args would help (vs fix-the-cause) */
  isRetryable: boolean;
  /** When this diagnosis was emitted (ms since epoch) */
  ts: number;
  /** Which subgoal/step was being attempted */
  subgoalId?: string;
  stepId?: string;
}

export type ErrorCategory =
  | "transient"     // network, timeout, race — retry ok
  | "logic"         // wrong arg, wrong file, wrong order — fix the args
  | "config"        // missing dep, env var, permission — fix the env
  | "environment"   // disk full, OOM, kernel — out of our control
  | "test"          // assertion failed — fix the code
  | "syntax"        // parse error, type error — fix the source
  | "unknown";      // cannot classify

// ─── State tracking ─────────────────────────────────────────────────

/**
 * Per-engine discipline state. Tracks:
 * - When each file was last read (for fresh-read-before-edit check)
 * - History of plan/observe/verify/diagnose beats
 * - Current grounded task
 */
export interface DisciplineState {
  /** File path → ms timestamp of last read in this session */
  fileReadAt: Map<string, number>;
  /** History of plan beats */
  planBeats: PlanBeat[];
  /** History of observe beats */
  observeBeats: ObserveBeat[];
  /** History of ground beats */
  groundBeats: GroundBeat[];
  /** History of verify results */
  verifies: VerifyResult[];
  /** History of diagnoses */
  diagnoses: Diagnosis[];
  /** Current task (after ground) */
  currentTask: string | null;
  /** Last tool that errored (for diagnose context) */
  lastErroredTool: string | null;
  /** Last error (for diagnose context) */
  lastError: string | null;
}

// ─── Configuration ──────────────────────────────────────────────────

/**
 * Discipline layer configuration. All flags default to "off" — engines
 * opt in explicitly. This is a deliberate choice: the discipline layer
 * is a tax on every tool call, and engines that don't want it should
 * not pay for it.
 */
export interface DisciplineConfig {
  /** Enable the plan beat (default: true when this config is set) */
  planBeat?: boolean;
  /** Enable the observe beat (default: true when this config is set) */
  observeBeat?: boolean;
  /** Enable the ground beat at task start (default: true) */
  groundBeat?: boolean;
  /** Enable the verify hook after Edit/Write (default: true) */
  verifyHook?: boolean;
  /** Enable the diagnose beat on tool error (default: true) */
  diagnoseBeat?: boolean;
  /** Enable the fresh-read-before-edit check (default: true) */
  freshReadCheck?: boolean;
  /** How long after a read is it "stale"? Default 5 minutes */
  freshReadTtlMs?: number;
  /** Auto-verify config: which command to run per project stack */
  verifyConfig?: VerifyHookConfig;
  /** Optional LLM call for plan/observe beats (for higher-quality narration) */
  llmNarrate?: (prompt: string) => Promise<string>;
  /** Optional shell executor for ground/verify/diagnose */
  exec?: (command: string, cwd?: string) => Promise<{ stdout: string; stderr: string; exitCode: number; durationMs: number }>;
}

export interface VerifyHookConfig {
  /** When to run verify: "always", "if_project_test", "never" */
  mode?: "always" | "if_project_test" | "never";
  /** Explicit command to run. If not set, auto-detect from project. */
  command?: string;
  /** Auto-detection patterns (regex over file content) */
  autoDetect?: Array<{ pattern: RegExp; command: string; language: string }>;
  /** Max time to wait for verify (ms) */
  timeoutMs?: number;
}

// ─── Event kinds (added to CognitiveEvent) ──────────────────────────

/**
 * New CognitiveEvent kinds emitted by the discipline layer.
 * These are added to the existing union in cognitive-event.ts.
 */
export type DisciplineEvent =
  | { kind: "plan_beat"; beat: PlanBeat; ts: number; seq: number; meta?: Record<string, unknown> }
  | { kind: "observe_beat"; beat: ObserveBeat; ts: number; seq: number; meta?: Record<string, unknown> }
  | { kind: "ground_beat"; beat: GroundBeat; ts: number; seq: number; meta?: Record<string, unknown> }
  | { kind: "verify_started"; filePath: string; command: string; ts: number; seq: number; meta?: Record<string, unknown> }
  | { kind: "verify_completed"; result: VerifyResult; ts: number; seq: number; meta?: Record<string, unknown> }
  | { kind: "verify_failed"; result: VerifyResult; ts: number; seq: number; meta?: Record<string, unknown> }
  | { kind: "stale_edit_blocked"; filePath: string; lastReadAt: number; ageMs: number; ts: number; seq: number; meta?: Record<string, unknown> }
  | { kind: "diagnose_started"; tool: string; error: string; ts: number; seq: number; meta?: Record<string, unknown> }
  | { kind: "diagnose_completed"; diagnosis: Diagnosis; ts: number; seq: number; meta?: Record<string, unknown> };

/**
 * Helper type guard: is this event a discipline event?
 */
export function isDisciplineEvent(e: CognitiveEvent): e is CognitiveEvent & DisciplineEvent {
  return (
    e.kind === "plan_beat" ||
    e.kind === "observe_beat" ||
    e.kind === "ground_beat" ||
    e.kind === "verify_started" ||
    e.kind === "verify_completed" ||
    e.kind === "verify_failed" ||
    e.kind === "stale_edit_blocked" ||
    e.kind === "diagnose_started" ||
    e.kind === "diagnose_completed"
  );
}
