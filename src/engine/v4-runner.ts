/**
 * src/engine/v4-runner.ts
 *
 * CLI integration of HuaEngine v4.0. Wraps the v4 engine with adapters
 * for the v3.0 client/memory/tools, so users can run v4 without
 * changing their existing config.
 *
 * Usage (programmatic):
 *   import { runWithV4 } from "./engine/v4-runner.js";
 *   await runWithV4("add OAuth to my app", {
 *     provider, model, apiKey, baseUrl, workdir,
 *     speculationBudgetMs: 5000, qualityThreshold: 0.7,
 *   });
 */

import { EngineV4, InMemoryGraphStore, type LLMProvider } from "./v4/index.js";
import { UnifiedClient } from "../providers/client.js";
import { PROVIDERS, type ProviderId } from "../providers/registry.js";
import { MemoryStore } from "../memory/store.js";
import { MemoryManager } from "../memory/manager.js";
import { ToolRegistry } from "../tools/index.js";
import { SessionManager } from "../sessions.js";
import { summarize, type CognitiveEvent } from "./v4/stream/index.js";

/**
 * Options for running v4 engine.
 */
export interface V4RunOptions {
  provider?: string;
  model?: string;
  apiKey?: string;
  baseUrl?: string;
  workdir: string;
  /** Speculation budget in ms (default 5000) */
  speculationBudgetMs?: number;
  /** Quality threshold for race winner (default 0.7) */
  qualityThreshold?: number;
  /** Optional callback for each event (TUI integration) */
  onEvent?: (e: CognitiveEvent) => void;
  /** Optional shared graph store */
  graph?: InMemoryGraphStore;
  /** Optional memory store for tool execution (v3.0 compat) */
  memoryStore?: MemoryStore;
  /** Optional tool registry (v3.0 compat) */
  tools?: ToolRegistry;
  // ── Autoresearch-inspired options ────────────────────────────
  /** Autonomous mode: no confirmations, all bash auto-allow (default: false) */
  autonomous?: boolean;
  /** File scope: limit agent edits to this single file (default: null = multi-file) */
  scope?: string | null;
}

/**
 * Adapter: UnifiedClient → LLMProvider for v4.
 */
function clientToProvider(
  client: UnifiedClient,
  model: string,
): LLMProvider {
  return {
    name: client.getProviderName(),
    model,
    generateText: async (prompt, opts) => {
      const t0 = Date.now();
      let text = "";
      for await (const event of client.stream({
        model,
        system: "You are a coding assistant. Respond in the requested format. Be concise.",
        messages: [{ role: "user", content: prompt }],
        temperature: opts?.temperature ?? 0.3,
      })) {
        if (event.type === "text_delta") {
          text += event.delta;
        } else if (event.type === "message_stop") {
          break;
        }
      }
      return { text, tokensUsed: 0, durationMs: Date.now() - t0 };
    },
  };
}

/**
 * Run a task using v4 engine.
 *
 * This is the main entry point for CLI integration. It:
 * 1. Creates an EngineV4 with the configured LLM provider
 * 2. Wraps v3.0 client/memory/tools as engine inputs
 * 3. Streams events to the callback (for TUI)
 * 4. Returns the final result
 */
export async function runWithV4(
  task: string,
  options: V4RunOptions,
): Promise<{
  ok: boolean;
  output: string;
  plan: any;
  events: CognitiveEvent[];
  totalMs: number;
  totalTokens: number;
  episodeId: string;
}> {
  // Resolve provider
  const providerId = (options.provider as ProviderId) || "custom";
  const apiKey = options.apiKey || process.env[PROVIDERS[providerId]?.apiKeyEnv || "TOKENROUTER_API_KEY"] || "";
  const baseUrl = options.baseUrl || process.env.HUAGENT_BASE_URL;
  const model = options.model || "MiniMax-M3";

  const client = new UnifiedClient(providerId, apiKey, baseUrl);
  const provider = clientToProvider(client, model);

  // Use shared graph if provided, else fresh in-memory
  const graph = options.graph || new InMemoryGraphStore();

  const engine = new EngineV4({
    provider,
    graph,
    speculationBudgetMs: options.speculationBudgetMs ?? 5000,
    qualityThreshold: options.qualityThreshold ?? 0.7,
    onEvent: options.onEvent,
    projectRoot: options.workdir,
    // Autoresearch-inspired: opt into the discipline layer (Fable 5 mindset)
    // whenever we have a scope or autonomous flag, so the engine emits
    // plan/observe/verify/diagnose beats and enforces the scope.
    discipline: (options.autonomous || options.scope) ? {
      // mode: "always" tells the verify hook to actually run the project test
      // on every Edit/Write, even without an explicit test command.
      verifyConfig: options.autonomous
        ? { mode: "if_project_test", timeoutMs: 60_000 }
        : { mode: "if_project_test", timeoutMs: 60_000 },
    } : undefined,
  });

  // Build the project context with scope + autonomous hints baked in
  const context: any = {
    project: {
      root: options.workdir,
    },
  };
  // If a scope is set, surface it as a project note that the planner
  // sees in its context. The HTN planner will bias toward operations
  // that match the scope, and the v4 executeStep refuses out-of-scope
  // file_path values when this is present.
  if (options.scope) {
    context.projectNote = `SCOPE: The agent is limited to editing the file "${options.scope}" only. Do not propose edits to other files. If a required change is outside scope, surface it to the user as a recommendation instead of making the change.`;
  }
  if (options.autonomous) {
    context.projectNote = (context.projectNote || '') + `\nAUTONOMOUS MODE: Do not ask the user for confirmation. Make decisions and proceed. Run tests after every edit; do not stop until done or interrupted.`;
  }

  const result = await engine.run(task, context);

  await engine.stop();

  return {
    ok: result.ok,
    output: result.output,
    plan: result.plan,
    events: result.events,
    totalMs: result.totalMs,
    totalTokens: result.totalTokens,
    episodeId: result.episodeId,
  };
}

/**
 * Format v4 events for terminal display.
 *
 * Produces a clean, single-line summary for each event. Designed for
 * one-shot CLI mode where events stream to the user's terminal.
 */
export function formatEvent(e: CognitiveEvent): string {
  return summarize(e);
}

/**
 * Print a result to terminal in a clean way.
 */
export function printResult(result: { output: string; totalMs: number; totalTokens: number; events: CognitiveEvent[] }): void {
  console.log("\n" + "─".repeat(60));
  console.log(`✧ Output:\n${result.output}`);
  console.log("─".repeat(60));
  console.log(`✧ Stats: ${result.totalMs}ms, ${result.totalTokens} tokens, ${result.events.length} events`);
}
