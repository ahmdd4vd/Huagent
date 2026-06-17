/**
 * v4/htn/planner.ts
 *
 * The HTN Planner. Pyhop-style algorithm:
 *   1. Find a method whose precondition matches the task.
 *   2. Apply the method to decompose task into subgoals.
 *   3. Recursively decompose subgoals until all are atomic steps.
 *   4. Topologically sort subgoals by dependency.
 *   5. Group subgoals with no dependencies into parallel batches.
 *
 * Why a custom implementation vs an off-the-shelf planner (e.g., SHOP2 port):
 * - We want LLM-driven method synthesis, not hand-coded methods.
 * - We want parallel-group support, which classical HTN planners don't.
 * - We want to compose with other v4.0 primitives (speculative, critic mesh).
 *
 * Trade-offs:
 * - Slower than classical HTN (LLM roundtrips for decomposition).
 * - But: smarter, project-aware, and self-improving via learned methods.
 *
 * Fallback: if LLM decomposition fails or returns garbage, fall back to
 * v3.0's flat planner via `htn-v3-adapter.ts`.
 */

import { randomUUID } from "node:crypto";
import type { Intent, Complexity } from "../stream/cognitive-event.js";
import type {
  HTNPlan,
  HTNSubgoal,
  HTNStep,
  HTNMethod,
  PlanContext,
  PlanResult,
} from "./types.js";

/**
 * LLM call signature — we inject this so the planner is testable without
 * a real LLM.
 */
export type LLMCall = (prompt: string, opts?: { json?: boolean; temperature?: number }) => Promise<string>;

/**
 * Default methods: built-in decomposition rules that work for common cases
 * without an LLM. The LLM is only consulted for tasks the built-ins can't
 * handle.
 */
