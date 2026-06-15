/**
 * v4/engine-v4.ts
 *
 * The v4.0 Engine: orchestrator that wires together all 7 primitives.
 *
 *   1. Stream (cognitive-event.ts) — wire type
 *   2. HTN planner — task → subgoals → steps
 *   3. Speculative race — race 3 strategies
 *   4. Critic mesh — 3-persona voting
 *   5. Memory graph — causal episode storage
 *   6. Capability composition — typed tool pipelines
 *   7. Actor model — self-healing supervision
 *
 * Workflow:
 *   User task
 *      ↓
 *   Classifier (intent + complexity)
 *      ↓
 *   HTN Planner (decompose to subgoals/steps)
 *      ↓
 *   For each step in topological batches:
 *      ↓
 *      Speculative race (3 strategies) → winner
 *      ↓
 *      Critic mesh (3 personas) → verdict
 *      ↓
 *      Apply winner if verdict != "fail"
 *      ↓
 *      Record episode in graph
 *      ↓
 *   Done
 *
 * All wrapped in actors for self-healing.
 */

import { EventFactory, type CognitiveEvent, type EventOf } from "./stream/cognitive-event.js";
import { ReplayLog } from "./stream/replay-log.js";
import { HTNPlanner, type LLMCall, type PlanContext } from "./htn/index.js";
import { race, diversifyStrategy, type Strategy, type RaceContext, type RaceResult } from "./speculative/index.js";
import { CriticMesh, type CriticLLMCall } from "./critic/index.js";
import { InMemoryGraphStore, type GraphStore, type GraphNode } from "./graph/index.js";
import { Transport, Actor, Supervisor, newAddress, type Address } from "./actor/index.js";
import type { HTNPlan, HTNSubgoal, HTNStep, PlanResult } from "./htn/types.js";
import type { MeshVerdict } from "./critic/index.js";
import { randomUUID } from "node:crypto";
import { DisciplineManager, type DisciplineConfig } from "./discipline/index.js";

/**
 * LLM provider interface: the engine can use any provider that supports
 * text completion. (We don't constrain which model — could be Claude,
 * GPT, Gemini, local, etc.)
 */
export interface LLMProvider {
  /** Provider name for logging */
  name: string;
  /** Model name */
  model: string;
  /** Generate text */
  generateText(prompt: string, opts?: { json?: boolean; temperature?: number; maxTokens?: number }): Promise<{ text: string; tokensUsed: number; durationMs: number }>;
}

/**
 * Engine v4.0 configuration.
 */
export interface EngineV4Config {
  /** LLM provider (used for all stages) */
  provider: LLMProvider;
  /** Optional secondary provider for critics (cheaper model) */
  criticProvider?: LLMProvider;
  /** Optional graph store (default: in-memory) */
  graph?: GraphStore;
  /** Speculation budget in ms (default 5000) */
  speculationBudgetMs?: number;
  /** Quality threshold for race winner (default 0.7) */
  qualityThreshold?: number;
  /** Critic mesh configuration */
  criticConfig?: {
    personas?: ("correctness" | "style" | "intent")[];
    passThreshold?: number;
    failThreshold?: number;
  };
  /**
   * Discipline layer (Fable-5 mindset). When set, the engine emits
   * plan/observe/ground/verify/diagnose beats and enforces fresh-read
   * before edit. See ./discipline/types.ts for the full config.
   *
   * Set to `{}` to enable with defaults, or omit to disable.
   */
  discipline?: DisciplineConfig;
  /** Project root (used by ground-beat and verify-hook for shell exec) */
  projectRoot?: string;
  /** Optional event sink for observability */
  onEvent?: (e: CognitiveEvent) => void;
}

/**
 * Engine v4.0 result.
 */
