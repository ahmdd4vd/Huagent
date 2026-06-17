/**
 * v4/discipline/diagnose-beat.ts
 *
 * Fable 5 principle 6: "Diagnose, then fix. Never retry blind."
 *
 * When a tool call errors, the diagnose-beat is what runs BEFORE the
 * engine retries (or gives up). It answers:
 *   - What category is this error?           (transient / logic / config / env / test / syntax / unknown)
 *   - What evidence do we have?              (stderr lines, file contents)
 *   - What could be wrong?                   (1-3 hypotheses)
 *   - What's the recommended next action?    (free-form)
 *   - Is it safe to retry with same args?    (isRetryable)
 *
 * Real Fable 5 samples (from the dataset):
 *   "The command failed to find a lowercase-named file, but the directory
 *    listing returned shows a file named AGENTS.md (uppercase). That tells
 *    me the file does exist, just with a different case."
 *   → category: logic
 *   → hypothesis: "the filename is case-sensitive different"
 *   → recommendedAction: "use Read with the uppercase name"
 *   → isRetryable: true (with corrected args)
 *
 * The diagnose-beat NEVER auto-retries. It only produces a Diagnosis
 * object that the engine (or human) reads and acts on.
 */

import { randomUUID } from "node:crypto";
import type { Diagnosis, ErrorCategory, DisciplineState } from "./types.js";
import { recordDiagnosis } from "./state.js";
import { EventFactory } from "../stream/cognitive-event.js";

/**
 * Pattern-based error classifier. Maps a stderr/stdout string to an
 * ErrorCategory. Each pattern is a regex tested in order; first match wins.
 */
const CATEGORY_PATTERNS: Array<{ category: ErrorCategory; pattern: RegExp }> = [
  // transient
  { category: "transient", pattern: /ETIMEDOUT|ECONNRESET|ENOTFOUND|timeout exceeded|connection (refused|reset)/i },
  { category: "transient", pattern: /temporar(?:y|ily) unavailable|service unavailable|try again/i },
  { category: "transient", pattern: /rate limit|too many requests|429\b/i },
  // syntax
  { category: "syntax", pattern: /SyntaxError|Unexpected token|Unexpected end of input|Parse error/i },
  { category: "syntax", pattern: /\bTS\d{4}\b|cannot find name|Type .* is not assignable|has no exported member/i },
  // test
  { category: "test", pattern: /AssertionError|assertion failed|expected .* to (?:be|equal)|test(s)? failed/i },
  { category: "test", pattern: /\bFAIL(?:ED)?\b.*test|\d+ (?:tests?|specs?) failed|pytest.*FAILED/i },
  // config
  { category: "config", pattern: /MODULE_NOT_FOUND|Cannot find module|require\(.*\) from|ImportError|No module named/i },
  { category: "config", pattern: /Permission denied|EACCES|operation not permitted/i },
  { category: "config", pattern: /command not found|is not recognized as an internal or external command/i },
  { category: "config", pattern: /environment variable|process\.env\.[A-Z_]+|undefined env/i },
  // environment
  { category: "environment", pattern: /ENOSPC|disk quota exceeded|no space left/i },
  { category: "environment", pattern: /out of memory|ENOMEM|killed \(out of memory\)|OOM/i },
  { category: "environment", pattern: /ENFILE|EMFILE|too many open files/i },
  // logic
  { category: "logic", pattern: /ENOENT|no such file|cannot find the (?:file|path)|file does not exist/i },
  { category: "logic", pattern: /EEXIST|file already exists|already exists/i },
  { category: "logic", pattern: /EISDIR|is a directory|illegal operation on a directory/i },
  { category: "logic", pattern: /invalid argument|argument .* is (?:invalid|not a)/i },
  { category: "logic", pattern: /not a function|undefined is not|cannot read propert/i },
  { category: "logic", pattern: /JSON\.parse|Unexpected end of JSON|invalid JSON/i },
];

/**
 * Classify an error message into a category.
 */
export function classifyError(error: string): ErrorCategory {
  for (const { category, pattern } of CATEGORY_PATTERNS) {
    if (pattern.test(error)) return category;
  }
  return "unknown";
}

/**
 * Hypotheses for each category. The diagnose-beat uses these as
 * starting points; the LLM (if available) refines them.
 */
export const CATEGORY_HYPOTHESES: Record<ErrorCategory, string[]> = {
  transient: [
    "The failure was temporary (network, rate limit, server hiccup).",
    "A retry with the same arguments is likely to succeed shortly.",
  ],
  logic: [
    "The arguments or path were wrong.",
    "The file or resource doesn't exist in the expected location.",
    "The order of operations is wrong — earlier step is missing.",
  ],
  config: [
    "A required dependency, module, or environment variable is missing.",
    "Permissions are insufficient, or the binary is not in PATH.",
  ],
  environment: [
    "The host is out of resources (disk, memory, file descriptors).",
    "The kernel or runtime refused the operation.",
  ],
  test: [
    "The code under test does not match the test's expectations.",
    "An earlier change broke the test; the fix is in the code, not the test.",
  ],
  syntax: [
    "The source file has a parse error or type error.",
    "An import or export is missing or misspelled.",
  ],
  unknown: [
    "The error is unclassified. Inspect the full error output for clues.",
    "Re-read the relevant file or state before retrying.",
  ],
};

/**
 * Recommended action per category. Concrete, actionable, retry-aware.
 */
