/**
 * v4/discipline/plan-beat.ts
 *
 * Fable 5 principle 1: "Reason before the first action."
 *
 * The plan-beat is what the engine emits at the start of a (sub)goal,
 * BEFORE the first tool call. It answers:
 *   - What are we trying to achieve?          (goal)
 *   - What do we believe is true?             (hypothesis)
 *   - What are the first 1-3 steps?           (plan)
 *   - Why this approach over alternatives?    (rationale)
 *   - What could go wrong?                    (risks)
 *   - How do we know we're done?              (acceptance)
 *
 * A plan beat is OPTIONAL. The engine emits one per subgoal by default,
 * but sub-subgoals (steps) can skip it if the parent beat is still fresh.
 *
 * Two generation strategies:
 *   1. LLM-based: ask the LLM to generate the beat (higher quality, costs tokens)
 *   2. Heuristic: build the beat from the HTN plan itself (zero cost, lower quality)
 *
 * The LLM is preferred when the task is non-trivial. Heuristic fallback
 * when LLM is unavailable or the task is trivial.
 */

import { randomUUID } from "node:crypto";
import type { CognitiveEvent, EventOf } from "../stream/cognitive-event.js";
import type { PlanBeat, GoalContext } from "./types.js";
import { recordPlanBeat } from "./state.js";
import type { DisciplineState } from "./types.js";

/**
 * Generate a plan beat. Returns the beat and emits a `plan_beat` event.
 *
 * `context.goal` is the high-level goal (from the user task or parent subgoal).
 * `context.hints` are optional free-form hints (e.g., "use existing config").
 * `context.steps` are the first 1-3 steps the engine intends to take.
 *
 * If `llmNarrate` is provided, we use it to generate a richer plan beat
 * (a real LLM narrates the goal, hypothesis, and rationale). If not, we
 * build a heuristic beat from the inputs.
 */
export interface GeneratePlanBeatOptions {
  state: DisciplineState;
  context: GoalContext;
  /** LLM narrator (optional). If provided, gets called to enrich the beat. */
  llmNarrate?: (prompt: string) => Promise<string>;
  /** Event factory to emit plan_beat */
  events: import("../stream/cognitive-event.js").EventFactory;
  /** Optional id (else uuid) */
  id?: string;
  /** Subgoal that triggered this beat */
  subgoalId?: string;
  /** Step that triggered this beat */
  stepId?: string;
}

export function generatePlanBeat(opts: GeneratePlanBeatOptions): PlanBeat {
  const { state, context, events, subgoalId, stepId } = opts;
  const id = opts.id ?? randomUUID();
  const ts = Date.now();

  // Heuristic beat (always built)
  const beat: PlanBeat = {
    id,
    goal: context.goal,
    hypothesis: context.hypothesis ?? `We believe ${context.goal.toLowerCase()} is achievable with the steps below.`,
    plan: context.steps ?? [],
    rationale: context.rationale ?? "These are the first concrete steps; we'll re-evaluate after each result.",
    risks: context.risks ?? [],
    acceptance: context.acceptance ?? `Goal "${context.goal}" is met.`,
    ts,
    subgoalId,
    stepId,
  };

  // Record in state
  recordPlanBeat(state, beat);

  // Emit event (async, but EventFactory is sync)
  const event = events.make("plan_beat", { beat });
  void event;

  return beat;
}

/**
 * Generate a plan beat from an HTN subgoal. Builds the beat heuristically
 * from the subgoal's steps and description. This is the cheap path — no LLM.
 */
export interface HTNSubgoalLite {
  id: string;
  description: string;
  steps: ReadonlyArray<{ id: string; tool: string; description?: string }>;
  acceptance?: string;
  risk?: 0 | 1 | 2 | 3;
}

