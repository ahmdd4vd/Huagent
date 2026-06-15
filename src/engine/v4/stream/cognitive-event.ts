/**
 * v4/stream/cognitive-event.ts
 *
 * The wire type of HuaEngine v4.0. Every component reads and writes
 * CognitiveEvent. Bi-temporal, discriminated union, JSON-serializable.
 *
 * Why a union type, not a class hierarchy:
 * - Discriminated union narrows in switch/case exhaustively (TypeScript's
 *   `never` check catches missing handlers at compile time).
 * - Plain objects are cheap to clone, send across actor boundaries, persist
 *   to the replay log, and serialize for IPC / websocket.
 */

export type Intent =
  | "code_write"     // create new file(s)
  | "code_fix"       // edit existing file(s)
  | "code_refactor"  // restructure without behavior change
  | "code_review"    // read-only analysis
  | "code_test"      // write or run tests
  | "question"       // pure Q&A, no code change
  | "command";       // shell command, no LLM code edit

export type Complexity = "trivial" | "simple" | "moderate" | "complex" | "epic";

export type LogLevel = "debug" | "info" | "warn" | "error";

export type CriticPersona = "correctness" | "style" | "intent" | "arbiter";

/**
 * A causal edge: how one node influenced another.
 * Distinct from "user_id did this" — the graph stores *why* and *how*.
 */
export type CausalEdgeKind =
  | "edited"
  | "caused"        // node A caused node B (e.g., edit caused error)
  | "fixedBy"       // node A was fixed by node B
  | "derived"       // insight derived from episode
  | "dependsOn"     // step depends on another step
  | "related";      // soft relationship

/**
 * CognitiveEvent — discriminated union of every event the engine emits.
 *
 * Conventions:
 * - Every event carries `ts` (ms since epoch) and `seq` (monotonic counter)
 *   for time-travel queries and replay log.
 * - `kind` is the discriminator; TypeScript narrows on it.
 * - Optional `meta` for debug, observability, correlation IDs.
 *
 * Adding a new event kind:
 *   1. Add the variant here.
 *   2. Add a handler in every `switch (e.kind)` (TS will flag the miss).
 *   3. Document it in the public API.
 */