const BUILTIN_METHODS: HTNMethod[] = [
  {
    name: "trivial-question",
    description: "Pure Q&A, no code change. Just answer.",
    appliesTo: ["question"],
    precondition: (task, ctx) => {
      const t = task.toLowerCase().trim();
      return (
        t.startsWith("what ") ||
        t.startsWith("how ") ||
        t.startsWith("why ") ||
        t.startsWith("explain ") ||
        t.startsWith("describe ") ||
        t.length < 30
      );
    },
    apply: (task) => [
      {
        id: randomUUID(),
        description: "Answer question",
        steps: [
          {
            id: randomUUID(),
            tool: "llm_answer",
            args: { prompt: task },
            estimatedMs: 3000,
            risk: 0,
            description: "LLM direct answer",
            retryable: false,
          },
        ],
        dependsOn: [],
        parallelGroup: 0,
        acceptance: "Answer is provided",
      },
    ],
    source: "built-in",
    confidence: 0.95,
  },

  {
    name: "shell-command",
    description: "Run a shell command, no code edit.",
    appliesTo: ["command"],
    precondition: (task) => {
      const t = task.toLowerCase().trim();
      return t.length < 50 && (
        t.startsWith("run ") ||
        t.startsWith("exec ") ||
        t.startsWith("test") ||
        t.startsWith("build") ||
        t.startsWith("lint") ||
        t.startsWith("commit") ||
        t.startsWith("push") ||
        t.startsWith("git ") ||
        t.startsWith("npm ") ||
        t.startsWith("npx ")
      );
    },
    apply: (task) => [
      {
        id: randomUUID(),
        description: `Run command: ${task.slice(0, 60)}`,
        steps: [
          {
            id: randomUUID(),
            tool: "bash",
            args: { command: task.replace(/^(run|exec)\s+/i, "") },
            estimatedMs: 10000,
            risk: 1,
            description: "Execute shell command",
            retryable: true,
          },
        ],
        dependsOn: [],
        parallelGroup: 0,
        acceptance: "Command exits 0",
      },
    ],
    source: "built-in",
    confidence: 0.9,
  },

  {
    name: "code-write-feature",
    description: "Add a new feature: investigate, design, implement, test.",
    appliesTo: ["code_write"],
    precondition: () => true,
    apply: (task, ctx) => {
      const subgoals: HTNSubgoal[] = [];

      // Subgoal 1: investigate
      const investigate: HTNSubgoal = {
        id: randomUUID(),
        description: "Investigate existing code structure",
        steps: [
          {
            id: randomUUID(),
            tool: "bash",
            args: { command: "ls -la" },
            estimatedMs: 1000,
            risk: 0,
            description: "List project root",
            retryable: true,
          },
        ],
        dependsOn: [],
        parallelGroup: 0,
        acceptance: "Project structure understood",
      };
      subgoals.push(investigate);

      // Subgoal 2: design spec (depends on investigate)
      const design: HTNSubgoal = {
        id: randomUUID(),
        description: "Generate implementation spec",
        steps: [
          {
            id: randomUUID(),
            tool: "llm_spec",
            args: { task, project: ctx.project },
            estimatedMs: 3000,
            risk: 0,
            description: "LLM produces spec",
            retryable: true,
          },
        ],
        dependsOn: [investigate.id],
        parallelGroup: 1,
        acceptance: "Spec has requirements + acceptance criteria",
      };
      subgoals.push(design);

      // Subgoal 3: implement (depends on design)
      const implement: HTNSubgoal = {
        id: randomUUID(),
        description: "Implement feature per spec",
        steps: [
          {
            id: randomUUID(),
            tool: "llm_implement",
            args: { task, spec: "$" + design.id },
            estimatedMs: 8000,
            risk: 2,
            description: "LLM writes code",
            retryable: true,
          },
        ],
        dependsOn: [design.id],
        parallelGroup: 2,
        acceptance: "Code compiles, types check",
      };
      subgoals.push(implement);

      // Subgoal 4: test (depends on implement)
      const test: HTNSubgoal = {
        id: randomUUID(),
        description: "Run tests, verify behavior",
        steps: [
          {
            id: randomUUID(),
            tool: "bash",
            args: { command: ctx.project?.testFramework === "vitest" ? "npx vitest run" : "npm test" },
            estimatedMs: 15000,
            risk: 1,
            description: "Run test suite",
            retryable: true,
          },
        ],
        dependsOn: [implement.id],
        parallelGroup: 3,
        acceptance: "All tests pass",
      };
      subgoals.push(test);

      return subgoals;
    },
    source: "built-in",
    confidence: 0.75,
  },

  {
    name: "code-fix-bug",
    description: "Fix a bug: locate, understand, fix, verify.",
    appliesTo: ["code_fix"],
    precondition: () => true,
    apply: (task, ctx) => {
      const subgoals: HTNSubgoal[] = [];

      // Subgoal 1: locate (find the file/line)
      const locate: HTNSubgoal = {
        id: randomUUID(),
        description: "Locate bug in codebase",
        steps: [
          {
            id: randomUUID(),
            tool: "llm_locate",
            args: { task },
            estimatedMs: 4000,
            risk: 0,
            description: "LLM finds affected files/lines",
            retryable: true,
          },
        ],
        dependsOn: [],
        parallelGroup: 0,
        acceptance: "Affected files identified",
      };
      subgoals.push(locate);

      // Subgoal 2: read context
      const readCtx: HTNSubgoal = {
        id: randomUUID(),
        description: "Read affected files for context",
        steps: [
          {
            id: randomUUID(),
            tool: "read_files",
            args: { paths: "$" + locate.id + ".files" },
            estimatedMs: 1500,
            risk: 0,
            description: "Read context",
            retryable: true,
          },
        ],
        dependsOn: [locate.id],
        parallelGroup: 1,
        acceptance: "Context loaded",
      };
      subgoals.push(readCtx);

      // Subgoal 3: fix
      const fix: HTNSubgoal = {
        id: randomUUID(),
        description: "Apply the fix",
        steps: [
          {
            id: randomUUID(),
            tool: "llm_fix",
            args: { task, location: "$" + locate.id, context: "$" + readCtx.id },
            estimatedMs: 6000,
            risk: 2,
            description: "LLM applies fix",
            retryable: true,
          },
        ],
        dependsOn: [readCtx.id],
        parallelGroup: 2,
        acceptance: "Fix applied, no new errors",
      };
      subgoals.push(fix);

      // Subgoal 4: verify
      const verify: HTNSubgoal = {
        id: randomUUID(),
        description: "Verify fix (tests + typecheck)",
        steps: [
          {
            id: randomUUID(),
            tool: "bash",
            args: { command: "npx tsc --noEmit && npm test" },
            estimatedMs: 20000,
            risk: 1,
            description: "Verify fix",
            retryable: true,
          },
        ],
        dependsOn: [fix.id],
        parallelGroup: 3,
        acceptance: "Tests pass, types check",
      };
      subgoals.push(verify);

      return subgoals;
    },
    source: "built-in",
    confidence: 0.8,
  },
];

/**
 * The HTN Planner.
 */
export class HTNPlanner {
  private methods: HTNMethod[] = [...BUILTIN_METHODS];
  private llm: LLMCall;
  private maxDepth: number;

  constructor(opts: { llm: LLMCall; maxDepth?: number; additionalMethods?: HTNMethod[] }) {
    this.llm = opts.llm;
    this.maxDepth = opts.maxDepth ?? 4;
    if (opts.additionalMethods) this.methods.push(...opts.additionalMethods);
  }

