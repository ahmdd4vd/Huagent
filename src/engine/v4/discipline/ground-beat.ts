/**
 * v4/discipline/ground-beat.ts
 *
 * Fable 5 principle 3: "Ground in reality first."
 *
 * The ground-beat is what the engine emits at the START of a task, BEFORE
 * the planner runs. It answers: "what's the actual state of the world?"
 *
 * Real Fable 5 samples (from the dataset):
 *   "I attempted to retrieve the file with a Bash cat command targeting
 *    /home/lane/MythosMini/agents.md. The command failed to find a
 *    lowercase-named file, but the directory listing returned shows a
 *    file named AGENTS.md (uppercase). That tells me the file does
 *    exist, just with a different case."
 *
 * The ground-beat is the structured form: it runs a small set of state
 * checks (git status, directory listing, key file reads) BEFORE planning.
 *
 * Default ground checks (in order):
 *   1. `git status --porcelain` (if .git exists) — current dirty state
 *   2. `ls -la <projectRoot>` — top-level layout
 *   3. `cat package.json | head -50` (if exists) — project type
 *   4. `cat README.md | head -30` (if exists) — project context
 *
 * Each check is bounded: max output 4 KB, max duration 5s. If a check
 * fails, we record it but continue with the others.
 */

import { randomUUID } from "node:crypto";
import type { GroundBeat, GroundCheck, DisciplineState } from "./types.js";
import { recordGroundBeat } from "./state.js";
import { EventFactory } from "../stream/cognitive-event.js";
import { defaultShellExec, type ShellExecutor } from "./verify-hook.js";

/**
 * Context for the ground beat. Tells us where to look and what to skip.
 */
export interface GroundContext {
  /** The user task being grounded */
  task: string;
  /** Project root (absolute path) */
  projectRoot: string;
  /** Whether the project uses git (skip git check if false) */
  hasGit?: boolean;
  /** Maximum number of checks to run (default 4) */
  maxChecks?: number;
  /** Maximum output bytes per check (default 4 KB) */
  maxOutputBytes?: number;
  /** Maximum duration per check in ms (default 5s) */
  maxDurationMs?: number;
  /** Optional executor override (for tests) */
  exec?: ShellExecutor;
}

const DEFAULT_MAX_OUTPUT = 4096;
const DEFAULT_MAX_DURATION = 5000;

/**
 * Build the list of default ground checks for a project.
 * Returns checks in priority order; the ground-beat runs up to maxChecks.
 */
export function buildDefaultGroundChecks(ctx: GroundContext): Array<{ label: string; command: string }> {
  const checks: Array<{ label: string; command: string }> = [];

  if (ctx.hasGit !== false) {
    checks.push({ label: "git_status", command: "git status --porcelain 2>&1 | head -20" });
  }

  checks.push({ label: "ls_root", command: "ls -la 2>&1 | head -30" });

  // Project-type detection (read first 50 lines)
  checks.push({ label: "package_json", command: "test -f package.json && head -50 package.json || echo 'no package.json'" });
  checks.push({ label: "readme", command: "test -f README.md && head -30 README.md || echo 'no README.md'" });

  return checks.slice(0, ctx.maxChecks ?? 4);
}

/**
 * Run a single ground check. Returns a GroundCheck record.
 */
export async function runGroundCheck(
  label: string,
  command: string,
  cwd: string,
  exec: ShellExecutor,
  maxDurationMs: number = DEFAULT_MAX_DURATION,
  maxOutputBytes: number = DEFAULT_MAX_OUTPUT,
): Promise<GroundCheck> {
  const ts = Date.now();
  let output = "";
  let exitCode = 0;
  let durationMs = 0;
  try {
    const r = await exec(command, cwd, maxDurationMs);
    exitCode = r.exitCode;
    durationMs = r.durationMs;
    output = (r.stdout + (r.stderr ? "\n" + r.stderr : "")).trim();
  } catch (err) {
    exitCode = 1;
    output = err instanceof Error ? err.message : String(err);
  }
  if (output.length > maxOutputBytes) {
    output = output.slice(0, maxOutputBytes) + "\n…(truncated)";
  }
  return { command, label, exitCode, output, durationMs, ts };
}

/**
 * Generate a ground beat. Runs the default checks in sequence, records
 * the result, and emits a `ground_beat` event.
 */
export interface GenerateGroundBeatOptions {
  state: DisciplineState;
  context: GroundContext;
  /** Custom checks (overrides defaults) */
  checks?: Array<{ label: string; command: string }>;
  /** Event factory */
  events: EventFactory;
}

export async function generateGroundBeat(opts: GenerateGroundBeatOptions): Promise<GroundBeat> {
  const { state, context, events } = opts;
  const id = randomUUID();
  const ts = Date.now();
  const exec = context.exec ?? defaultShellExec;
  const maxDuration = context.maxDurationMs ?? DEFAULT_MAX_DURATION;
  const maxOutput = context.maxOutputBytes ?? DEFAULT_MAX_OUTPUT;

  const checksToRun = opts.checks ?? buildDefaultGroundChecks(context);
  const results: GroundCheck[] = [];
  const t0 = Date.now();

  for (const c of checksToRun) {
    const r = await runGroundCheck(c.label, c.command, context.projectRoot, exec, maxDuration, maxOutput);
    results.push(r);
  }

  const beat: GroundBeat = {
    id,
    task: context.task,
    checks: results,
    ts,
    totalDurationMs: Date.now() - t0,
  };

  recordGroundBeat(state, beat);
  events.make("ground_beat", { beat });
  return beat;
}

/**
 * Synchronous version: skip the actual shell execution. Used when the
 * caller already knows the state (e.g., from a cached snapshot) or for
 * dry-run / planning purposes.
 */
export function generateGroundBeatSync(opts: GenerateGroundBeatOptions): GroundBeat {
  const { state, context, events } = opts;
  const id = randomUUID();
  const ts = Date.now();
  const checksToRun = opts.checks ?? buildDefaultGroundChecks(context);

  // Stub checks: no execution, just record the intent
  const checks: GroundCheck[] = checksToRun.map((c) => ({
    command: c.command,
    label: c.label,
    exitCode: 0,
    output: "(skipped: sync mode)",
    durationMs: 0,
    ts,
  }));

  const beat: GroundBeat = {
    id,
    task: context.task,
    checks,
    ts,
    totalDurationMs: 0,
  };

  recordGroundBeat(state, beat);
  events.make("ground_beat", { beat });
  return beat;
}
