/**
 * v4/discipline/observe-beat.ts
 *
 * Fable 5 principle 2: "Re-evaluate after every result."
 *
 * The observe-beat is what the engine emits AFTER a tool returns, BEFORE
 * the next action is decided. It answers:
 *   - What just came back?          (summary)
 *   - Did it match our hypothesis?  (matchesHypothesis)
 *   - What did we learn?            (newInfo)
 *   - Should we keep, change, or abort the plan?  (decision)
 *   - If change: what to change?    (adjustments)
 *
 * Real Fable 5 CoT samples (from the dataset):
 *   "Alright, I've just pulled the repository layout and file sizes with
 *    the wc -l command. I now have a quick sense of where the key
 *    documentation lives: journal.md (516 lines) seems to be the main
 *    log of past experiments, scores.md (18 lines) likely contains the
 *    latest benchmark results... Therefore next step is..."
 *
 * The observe-beat is the structured form of that reasoning.
 *
 * Generation strategies:
 *   1. Heuristic (default): inspect the result type, summarize by length,
 *      classify match/no-match by simple heuristics.
 *   2. LLM-based (richer): ask the LLM to summarize and decide.
 */

import { randomUUID } from "node:crypto";
import type { PlanBeat, ObserveBeat, DisciplineState } from "./types.js";
import { recordObserveBeat } from "./state.js";
import { EventFactory } from "../stream/cognitive-event.js";

/**
 * Heuristic summary of a tool result. Used when no LLM is available.
 * Returns a 1-sentence summary that's good enough for the observe beat.
 */
export function summarizeResult(tool: string, result: unknown): string {
  if (result === null || result === undefined) {
    return `${tool} returned no result.`;
  }
  if (typeof result === "string") {
    return `${tool} returned ${result.length} chars of text.`;
  }
  if (typeof result === "number" || typeof result === "boolean") {
    return `${tool} returned ${JSON.stringify(result)}.`;
  }
  if (Array.isArray(result)) {
    if (result.length === 0) return `${tool} returned an empty array.`;
    return `${tool} returned ${result.length} item${result.length === 1 ? "" : "s"}.`;
  }
  if (typeof result === "object") {
    const obj = result as Record<string, unknown>;
    const keys = Object.keys(obj);
    if (keys.length === 0) return `${tool} returned an empty object.`;
    // Special case for tool results with stdout/stderr/exitCode
    if ("stdout" in obj || "stderr" in obj || "exitCode" in obj) {
      const exit = "exitCode" in obj ? `exit=${(obj as any).exitCode}` : "";
      const out = "stdout" in obj ? `${String((obj as any).stdout).length} chars stdout` : "";
      const err = "stderr" in obj ? `${String((obj as any).stderr).length} chars stderr` : "";
      return `${tool} returned ${[exit, out, err].filter(Boolean).join(", ")}.`;
    }
    return `${tool} returned object with keys: ${keys.slice(0, 5).join(", ")}${keys.length > 5 ? ", ..." : ""}.`;
  }
  return `${tool} returned ${typeof result}.`;
}

/**
 * Heuristic match check. Compares the result against the plan beat's
 * hypothesis. A positive match: result is non-empty, non-null, non-error.
 */
export function matchesHypothesis(tool: string, result: unknown): boolean {
  if (result === null || result === undefined) return false;
  if (typeof result === "object" && result !== null) {
    const r = result as Record<string, unknown>;
    if (r.exitCode !== undefined && r.exitCode !== 0) return false;
    if (r.isError === true) return false;
  }
  if (typeof result === "string" && result.trim() === "") return false;
  if (Array.isArray(result) && result.length === 0) return false;
  // Tools that find content match hypothesis; tools that find nothing don't
  if (tool === "Read" || tool === "read_file") {
    if (typeof result === "string" && result.includes("ENOENT")) return false;
    if (typeof result === "string" && result.toLowerCase().includes("not found")) return false;
  }
  return true;
}

/**
 * Generate an observe beat. Returns the beat and emits an `observe_beat` event.
 *
 * `context.planBeat` is the plan beat this observation re-evaluates (if any).
 * If no plan beat is provided, the beat is still emitted but with no
 * hypothesis to compare against.
 */