  /**
   * Add a learned method (from instinct synthesis or user).
   */
  addMethod(method: HTNMethod): void {
    this.methods.push(method);
  }

  /**
   * Get the method library (read-only).
   */
  getMethods(): readonly HTNMethod[] {
    return this.methods;
  }

  /**
   * Classify a task (cheap, no LLM by default; LLM fallback if needed).
   */
  classify(task: string): { intent: Intent; complexity: Complexity; confidence: number } {
    const t = task.toLowerCase().trim();

    // Pattern matching
    if (/^(what|how|why|explain|describe|tell me|can you)/.test(t) || t.endsWith("?")) {
      return { intent: "question", complexity: "simple", confidence: 0.9 };
    }
    if (/^(fix|debug|broken|error|bug|crash)/.test(t)) {
      return { intent: "code_fix", complexity: t.length > 100 ? "moderate" : "simple", confidence: 0.85 };
    }
    if (/^(add|implement|create|build|new)/.test(t)) {
      return { intent: "code_write", complexity: t.length > 100 ? "moderate" : "simple", confidence: 0.85 };
    }
    if (/^(refactor|restructure|reorganize|clean)/.test(t)) {
      return { intent: "code_refactor", complexity: "moderate", confidence: 0.8 };
    }
    if (/^(test|spec|coverage)/.test(t)) {
      return { intent: "code_test", complexity: "simple", confidence: 0.85 };
    }
    if (/^(review|audit|check|analyze)/.test(t)) {
      return { intent: "code_review", complexity: "simple", confidence: 0.8 };
    }
    if (t.length < 50 && /^(run|exec|git|npm|npx|test|build|lint)/.test(t)) {
      return { intent: "command", complexity: "trivial", confidence: 0.95 };
    }
    return { intent: "code_write", complexity: "moderate", confidence: 0.5 };
  }

  /**
   * Plan a task. Returns an HTNPlan.
   *
   * Strategy:
   * 1. Classify task → intent + complexity
   * 2. Find matching method(s) for that intent
   * 3. Apply method to get subgoals
   * 4. Recursively decompose subgoals (depth-limited)
   * 5. If built-in methods don't match, ask LLM to synthesize
   * 6. Topologically sort and group into parallel batches
   */
  async plan(task: string, context: PlanContext = {}): Promise<HTNPlan> {
    const t0 = Date.now();
    const classification = this.classify(task);

    // Find applicable methods, ranked by confidence
    const candidates = this.methods
      .filter((m) => m.appliesTo.includes(classification.intent))
      .sort((a, b) => b.confidence - a.confidence);

    let subgoals: HTNSubgoal[] = [];
    let methodsUsed: string[] = [];
    let synthesizedBy: HTNPlan["synthesizedBy"] = "built-in";

    for (const method of candidates) {
      const pre = await method.precondition(task, context);
      if (pre) {
        try {
          subgoals = await method.apply(task, context);
          methodsUsed.push(method.name);
          if (method.source === "learned") synthesizedBy = "synthesized";
          break;
        } catch (err) {
          // Method failed; try next
          continue;
        }
      }
    }

    if (subgoals.length === 0) {
      // Fallback: ask LLM to synthesize
      subgoals = await this.synthesizeViaLLM(task, classification.intent, classification.complexity, context);
      methodsUsed.push("llm-synthesized");
      synthesizedBy = "llm";
    }

    // Recursively decompose subgoals (depth-limited)
    subgoals = await this.decomposeRecursive(subgoals, task, context, 0);

    // Topologically sort and parallel-batch
    const executionOrder = this.topologicalBatches(subgoals);

    // Estimate cost
    const estimatedMs = subgoals.reduce(
      (sum, sg) => sum + sg.steps.reduce((s, st) => s + (st.estimatedMs ?? 5000), 0),
      0
    );

    return {
      id: randomUUID(),
      task,
      intent: classification.intent,
      complexity: classification.complexity,
      subgoals,
      executionOrder,
      estimatedMs,
      methodsUsed,
      createdAt: Date.now() - t0,
      synthesizedBy,
    };
  }

  /**
   * Recursively decompose subgoals via methods.
   * In practice: most subgoals from built-in methods are already atomic,
   * so this is a no-op for built-in methods. LLM-synthesized plans might
   * have non-atomic subgoals.
   */
  private async decomposeRecursive(
    subgoals: HTNSubgoal[],
    task: string,
    context: PlanContext,
    depth: number
  ): Promise<HTNSubgoal[]> {
    if (depth >= this.maxDepth) return subgoals;
    // For now, no sub-subgoals; built-in methods produce atomic subgoals.
    // This is the hook for future LLM-driven nested planning.
    return subgoals;
  }