export const CATEGORY_ACTIONS: Record<ErrorCategory, string> = {
  transient: "Retry with the same arguments after a short backoff (1-2s). No code change needed.",
  logic: "Inspect the error, read the relevant file or state, form a CORRECTED action. Do NOT retry unchanged.",
  config: "Check the missing dependency, env var, or permission. Install the dep, set the env, or fix the path.",
  environment: "Resource exhausted. Free disk/memory, or escalate to the user.",
  test: "Read the failing test, identify the expectation, fix the code (or the test if expectation is wrong).",
  syntax: "Read the file with the error, fix the syntax or type error, re-verify.",
  unknown: "Re-read the error carefully. Inspect the file or state. Form a hypothesis before retrying.",
};

/**
 * Is retry-with-same-args safe for this category?
 */
export const CATEGORY_RETRYABLE: Record<ErrorCategory, boolean> = {
  transient: true,    // safe to retry
  logic: false,       // retry would just fail again
  config: false,      // need to fix the env first
  environment: false, // need to free resources
  test: false,        // need to fix the code
  syntax: false,      // need to fix the source
  unknown: false,     // don't know — be safe
};

/**
 * Generate a diagnosis for a tool error. Returns the Diagnosis and emits
 * diagnose_started + diagnose_completed events.
 *
 * The diagnosis is heuristic by default. If `llmNarrate` is provided,
 * the LLM refines the hypotheses and recommended action.
 */
export interface GenerateDiagnosisOptions {
  state: DisciplineState;
  tool: string;
  error: string;
  /** The arguments that produced the error (for context) */
  args?: unknown;
  /** The plan beat that was in effect (if any) */
  planBeatId?: string;
  /** Subgoal/step context */
  subgoalId?: string;
  stepId?: string;
  /** LLM narrator (optional, refines hypotheses) */
  llmNarrate?: (prompt: string) => Promise<string>;
  /** Event factory */
  events: EventFactory;
  /** Override the category (else heuristic) */
  category?: ErrorCategory;
  /** Override the evidence (else extracted from error) */
  evidence?: string[];
  /** Override the hypotheses */
  hypotheses?: string[];
  /** Override the recommended action */
  recommendedAction?: string;
  /** Override isRetryable */
  isRetryable?: boolean;
}

export function generateDiagnosis(opts: GenerateDiagnosisOptions): Diagnosis {
  const { state, tool, error, subgoalId, stepId, events } = opts;
  const id = randomUUID();
  const ts = Date.now();

  // Heuristic diagnosis
  const category = opts.category ?? classifyError(error);
  const evidence = opts.evidence ?? extractEvidence(error);
  const baseHypotheses = opts.hypotheses ?? CATEGORY_HYPOTHESES[category].slice(0, 3);
  const recommendedAction = opts.recommendedAction ?? CATEGORY_ACTIONS[category];
  const isRetryable = opts.isRetryable ?? CATEGORY_RETRYABLE[category];

  const diagnosis: Diagnosis = {
    id,
    tool,
    error: error.slice(0, 2048),
    category,
    evidence,
    hypotheses: baseHypotheses,
    recommendedAction,
    isRetryable,
    ts,
    subgoalId,
    stepId,
  };

  events.make("diagnose_started", { tool, error });
  recordDiagnosis(state, diagnosis);
  events.make("diagnose_completed", { diagnosis });

  return diagnosis;
}

/**
 * Generate a rich diagnosis using the LLM. Slower but higher quality.
 * Falls back to heuristic on LLM error.
 */
export async function generateDiagnosisWithLLM(opts: GenerateDiagnosisOptions): Promise<Diagnosis> {
  if (!opts.llmNarrate) {
    return generateDiagnosis(opts);
  }

  const heuristic = generateDiagnosis(opts);

  const prompt = `A tool just errored. Diagnose the failure, Fable-5 style.

TOOL: ${opts.tool}
ARGS: ${truncate(JSON.stringify(opts.args ?? {}), 400)}
ERROR: ${truncate(opts.error, 1200)}
CATEGORY (initial guess): ${heuristic.category}
INITIAL HYPOTHESES: ${heuristic.hypotheses.join(" | ")}
INITIAL ACTION: ${heuristic.recommendedAction}

Respond in this exact JSON shape:
{
  "category": "transient" | "logic" | "config" | "environment" | "test" | "syntax" | "unknown",
  "hypotheses": ["most likely cause", "second guess", "third guess"],
  "recommendedAction": "one specific concrete action to take next",
  "isRetryable": true | false
}

Be specific. Reference the actual error text. No generic advice.`;

  try {
    const text = await opts.llmNarrate(prompt);
    const parsed = JSON.parse(extractJson(text));
    return generateDiagnosis({
      ...opts,
      category: ["transient", "logic", "config", "environment", "test", "syntax", "unknown"].includes(parsed.category)
        ? parsed.category
        : heuristic.category,
      hypotheses: Array.isArray(parsed.hypotheses) ? parsed.hypotheses.slice(0, 3).map(String) : heuristic.hypotheses,
      recommendedAction: typeof parsed.recommendedAction === "string" ? parsed.recommendedAction : heuristic.recommendedAction,
      isRetryable: typeof parsed.isRetryable === "boolean" ? parsed.isRetryable : heuristic.isRetryable,
    });
  } catch {
    return heuristic;
  }
}

/**
 * Extract evidence lines from an error string. Useful when the error
 * contains a stack trace or multi-line message.
 */
export function extractEvidence(error: string): string[] {
  if (!error) return [];
  const lines = error.split(/\r?\n/);
  // First 3 non-empty lines, capped at 200 chars each
  const evidence: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    evidence.push(trimmed.slice(0, 200));
    if (evidence.length >= 3) break;
  }
  return evidence;
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
