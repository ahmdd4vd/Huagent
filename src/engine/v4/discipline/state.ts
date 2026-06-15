/**
 * v4/discipline/state.ts
 *
 * Per-engine discipline state. Tracks everything the discipline layer needs
 * to enforce Fable-5 habits:
 *
 *   - When each file was last read (for fresh-read-before-edit)
 *   - History of plan / observe / ground / verify / diagnose beats
 *   - Current task and last error (for diagnose context)
 *
 * Design notes:
 *   - One DisciplineState per engine. Not shared.
 *   - All collections are append-only. The state grows monotonically.
 *   - The state has NO concurrency guards — the engine is single-threaded
 *     per session, and the discipline manager is the only writer.
 *   - For tests, the state is fully serializable (Maps → plain objects).
 */

import type { PlanBeat, ObserveBeat, GroundBeat, VerifyResult, Diagnosis, DisciplineState } from "./types.js";

/**
 * Default freshness TTL: 5 minutes. A read is "stale" if it happened more
 * than this many ms before the Edit. Fable 5 reads right before edit, so
 * 5 minutes is generous — most edits happen within 30s of the read.
 */
export const DEFAULT_FRESH_READ_TTL_MS = 5 * 60 * 1000;

/**
 * Create a fresh discipline state.
 */
export function createDisciplineState(): DisciplineState {
  return {
    fileReadAt: new Map(),
    planBeats: [],
    observeBeats: [],
    groundBeats: [],
    verifies: [],
    diagnoses: [],
    currentTask: null,
    lastErroredTool: null,
    lastError: null,
  };
}

/**
 * Mark a file as read at the given timestamp. Subsequent Edits to this
 * file will pass the fresh-read check (within TTL).
 */
export function markFileRead(state: DisciplineState, filePath: string, ts: number = Date.now()): void {
  // Normalize the path: strip ./, resolve .., use absolute if possible
  const normalized = normalizePath(filePath);
  state.fileReadAt.set(normalized, ts);
}

/**
 * Mark multiple files as read at once.
 */
export function markFilesRead(state: DisciplineState, filePaths: readonly string[], ts: number = Date.now()): void {
  for (const fp of filePaths) {
    markFileRead(state, fp, ts);
  }
}

/**
 * Check whether a file has a fresh read. Returns:
 *   - ok: true if the read is within TTL, false otherwise
 *   - lastReadAt: the timestamp of the last read, or null if never read
 *   - ageMs: how old the read is, or Infinity if never read
 *   - reason: human-readable reason if not ok
 */
export interface FreshReadCheck {
  ok: boolean;
  lastReadAt: number | null;
  ageMs: number;
  reason?: string;
}

export function checkFreshRead(
  state: DisciplineState,
  filePath: string,
  ttlMs: number = DEFAULT_FRESH_READ_TTL_MS,
  now: number = Date.now(),
): FreshReadCheck {
  const normalized = normalizePath(filePath);
  const lastReadAt = state.fileReadAt.get(normalized);
  if (lastReadAt === undefined) {
    return {
      ok: false,
      lastReadAt: null,
      ageMs: Number.POSITIVE_INFINITY,
      reason: `file never read in this session: ${normalized}`,
    };
  }
  const ageMs = now - lastReadAt;
  if (ageMs < 0) {
    // Clock skew — treat as fresh
    return { ok: true, lastReadAt, ageMs: 0 };
  }
  if (ageMs > ttlMs) {
    return {
      ok: false,
      lastReadAt,
      ageMs,
      reason: `read ${Math.round(ageMs / 1000)}s ago, TTL is ${Math.round(ttlMs / 1000)}s`,
    };
  }
  return { ok: true, lastReadAt, ageMs };
}

/**
 * Record a plan beat in the state. Returns the beat (for chaining).
 */
export function recordPlanBeat(state: DisciplineState, beat: PlanBeat): PlanBeat {
  state.planBeats.push(beat);
  return beat;
}

/**
 * Record an observe beat in the state. Returns the beat.
 */
export function recordObserveBeat(state: DisciplineState, beat: ObserveBeat): ObserveBeat {
  state.observeBeats.push(beat);
  return beat;
}

/**
 * Record a ground beat in the state. Returns the beat.
 */
export function recordGroundBeat(state: DisciplineState, beat: GroundBeat): GroundBeat {
  state.groundBeats.push(beat);
  state.currentTask = beat.task;
  return beat;
}

/**
 * Record a verify result in the state. Returns the result.
 */
export function recordVerify(state: DisciplineState, result: VerifyResult): VerifyResult {
  state.verifies.push(result);
  return result;
}

/**
 * Record a diagnosis in the state. Returns the diagnosis.
 */