export interface GenerateObserveBeatOptions {
  state: DisciplineState;
  tool: string;
  result: unknown;
  /** The plan beat this observation re-evaluates (if any) */
  planBeat?: PlanBeat;
  /** Subgoal this belongs to */
  subgoalId?: string;
  /** Step this belongs to */
  stepId?: string;
  /** LLM narrator (optional) */
  llmNarrate?: (prompt: string) => Promise<string>;
  /** Event factory */
  events: EventFactory;
  /** Override the summary (else heuristic) */
  summary?: string;
  /** Override the matchesHypothesis (else heuristic) */
  matches?: boolean;
  /** Override the newInfo (else empty) */
  newInfo?: string[];
  /** Override the decision (else heuristic) */
  decision?: ObserveBeat["decision"];
  /** Override the adjustments (else empty) */
  adjustments?: string[];
}

export function generateObserveBeat(opts: GenerateObserveBeatOptions): ObserveBeat {
  const { state, tool, result, planBeat, subgoalId, stepId, events } = opts;

  const id = randomUUID();
  const ts = Date.now();

  // Heuristic
  const summary = opts.summary ?? summarizeResult(tool, result);
  const matches = opts.matches ?? (planBeat ? matchesHypothesis(tool, result) : true);
  const newInfo = opts.newInfo ?? [];
  let decision: ObserveBeat["decision"] = opts.decision ?? "continue";
  let adjustments = opts.adjustments ?? [];

  if (decision === "continue" && !matches && !opts.decision) {
    // Heuristic decision: if no match and no override, suggest adjust
    if (planBeat) {
      decision = "adjust";
      if (adjustments.length === 0) {
        adjustments = [`Re-evaluate plan based on ${tool} output; result did not match hypothesis.`];
      }
    }
  }

  const beat: ObserveBeat = {
    id,
    tool,
    summary,
    matchesHypothesis: matches,
    newInfo,
    decision,
    adjustments: adjustments.length > 0 ? adjustments : undefined,
    ts,
    planBeatId: planBeat?.id,
    subgoalId,
    stepId,
  };

  recordObserveBeat(state, beat);
  events.make("observe_beat", { beat });

  return beat;
}

/**
 * Generate a rich observe beat using the LLM. Slower but higher quality.
 * Falls back to heuristic on LLM error.
 */
export async function generateObserveBeatWithLLM(opts: GenerateObserveBeatOptions): Promise<ObserveBeat> {
  if (!opts.llmNarrate) {
    return generateObserveBeat(opts);
  }

  const summary = summarizeResult(opts.tool, opts.result);
  const prompt = `A tool just returned. Summarize what came back and decide what to do next, Fable-5 style.

TOOL: ${opts.tool}
SUMMARY: ${summary}
${opts.planBeat ? `HYPOTHESIS (from the plan beat): ${opts.planBeat.hypothesis}` : ""}
${opts.planBeat ? `GOAL: ${opts.planBeat.goal}` : ""}
${opts.planBeat ? `ORIGINAL PLAN: ${opts.planBeat.plan.join(", ")}` : ""}

RESULT (truncated): ${truncate(JSON.stringify(opts.result), 800)}

Respond in this exact JSON shape:
{
  "summary": "1 sentence: what came back",
  "matchesHypothesis": true | false,
  "newInfo": ["fact 1", "fact 2"],
  "decision": "continue" | "adjust" | "abort",
  "adjustments": ["what to change, if any"]
}

Keep each field short. No filler. If the result is a tool error, decision should be "abort" or "adjust".`;

  try {
    const text = await opts.llmNarrate(prompt);
    const parsed = JSON.parse(extractJson(text));
    return generateObserveBeat({
      ...opts,
      summary: typeof parsed.summary === "string" ? parsed.summary : summary,
      matches: typeof parsed.matchesHypothesis === "boolean" ? parsed.matchesHypothesis : undefined,
      newInfo: Array.isArray(parsed.newInfo) ? parsed.newInfo.slice(0, 5).map(String) : [],
      decision: ["continue", "adjust", "abort"].includes(parsed.decision) ? parsed.decision : undefined,
      adjustments: Array.isArray(parsed.adjustments) ? parsed.adjustments.slice(0, 5).map(String) : [],
    });
  } catch {
    return generateObserveBeat(opts);
  }
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max) + "…";
}

function extractJson(text: string): string {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) return text.slice(start, end + 1);
  return text;
}