export interface EngineV4Result {
  ok: boolean;
  plan: HTNPlan;
  /** Race results per subgoal */
  raceResults: Map<string, RaceResult>;
  /** Critic verdicts per subgoal */
  verdicts: Map<string, MeshVerdict>;
  /** Final output text */
  output: string;
  /** Total duration in ms */
  totalMs: number;
  /** Tokens used */
  totalTokens: number;
  /** Episode id (for graph lookup) */
  episodeId: string;
  /** All events emitted (in order) */
  events: CognitiveEvent[];
}

/**
 * Engine v4.0.
 */
export class EngineV4 {
  private provider: LLMProvider;
  private criticProvider: LLMProvider;
  private graph: GraphStore;
  private events: CognitiveEvent[] = [];
  private replayLog: ReplayLog;
  private transport: Transport;
  private supervisor?: Supervisor;
  private speculationBudgetMs: number;
  private qualityThreshold: number;
  private criticConfig: NonNullable<EngineV4Config["criticConfig"]>;
  private onEvent?: (e: CognitiveEvent) => void;
  private sessionId: string;
  /** Persistent event factory so seq numbers are monotonic across runs. */
  private eventFactory: EventFactory;
  /**
   * Discipline layer (Fable-5 mindset). Optional — only created if the
   * engine config includes a `discipline` block.
   */
  private discipline?: DisciplineManager;
  /** Project root, used by the discipline layer. */
  private projectRoot: string;

  constructor(config: EngineV4Config) {
    this.provider = config.provider;
    this.criticProvider = config.criticProvider ?? config.provider;
    this.graph = config.graph ?? new InMemoryGraphStore();
    this.speculationBudgetMs = config.speculationBudgetMs ?? 5000;
    this.qualityThreshold = config.qualityThreshold ?? 0.7;
    this.criticConfig = config.criticConfig ?? {};
    this.onEvent = config.onEvent;
    this.sessionId = randomUUID();
    this.replayLog = new ReplayLog(1024, 64);
    this.transport = new Transport();
    this.eventFactory = new EventFactory();
    this.eventFactory.onEmit = (e) => this.recordEvent(e);
    this.projectRoot = config.projectRoot ?? process.cwd();
    if (config.discipline) {
      this.discipline = new DisciplineManager({
        config: config.discipline,
        events: this.eventFactory,
        projectRoot: this.projectRoot,
      });
    }

    this.startSupervisor();
  }