export function generatePlanBeatFromSubgoal(
  state: DisciplineState,
  subgoal: HTNSubgoalLite,
  events: import("../stream/cognitive-event.js").EventFactory,
): PlanBeat {
  const steps = subgoal.steps.slice(0, 3).map((s) => `${s.tool}${s.description ? `: ${s.description}` : ""}`);
  const risks: string[] = [];
  if (subgoal.risk !== undefined && subgoal.risk >= 2) {
    risks.push(`Subgoal risk is ${subgoal.risk}/3 — exercise caution.`);
  }
  if (subgoal.steps.some((s) => s.tool === "Edit" || s.tool === "Write")) {
    risks.push("Editing a file: verify the change with a real test, not just an `ls`.");
  }
  return generatePlanBeat({
    state,
    context: {
      goal: subgoal.description,
      hypothesis: `To achieve "${subgoal.description}", we follow the steps in order.`,
      steps,
      rationale: "Steps come from the HTN planner; we'll re-evaluate after each result.",
      risks,
      acceptance: subgoal.acceptance ?? `Subgoal "${subgoal.id}" completed without error.`,
    },
    events,
    subgoalId: subgoal.id,
  });
}

/**
 * Build a rich plan beat using the LLM. This is the slow path — the LLM
 * is asked to articulate the goal, hypothesis, plan, and rationale in
 * Fable-5 style.
 *
 * The prompt is structured so the LLM knows what to emit. The LLM
 * response is parsed into a PlanBeat. If parsing fails, falls back to
 * the heuristic beat.
 */
export async function generatePlanBeatWithLLM(opts: GeneratePlanBeatOptions): Promise<PlanBeat> {
  const { state, context, events, llmNarrate } = opts;
  if (!llmNarrate) {
    return generatePlanBeat(opts);
  }

  const id = opts.id ?? randomUUID();
  const ts = Date.now();

  const prompt = `You are about to begin a subgoal in a coding agent. Write a Fable-5 style plan beat.

GOAL: ${context.goal}

${context.hypothesis ? `CONTEXT HYPOTHESIS: ${context.hypothesis}\n` : ""}
${context.steps ? `KNOWN STEPS: ${context.steps.join(", ")}\n` : ""}
${context.rationale ? `RATIONALE HINT: ${context.rationale}\n` : ""}

Respond in this exact JSON shape:
{
  "goal": "the goal, restated clearly (1 sentence)",
  "hypothesis": "what you believe is true before looking (1 sentence)",
  "plan": ["step 1", "step 2", "step 3"],
  "rationale": "why this approach over alternatives (1 sentence)",
  "risks": ["risk 1", "risk 2"],
  "acceptance": "how we know we're done (1 sentence)"
}

Keep each field 1 sentence, max 20 words. Be specific. No filler.`;

  let parsed: any;
  try {
    const text = await llmNarrate(prompt);
    parsed = JSON.parse(extractJson(text));
  } catch {
    return generatePlanBeat(opts);
  }

  const beat: PlanBeat = {
    id,
    goal: typeof parsed.goal === "string" ? parsed.goal : context.goal,
    hypothesis: typeof parsed.hypothesis === "string" ? parsed.hypothesis : `We believe ${context.goal.toLowerCase()} is achievable.`,
    plan: Array.isArray(parsed.plan) ? parsed.plan.slice(0, 5).map(String) : (context.steps ?? []),
    rationale: typeof parsed.rationale === "string" ? parsed.rationale : (context.rationale ?? "Follow the plan, re-evaluate after each result."),
    risks: Array.isArray(parsed.risks) ? parsed.risks.slice(0, 5).map(String) : (context.risks ?? []),
    acceptance: typeof parsed.acceptance === "string" ? parsed.acceptance : (context.acceptance ?? `Goal "${context.goal}" is met.`),
    ts,
    subgoalId: opts.subgoalId,
    stepId: opts.stepId,
  };

  recordPlanBeat(state, beat);
  events.make("plan_beat", { beat });
  return beat;
}

/**
 * Extract a JSON object from a string. Used to pull the JSON out of an
 * LLM response that may have prose around it.
 */
function extractJson(text: string): string {
  // Try to find a JSON object
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return text.slice(start, end + 1);
  }
  return text;
}