export type CognitiveEvent =
  // ─── Lifecycle ────────────────────────────────────────────────
  | { kind: "session_start"; sessionId: string; ts: number; seq: number; meta?: Record<string, unknown> }
  | { kind: "session_end"; sessionId: string; ts: number; seq: number; ok: boolean; durationMs: number; meta?: Record<string, unknown> }

  // ─── Classification ────────────────────────────────────────────
  | { kind: "classified"; task: string; intent: Intent; complexity: Complexity; confidence: number; ts: number; seq: number; shortcuts?: string[]; meta?: Record<string, unknown> }

  // ─── HTN ───────────────────────────────────────────────────────
  | { kind: "htn_plan"; planId: string; subgoals: number; steps: number; parallelGroups: number; ts: number; seq: number; meta?: Record<string, unknown> }
  | { kind: "subgoal_started"; subgoalId: string; description: string; ts: number; seq: number; meta?: Record<string, unknown> }
  | { kind: "subgoal_completed"; subgoalId: string; ok: boolean; durationMs: number; ts: number; seq: number; error?: string; meta?: Record<string, unknown> }
  | { kind: "step_started"; stepId: string; tool: string; ts: number; seq: number; meta?: Record<string, unknown> }
  | { kind: "step_completed"; stepId: string; ok: boolean; durationMs: number; ts: number; seq: number; error?: string; meta?: Record<string, unknown> }

  // ─── Speculative execution ─────────────────────────────────────
  | { kind: "speculation_started"; raceId: string; strategies: string[]; budgetMs: number; ts: number; seq: number; meta?: Record<string, unknown> }
  | { kind: "strategy_progress"; raceId: string; strategyId: string; progress: number; ts: number; seq: number; meta?: Record<string, unknown> }
  | { kind: "strategy_succeeded"; raceId: string; strategyId: string; quality: number; durationMs: number; ts: number; seq: number; meta?: Record<string, unknown> }
  | { kind: "strategy_failed"; raceId: string; strategyId: string; reason: string; durationMs: number; ts: number; seq: number; meta?: Record<string, unknown> }
  | { kind: "strategy_cancelled"; raceId: string; strategyId: string; reason: string; ts: number; seq: number; meta?: Record<string, unknown> }
  | { kind: "speculation_winner"; raceId: string; strategyId: string; quality: number; durationMs: number; ts: number; seq: number; meta?: Record<string, unknown> }

  // ─── Tool execution ────────────────────────────────────────────
  | { kind: "tool_call"; tool: string; args: unknown; ts: number; seq: number; stepId?: string; meta?: Record<string, unknown> }
  | { kind: "tool_result"; tool: string; result: unknown; ts: number; seq: number; stepId?: string; durationMs: number; meta?: Record<string, unknown> }
  | { kind: "tool_error"; tool: string; error: string; ts: number; seq: number; stepId?: string; durationMs: number; meta?: Record<string, unknown> }

  // ─── Critic mesh ───────────────────────────────────────────────
  | { kind: "critic_verdict"; critic: CriticPersona; score: number; confidence: number; rationale: string; ts: number; seq: number; meta?: Record<string, unknown> }
  | { kind: "mesh_verdict"; raceId?: string; stepId?: string; score: number; confidence: number; verdict: "pass" | "flag" | "fail"; critics: { persona: CriticPersona; score: number; confidence: number }[]; arbiterTriggered: boolean; ts: number; seq: number; meta?: Record<string, unknown> }

  // ─── Reflection ────────────────────────────────────────────────
  | { kind: "episode_recorded"; episodeId: string; task: string; ok: boolean; durationMs: number; ts: number; seq: number; meta?: Record<string, unknown> }
  | { kind: "insight_extracted"; insightId: string; insightKind: "recipe" | "anti"; text: string; confidence: number; ts: number; seq: number; meta?: Record<string, unknown> }

  // ─── Memory graph ──────────────────────────────────────────────
  | { kind: "graph_node_added"; nodeId: string; nodeKind: string; label: string; ts: number; seq: number; meta?: Record<string, unknown> }
  | { kind: "graph_edge_added"; from: string; to: string; edgeKind: CausalEdgeKind; ts: number; seq: number; meta?: Record<string, unknown> }

  // ─── Capability pipeline ───────────────────────────────────────
  | { kind: "capability_pipeline"; pipelineId: string; steps: string[]; ts: number; seq: number; meta?: Record<string, unknown> }
  | { kind: "capability_optimized"; pipelineId: string; originalSteps: number; optimizedSteps: number; ts: number; seq: number; meta?: Record<string, unknown> }

  // ─── Actors / supervision ──────────────────────────────────────
  | { kind: "actor_started"; actorId: string; actorKind: string; ts: number; seq: number; meta?: Record<string, unknown> }
  | { kind: "actor_crashed"; actorId: string; actorKind: string; reason: string; ts: number; seq: number; meta?: Record<string, unknown> }
  | { kind: "actor_restarted"; actorId: string; actorKind: string; attempt: number; strategy: "one_for_one" | "one_for_all" | "rest_for_one"; ts: number; seq: number; meta?: Record<string, unknown> }
  | { kind: "actor_stopped"; actorId: string; reason: string; ts: number; seq: number; meta?: Record<string, unknown> }

  // ─── User-visible ──────────────────────────────────────────────
  | { kind: "token_delta"; text: string; ts: number; seq: number; meta?: Record<string, unknown> }
  | { kind: "log"; level: LogLevel; msg: string; ts: number; seq: number; meta?: Record<string, unknown> }

  // ─── Discipline layer (Fable-5 mindset) ────────────────────────
  | { kind: "plan_beat"; beat: import("../discipline/types.js").PlanBeat; ts: number; seq: number; meta?: Record<string, unknown> }
  | { kind: "observe_beat"; beat: import("../discipline/types.js").ObserveBeat; ts: number; seq: number; meta?: Record<string, unknown> }
  | { kind: "ground_beat"; beat: import("../discipline/types.js").GroundBeat; ts: number; seq: number; meta?: Record<string, unknown> }
  | { kind: "verify_started"; filePath: string; command: string; ts: number; seq: number; meta?: Record<string, unknown> }
  | { kind: "verify_completed"; result: import("../discipline/types.js").VerifyResult; ts: number; seq: number; meta?: Record<string, unknown> }
  | { kind: "verify_failed"; result: import("../discipline/types.js").VerifyResult; ts: number; seq: number; meta?: Record<string, unknown> }
  | { kind: "stale_edit_blocked"; filePath: string; lastReadAt: number; ageMs: number; ts: number; seq: number; meta?: Record<string, unknown> }
  | { kind: "diagnose_started"; tool: string; error: string; ts: number; seq: number; meta?: Record<string, unknown> }
  | { kind: "diagnose_completed"; diagnosis: import("../discipline/types.js").Diagnosis; ts: number; seq: number; meta?: Record<string, unknown> }