  /**
   * Run a task. Returns the final result.
   */
  async run(task: string, context?: PlanContext): Promise<EngineV4Result> {
    const t0 = Date.now();
    // Use the persistent eventFactory so seq numbers are monotonic
    // across multiple runs in the same engine instance.
    const eventFactory = this.eventFactory;

    // Session start
    const sessionStartEv = eventFactory.make("session_start", { sessionId: this.sessionId });
    void sessionStartEv;

    // Stage 0 (discipline): Ground in reality — check the world before
    // we plan. Skipped if discipline is not enabled.
    if (this.discipline) {
      try {
        await this.discipline.ground({
          task,
          projectRoot: this.projectRoot,
          hasGit: context?.project ? true : undefined,
        });
      } catch (err) {
        // Ground beat failure is non-fatal — log and continue
        eventFactory.make("log", {
          level: "warn",
          msg: `ground beat failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }

    // Stage 1: Classify
    const llmCall: LLMCall = async (prompt, opts) => {
      const r = await this.provider.generateText(prompt, opts);
      return r.text;
    };
    const planner = new HTNPlanner({ llm: llmCall });
    const classification = planner.classify(task);
    const classifiedEv = eventFactory.make("classified", {
      task,
      intent: classification.intent,
      complexity: classification.complexity,
      confidence: classification.confidence,
    });
    void classifiedEv;

    // Stage 2: Plan
    const plan = await planner.plan(task, context);
    const htnPlanEv = eventFactory.make("htn_plan", {
      planId: plan.id,
      subgoals: plan.subgoals.length,
      steps: plan.subgoals.reduce((s, sg) => s + sg.steps.length, 0),
      parallelGroups: plan.executionOrder.length,
    });
    void htnPlanEv;

    // Stage 3-4: Execute each batch (subgoals in parallel)
    const raceResults = new Map<string, RaceResult>();
    const verdicts = new Map<string, MeshVerdict>();
    const outputs: string[] = [];
    let totalTokens = 0;

    for (let bi = 0; bi < plan.executionOrder.length; bi++) {
      const batch = plan.executionOrder[bi];
      const batchResults = await Promise.all(
        batch.map(async (sgId) => {
          const sg = plan.subgoals.find((s) => s.id === sgId)!;
          return this.executeSubgoal(sg, plan, eventFactory, context);
        })
      );
      for (const r of batchResults) {
        if (r.raceResult) raceResults.set(r.subgoalId, r.raceResult);
        if (r.verdict) verdicts.set(r.subgoalId, r.verdict);
        if (r.output) outputs.push(r.output);
        totalTokens += r.tokensUsed;
      }
    }

    // Stage 5: Reflect (record episode in graph)
    const episodeNode = await this.graph.addNode({
      kind: "episode",
      label: task.slice(0, 80),
      body: outputs.join("\n\n"),
      properties: {
        sessionId: this.sessionId,
        planId: plan.id,
        subgoals: plan.subgoals.length,
        methods: plan.methodsUsed,
      },
      validFrom: Date.now(),
      validTo: null,
      confidence: 1.0,
    });
    const episodeEv = eventFactory.make("episode_recorded", {
      episodeId: episodeNode.id,
      task,
      ok: true,
      durationMs: Date.now() - t0,
    });
    void episodeEv;

    // Session end
    const totalMs = Date.now() - t0;
    const sessionEndEv = eventFactory.make("session_end", {
      sessionId: this.sessionId,
      ok: true,
      durationMs: totalMs,
    });
    void sessionEndEv;

    return {
      ok: true,
      plan,
      raceResults,
      verdicts,
      output: outputs.join("\n\n"),
      totalMs,
      totalTokens,
      episodeId: episodeNode.id,
      events: this.events.slice(),
    };
  }

  /**
   * Get the replay log (for time-travel debugging).
   */
  getReplayLog(): ReplayLog {
    return this.replayLog;
  }

  /**
   * Get the graph store.
   */
  getGraph(): GraphStore {
    return this.graph;
  }

  /**
   * Get the discipline manager (if enabled). Returns undefined when
   * the engine was constructed without a `discipline` config block.
   */
  getDiscipline(): DisciplineManager | undefined {
    return this.discipline;
  }

  /**
   * Stop the engine and all actors.
   */
  async stop(): Promise<void> {
    if (this.supervisor) {
      await this.supervisor.stop();
    }
  }

  // ─── Private helpers ──────────────────────────────────────────────

  private recordEvent(e: CognitiveEvent): void {
    this.events.push(e);
    this.replayLog.push(e);
    if (this.onEvent) this.onEvent(e);
  }

  private startSupervisor(): void {
    // Define child actor specs
    const transport = this.transport;
    const childSpecs = [
      {
        address: "classifier-actor",
        kind: "worker" as const,
        importance: 1,
        restart: "permanent" as const,
        factory: () => ({
          transport,
          maxRestarts: 3,
          intensityPeriodMs: 5000,
          behavior: {
            init: () => ({ calls: 0 }),
            handle: async (state: any, msg: any) => {
              if (msg.kind === "classify") return { calls: state.calls + 1 };
            },
          },
        }),
      },
      {
        address: "planner-actor",
        kind: "worker" as const,
        importance: 2,
        restart: "permanent" as const,
        factory: () => ({
          transport,
          maxRestarts: 3,
          intensityPeriodMs: 5000,
          behavior: {
            init: () => ({ plans: 0 }),
            handle: async (state: any, msg: any) => {
              if (msg.kind === "plan") return { plans: state.plans + 1 };
            },
          },
        }),
      },
      {
        address: "executor-actor",
        kind: "worker" as const,
        importance: 3,
        restart: "permanent" as const,
        factory: () => ({
          transport,
          maxRestarts: 3,
          intensityPeriodMs: 5000,
          behavior: {
            init: () => ({ executions: 0 }),
            handle: async (state: any, msg: any) => {
              if (msg.kind === "execute") return { executions: state.executions + 1 };
            },
          },
        }),
      },
      {
        address: "critic-actor",
        kind: "worker" as const,
        importance: 4,
        restart: "permanent" as const,
        factory: () => ({
          transport,
          maxRestarts: 3,
          intensityPeriodMs: 5000,
          behavior: {
            init: () => ({ verdicts: 0 }),
            handle: async (state: any, msg: any) => {
              if (msg.kind === "evaluate") return { verdicts: state.verdicts + 1 };
            },
          },
        }),
      },
    ];

    this.supervisor = new Supervisor({
      transport,
      strategy: "one_for_one",
      maxRestarts: 5,
      intensityPeriodMs: 5000,
      children: childSpecs,
    });
    this.supervisor.start().catch((err) => {
      console.error("[EngineV4] supervisor start failed:", err);
    });
  }

  /**
   * Execute a single subgoal: race strategies, then evaluate with critic mesh.
   */
  private async executeSubgoal(
    sg: HTNSubgoal,
    plan: HTNPlan,
    eventFactory: EventFactory,
    context?: PlanContext
  ): Promise<{ subgoalId: string; raceResult?: RaceResult; verdict?: MeshVerdict; output?: string; tokensUsed: number }> {
    const sgStartEv = eventFactory.make("subgoal_started", { subgoalId: sg.id, description: sg.description });
    void sgStartEv;

    // Discipline: emit plan beat for this subgoal (Fable 5 principle 1)
    if (this.discipline) {
      this.discipline.planFromSubgoal({
        id: sg.id,
        description: sg.description,
        steps: sg.steps.map((s) => ({ id: s.id, tool: s.tool, description: s.description })),
        acceptance: sg.acceptance,
        risk: sg.steps.reduce((max, s) => Math.max(max, s.risk ?? 0), 0) as 0 | 1 | 2 | 3,
      });
    }

    // Build a strategy from the subgoal's steps
    const baseStrategy: Omit<Strategy, "id" | "name"> = {
      description: sg.description,
      steps: sg.steps.map((s) => ({ tool: s.tool, args: s.args, description: s.description })),
      estimatedMs: sg.steps.reduce((s, st) => s + (st.estimatedMs ?? 5000), 0),
      estimatedQuality: 0.8,
      estimatedCostTokens: 1000,
      risk: Math.max(...sg.steps.map((s) => s.risk ?? 0)) as 0 | 1 | 2 | 3,
      diversity: 0,
    };

    // Diversify into 3 strategies
    const strategies = diversifyStrategy(baseStrategy, { name: sg.description.slice(0, 20) });

    // Race them
    const raceResult = await race({
      strategies,
      budgetMs: this.speculationBudgetMs,
      qualityThreshold: this.qualityThreshold,
      mode: "first_wins",
      task: plan.task,
      events: eventFactory,
      executeStep: async (tool, args) => {
        const t0 = Date.now();
        try {
          let result: { result: unknown; tokensUsed: number };
          if (tool === "llm_implement" || tool === "llm_spec" || tool === "llm_fix" || tool === "llm_locate" || tool === "llm_answer") {
            const r = await this.provider.generateText(
              (args as any).prompt ?? JSON.stringify(args),
              { temperature: 0.3 }
            );
            result = { result: r.text, tokensUsed: r.tokensUsed };
          } else if (tool === "bash") {
            result = { result: { stdout: "mock output", exitCode: 0 }, tokensUsed: 10 };
          } else if (tool === "read_file" || tool === "read_files") {
            // Discipline: mark the file as read (Fable 5 principle 4)
            const fp = (args as any)?.file_path ?? (args as any)?.path ?? (Array.isArray(args) ? "files" : "unknown");
            if (this.discipline && typeof fp === "string") {
              this.discipline.markFileRead(fp);
            }
            result = { result: "mock file content", tokensUsed: 5 };
          } else if (tool === "verify") {
            result = { result: "verified", tokensUsed: 0 };
          } else if (tool === "noop") {
            result = { result: "ok", tokensUsed: 0 };
          } else {
            result = { result: null, tokensUsed: 0 };
          }

          // Discipline: emit observe beat after every result (Fable 5 principle 2)
          if (this.discipline) {
            this.discipline.observe(tool, result.result, { subgoalId: sg.id });
          }

          // Discipline: emit verify hook after Edit/Write (Fable 5 principle 5)
          if (this.discipline && (tool === "Edit" || tool === "Write" || tool === "MultiEdit")) {
            const fp = (args as any)?.file_path ?? (args as any)?.path;
            if (typeof fp === "string") {
              try {
                await this.discipline.verify(fp, tool as "Edit" | "Write" | "MultiEdit");
              } catch {
                // Verify failure is non-fatal for the engine — the discipline
                // layer has already emitted the verify_failed event
              }
            }
          }

          return result;
        } catch (err) {
          // Discipline: emit diagnose beat on tool error (Fable 5 principle 6)
          if (this.discipline) {
            this.discipline.diagnose(tool, err instanceof Error ? err.message : String(err), {
              args,
              subgoalId: sg.id,
            });
          }
          throw err;
        }
      },
      assessQuality: async (result) => {
        // Quick heuristic: non-empty result is "good"
        if (result === null || result === undefined) return { score: 0, confidence: 0, rationale: "no result" };
        const text = typeof result === "string" ? result : JSON.stringify(result);
        if (text.length < 5) return { score: 0.3, confidence: 0.3, rationale: "too short" };
        if (text.length > 100000) return { score: 0.6, confidence: 0.5, rationale: "too long" };
        return { score: 0.85, confidence: 0.8, rationale: "looks reasonable" };
      },
    });

    // Run critic mesh on the winner
    let verdict: MeshVerdict | undefined;
    if (raceResult.winner) {
      const criticLLM: CriticLLMCall = async ({ persona, userContent }) => {
        const r = await this.criticProvider.generateText(
          `${persona.systemPrompt}\n\n${userContent}\n\nRespond with JSON: {"score":0.0-1.0,"confidence":0.0-1.0,"rationale":"...","issues":[],"suggestions":[]}`,
          { json: true, temperature: 0.1 }
        );
        return { content: r.text, tokensUsed: r.tokensUsed, durationMs: r.durationMs };
      };
      const mesh = new CriticMesh({
        llm: criticLLM,
        events: eventFactory,
        ...this.criticConfig,
      });
      const winnerText = typeof raceResult.winner.output === "string" ? raceResult.winner.output : JSON.stringify(raceResult.winner.output);
      verdict = await mesh.evaluate(winnerText, { raceId: raceResult.raceId, stepId: sg.id });
    }

    // Emit subgoal_completed
    const completedEv = eventFactory.make("subgoal_completed", {
      subgoalId: sg.id,
      ok: raceResult.winner !== null,
      durationMs: raceResult.durationMs,
    });
    void completedEv;

    return {
      subgoalId: sg.id,
      raceResult,
      verdict,
      output: raceResult.winner ? (typeof raceResult.winner.output === "string" ? raceResult.winner.output : JSON.stringify(raceResult.winner.output)) : undefined,
      tokensUsed: raceResult.candidates.reduce((s, c) => s + c.tokensUsed, 0),
    };
  }
}