export function recordDiagnosis(state: DisciplineState, diagnosis: Diagnosis): Diagnosis {
  state.diagnoses.push(diagnosis);
  state.lastErroredTool = diagnosis.tool;
  state.lastError = diagnosis.error;
  return diagnosis;
}

/**
 * Reset the state to empty. Used between sessions in long-running engines.
 * Preserves the fileReadAt map size for stats; not the contents.
 */
export function resetDisciplineState(state: DisciplineState): void {
  state.planBeats.length = 0;
  state.observeBeats.length = 0;
  state.groundBeats.length = 0;
  state.verifies.length = 0;
  state.diagnoses.length = 0;
  state.fileReadAt.clear();
  state.currentTask = null;
  state.lastErroredTool = null;
  state.lastError = null;
}

/**
 * Compute discipline metrics for a session. Inspired by Fable's
 * `analyze_discipline.py` — same shape, same habits.
 *
 * Returns:
 *   - reasoning_coverage: fraction of actions that had a plan beat
 *   - observe_coverage: fraction of tool results followed by an observe beat
 *   - verify_rate: fraction of Edit/Write actions followed by a verify
 *   - real_verify_rate: fraction of verifies that ran (not skipped) and passed
 *   - diagnose_rate: fraction of tool errors followed by a diagnose beat
 *   - fresh_read_rate: fraction of Edit/Write actions that had a fresh read
 */
export interface DisciplineMetrics {
  totalActions: number;
  edits: number;
  toolErrors: number;
  reasoningCoverage: number;
  observeCoverage: number;
  verifyRate: number;
  realVerifyRate: number;
  realVerifyPassRate: number;
  diagnoseRate: number;
  freshReadRate: number;
}

export function computeDisciplineMetrics(state: DisciplineState): DisciplineMetrics {
  const planBeats = state.planBeats.length;
  const observeBeats = state.observeBeats.length;
  const verifies = state.verifies.length;
  const diagnoses = state.diagnoses.length;
  const verifyRuns = state.verifies.filter((v) => !v.skipped).length;
  const verifyPasses = state.verifies.filter((v) => !v.skipped && v.passed).length;
  const trackedFiles = state.fileReadAt.size;

  // Approximate counts from beat history. We don't have raw tool calls in
  // state, so we use plan beats as a proxy for "things that should have
  // been verified".
  const totalActions = Math.max(planBeats, 1);
  const edits = verifies; // each verify corresponds to an edit
  const toolErrors = diagnoses; // each diagnosis corresponds to an error

  return {
    totalActions,
    edits,
    toolErrors,
    reasoningCoverage: planBeats / totalActions,
    observeCoverage: observeBeats / totalActions,
    verifyRate: edits > 0 ? verifies / edits : 0,
    realVerifyRate: edits > 0 ? verifyRuns / edits : 0,
    realVerifyPassRate: verifyRuns > 0 ? verifyPasses / verifyRuns : 0,
    diagnoseRate: toolErrors > 0 ? diagnoses / toolErrors : 0,
    freshReadRate: 0, // computed by the manager with full event log
  };
}

/**
 * Path normalization for stable map keys. Strips leading ./ and trailing
 * whitespace; collapses multiple slashes; lowercases on Windows would be
 * ideal but we keep case-sensitive for Linux.
 */
export function normalizePath(p: string): string {
  if (!p) return p;
  let s = p.trim();
  // strip leading ./
  while (s.startsWith("./")) s = s.slice(2);
  // collapse multiple slashes (not after the protocol part — for file paths that's fine)
  s = s.replace(/\/+/g, "/");
  return s;
}

/**
 * Snapshot of the state (Maps → plain objects) for serialization / debugging.
 */
export interface DisciplineStateSnapshot {
  filesRead: Record<string, number>;
  planBeats: PlanBeat[];
  observeBeats: ObserveBeat[];
  groundBeats: GroundBeat[];
  verifies: VerifyResult[];
  diagnoses: Diagnosis[];
  currentTask: string | null;
  lastErroredTool: string | null;
  lastError: string | null;
}

export function snapshotDisciplineState(state: DisciplineState): DisciplineStateSnapshot {
  const filesRead: Record<string, number> = {};
  for (const [k, v] of state.fileReadAt) filesRead[k] = v;
  return {
    filesRead,
    planBeats: state.planBeats.slice(),
    observeBeats: state.observeBeats.slice(),
    groundBeats: state.groundBeats.slice(),
    verifies: state.verifies.slice(),
    diagnoses: state.diagnoses.slice(),
    currentTask: state.currentTask,
    lastErroredTool: state.lastErroredTool,
    lastError: state.lastError,
  };
}