  /**
   * Ask LLM to synthesize subgoals for an unmatched task.
   */
  private async synthesizeViaLLM(
    task: string,
    intent: Intent,
    complexity: Complexity,
    context: PlanContext
  ): Promise<HTNSubgoal[]> {
    const prompt = `You are an HTN planner. Decompose this task into subgoals.

Task: ${task}
Intent: ${intent}
Complexity: ${complexity}
Project: ${context.project ? JSON.stringify(context.project) : "unknown"}

Return a JSON array of subgoals, each with:
- id: unique string
- description: what this subgoal accomplishes
- steps: array of {id, tool, args, estimatedMs, risk, description}
- dependsOn: array of subgoal ids that must complete first
- parallelGroup: integer (subgoals with same group run in parallel)
- acceptance: how we know it succeeded

Subgoals with no dependsOn can run in parallel.

Output ONLY valid JSON, no commentary.`;

    try {
      const response = await this.llm(prompt, { json: true, temperature: 0.3 });
      const parsed = JSON.parse(response);
      if (Array.isArray(parsed)) {
        return parsed.map((sg: any) => ({
          id: sg.id ?? randomUUID(),
          description: sg.description ?? "synthesized subgoal",
          steps: (sg.steps ?? []).map((s: any) => ({
            id: s.id ?? randomUUID(),
            tool: s.tool ?? "llm_implement",
            args: s.args ?? {},
            estimatedMs: s.estimatedMs ?? 5000,
            risk: s.risk ?? 2,
            description: s.description ?? "",
            retryable: s.retryable ?? true,
          })),
          dependsOn: sg.dependsOn ?? [],
          parallelGroup: sg.parallelGroup ?? 0,
          acceptance: sg.acceptance,
        }));
      }
    } catch (err) {
      // LLM failed; return a single-subgoal fallback
    }

    return [
      {
        id: randomUUID(),
        description: "Execute task (LLM fallback)",
        steps: [
          {
            id: randomUUID(),
            tool: "llm_implement",
            args: { task },
            estimatedMs: 10000,
            risk: 2,
            description: "LLM attempts task directly",
            retryable: true,
          },
        ],
        dependsOn: [],
        parallelGroup: 0,
      },
    ];
  }

  /**
   * Topologically sort subgoals by dependency, then group by parallelGroup.
   *
   * Returns array of batches, where each batch is an array of subgoal ids
   * that can execute in parallel.
   */
  topologicalBatches(subgoals: HTNSubgoal[]): string[][] {
    const byId = new Map(subgoals.map((sg) => [sg.id, sg]));
    const visited = new Set<string>();
    const inCurrentPath = new Set<string>();
    const batches: string[][] = [];
    const batchOf = new Map<string, number>();

    // Group subgoals by their explicit parallelGroup
    const groupMap = new Map<number, string[]>();
    for (const sg of subgoals) {
      const g = sg.parallelGroup ?? 0;
      if (!groupMap.has(g)) groupMap.set(g, []);
      groupMap.get(g)!.push(sg.id);
    }

    // Order groups: a group's batch number is the max batch of its dependencies + 1
    for (const sg of subgoals) {
      if (batchOf.has(sg.id)) continue;
      const batchNum = this.computeBatch(sg, byId, batchOf, new Set());
      batchOf.set(sg.id, batchNum);
    }

    // Assemble batches
    const maxBatch = Math.max(0, ...Array.from(batchOf.values()));
    for (let i = 0; i <= maxBatch; i++) {
      const batch = Array.from(batchOf.entries())
        .filter(([_, b]) => b === i)
        .map(([id]) => id);
      if (batch.length > 0) batches.push(batch);
    }
    return batches;
  }

  private computeBatch(
    sg: HTNSubgoal,
    byId: Map<string, HTNSubgoal>,
    batchOf: Map<string, number>,
    path: Set<string>
  ): number {
    if (batchOf.has(sg.id)) return batchOf.get(sg.id)!;
    if (path.has(sg.id)) throw new Error(`HTN: cycle detected at ${sg.id}`);
    path.add(sg.id);
    let max = -1;
    for (const depId of sg.dependsOn) {
      const dep = byId.get(depId);
      if (!dep) continue;
      const depBatch = this.computeBatch(dep, byId, batchOf, path);
      if (depBatch > max) max = depBatch;
    }
    path.delete(sg.id);
    const my = max + 1;
    batchOf.set(sg.id, my);
    return my;
  }
}