;

/**
 * Type-safe helper: extract a variant by `kind`.
 */
export type EventOf<K extends CognitiveEvent["kind"]> = Extract<CognitiveEvent, { kind: K }>;

/**
 * Cheap event factory: stamps ts and seq.
 * Use this instead of constructing events inline.
 *
 * Optionally subscribes to emitted events via `onEmit` callback, so a
 * race / critic can stream events to the engine's output without
 * holding a reference to the engine itself.
 */
export class EventFactory {
  private seq = 0;
  private readonly t0: number;
  /**
   * Optional callback invoked for every event created by `make()`.
   * Used by race / critic mesh to push events to the engine's output
   * stream without a circular reference.
   */
  public onEmit?: (e: CognitiveEvent) => void;

  constructor(t0: number = Date.now()) {
    this.t0 = t0;
  }

  now(): number {
    return Date.now() - this.t0;
  }

  next(): number {
    return ++this.seq;
  }

  make<K extends CognitiveEvent["kind"]>(
    kind: K,
    payload: Omit<EventOf<K>, "kind" | "ts" | "seq">
  ): EventOf<K> {
    const ev = { kind, ts: this.now(), seq: this.next(), ...payload } as EventOf<K>;
    if (this.onEmit) this.onEmit(ev);
    return ev;
  }

  reset(): void {
    this.seq = 0;
  }
}

/**
 * Stable string for an event — used for log deduplication and replay.
 */
export function eventKey(e: CognitiveEvent): string {
  return `${e.seq}:${e.kind}`;
}

/**
 * Compact one-line summary for logging.
 */
export function summarize(e: CognitiveEvent): string {
  switch (e.kind) {
    case "session_start": return `▶ session ${e.sessionId}`;
    case "session_end":   return `■ session ${e.sessionId} (${e.ok ? "ok" : "fail"} ${e.durationMs}ms)`;
    case "classified":    return `◇ classified: ${e.intent}/${e.complexity} conf=${e.confidence.toFixed(2)}`;
    case "htn_plan":      return `◇ htn: ${e.subgoals} subgoals, ${e.steps} steps, ${e.parallelGroups} parallel groups`;
    case "subgoal_started":   return `→ subgoal: ${e.subgoalId} — ${e.description}`;
    case "subgoal_completed": return `← subgoal: ${e.subgoalId} ${e.ok ? "✓" : "✗"} (${e.durationMs}ms)`;
    case "step_started":   return `→ step: ${e.stepId} (${e.tool})`;
    case "step_completed": return `← step: ${e.stepId} ${e.ok ? "✓" : "✗"} (${e.durationMs}ms)`;
    case "speculation_started":   return `⚡ speculate: ${e.strategies.length} strategies, ${e.budgetMs}ms budget`;
    case "strategy_progress":     return `  ⌛ ${e.strategyId} ${(e.progress * 100).toFixed(0)}%`;
    case "strategy_succeeded":    return `  ✓ ${e.strategyId} quality=${e.quality.toFixed(2)} (${e.durationMs}ms)`;
    case "strategy_failed":       return `  ✗ ${e.strategyId} ${e.reason}`;
    case "strategy_cancelled":    return `  ⊘ ${e.strategyId} cancelled: ${e.reason}`;
    case "speculation_winner":    return `⚡ winner: ${e.strategyId} (${e.durationMs}ms, q=${e.quality.toFixed(2)})`;
    case "tool_call":    return `🔧 ${e.tool}(${JSON.stringify(e.args).slice(0, 80)})`;
    case "tool_result":  return `✓ ${e.tool} → ${JSON.stringify(e.result).slice(0, 80)} (${e.durationMs}ms)`;
    case "tool_error":   return `✗ ${e.tool} → ${e.error} (${e.durationMs}ms)`;
    case "critic_verdict": return `◇ ${e.critic}: ${e.score.toFixed(2)} conf=${e.confidence.toFixed(2)} — ${e.rationale.slice(0, 80)}`;
    case "mesh_verdict":   return `◇ mesh: ${e.verdict} score=${e.score.toFixed(2)} conf=${e.confidence.toFixed(2)} (${e.critics.length} critics, arbiter=${e.arbiterTriggered})`;
    case "episode_recorded":  return `📝 episode ${e.episodeId} ${e.ok ? "ok" : "fail"} (${e.durationMs}ms)`;
    case "insight_extracted": return `💡 ${e.insightKind === "recipe" ? "recipe" : "anti"}: ${e.text.slice(0, 80)} (conf=${e.confidence.toFixed(2)})`;
    case "graph_node_added":  return `⊕ node ${e.nodeKind}: ${e.label}`;
    case "graph_edge_added":  return `⊕ edge ${e.edgeKind}: ${e.from} → ${e.to}`;
    case "capability_pipeline":  return `⊜ pipeline: ${e.steps.join(" | ")}`;
    case "capability_optimized": return `⊜ optimized: ${e.originalSteps} → ${e.optimizedSteps} steps`;
    case "actor_started":   return `▲ actor ${e.actorId} (${e.actorKind})`;
    case "actor_crashed":   return `▼ actor ${e.actorId} (${e.actorKind}): ${e.reason}`;
    case "actor_restarted": return `↻ actor ${e.actorId} attempt #${e.attempt} (${e.strategy})`;
    case "actor_stopped":   return `■ actor ${e.actorId}: ${e.reason}`;
    case "token_delta":     return `💬 ${e.text}`;
    case "log":             return `[${e.level}] ${e.msg}`;
    case "plan_beat":       return `🧠 PLAN: ${e.beat.goal.slice(0, 60)} | hypothesis: ${e.beat.hypothesis.slice(0, 60)}`;
    case "observe_beat":    return `👀 OBSERVE: ${e.beat.tool} → ${e.beat.summary.slice(0, 60)} [${e.beat.decision}]`;
    case "ground_beat":     return `🌍 GROUND: ${e.beat.checks.length} checks (${e.beat.totalDurationMs}ms)`;
    case "verify_started":  return `✅ VERIFY: ${e.filePath} → ${e.command.slice(0, 60)}`;
    case "verify_completed":return `✓ VERIFY: ${e.result.filePath} exit=${e.result.exitCode} ${e.result.passed ? "PASS" : "FAIL"}`;
    case "verify_failed":   return `✗ VERIFY: ${e.result.filePath} exit=${e.result.exitCode} — ${e.result.reason ?? "see output"}`;
    case "stale_edit_blocked": return `⛔ STALE EDIT BLOCKED: ${e.filePath} (last read ${Math.round(e.ageMs/1000)}s ago)`;
    case "diagnose_started":  return `🔍 DIAGNOSE: ${e.tool} → ${e.error.slice(0, 60)}`;
    case "diagnose_completed": return `🩺 DIAGNOSIS: ${e.diagnosis.category} — ${e.diagnosis.recommendedAction.slice(0, 60)}`;
  }
}
