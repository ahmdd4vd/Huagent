/**
 * Huagent Engine — unified 6-stage workflow.
 *
 * STAGES:
 *   1. UNDERSTAND — classify task, recall memory, build context
 *   2. PLAN       — generate structured plan via LLM
 *   3. EXECUTE    — run plan steps (parallel where possible) with tool result feedback
 *   4. VERIFY     — critic scores 5 dimensions
 *   5. REFINE     — LLM-guided re-execution of failed steps (max 3x)
 *   6. REFLECT    — extract lessons, update memory
 *
 * All stages emit events for TUI display.
 */

import { UnifiedClient, type StreamEvent } from '../providers/client.js';
import { MemoryManager } from '../memory/manager.js';
import { ToolRegistry } from '../tools/index.js';
import { SessionManager } from '../sessions.js';
import { getHooks } from '../hooks.js';
import { getOrchestrator, type SubagentType } from '../agents/subagent.js';
import { Planner } from './planner.js';
import { Critic, type CritiqueResult } from './critic.js';
import { Reflector } from './reflector.js';
import { prompts, reasoningTemplates } from '../llm/prompt.js';
import { estimateMemory, estimateTokens, shouldCompact } from '../memory/pressure.js';
import { compressSummary } from '../summary.js';
import type { Message, Plan, PlanStep, ToolCall, TaskType, ComplexityLevel } from '../types/index.js';
export type { Plan, PlanStep };
import { nanoid } from 'nanoid';
import { WikiStore } from '../wllm/graph/wiki-store.js';
import { WikiMemory } from './wiki-memory.js';
import { Evolver } from '../wllm/evolve/evolver.js';

// ═══════════════════════════════════════════════════════════════
// ENGINE EVENTS
// ═══════════════════════════════════════════════════════════════
export type EngineEvent =
  | { type: 'stage'; stage: string; status: 'start' | 'end'; detail?: string }
  | { type: 'thinking'; content: string }
  | { type: 'plan_created'; plan: Plan }
  | { type: 'plan_approved'; plan: Plan }
  | { type: 'plan_rejected'; plan: Plan; reason?: string }
  | { type: 'step_start'; step: PlanStep }
  | { type: 'step_done'; step: PlanStep; result: any }
  | { type: 'step_failed'; step: PlanStep; error: string }
  | { type: 'step_skipped'; step: PlanStep; reason: string }
  | { type: 'tool_call'; call: ToolCall }
  | { type: 'tool_result'; call: ToolCall; result: any }
  | { type: 'critique'; verdict: 'pass' | 'refine' | 'fail'; scores: any; overall: number; feedback: string }
  | { type: 'refining'; iteration: number; reason: string }
  | { type: 'message'; message: Message }
  | { type: 'stream_delta'; delta: string; accumulated: string }
  | { type: 'subagent_start'; id: string; subagentType: SubagentType }
  | { type: 'subagent_done'; id: string; output: string }
  | { type: 'compact'; before: number; after: number }
  | { type: 'reflection'; learned: string }
  | { type: 'question'; request: QuestionRequest }
  | { type: 'permission'; request: PermissionRequest }
  | { type: 'session_resumed'; sessionId: string; messageCount: number };

export interface QuestionRequest {
  id: string;
  questions: Array<{
    question: string;
    header: string;
    options: Array<{ label: string; description?: string }>;
    multiSelect?: boolean;
  }>;
}

export type PermissionDecisionType = 'allow' | 'deny' | 'allow-always' | 'deny-always';

export interface PermissionRequest {
  id: string;
  tool: string;
  args: any;
  preview: string;
  reason: string;
}

export interface EngineOptions {
  maxRefinements?: number;
  enableCritic?: boolean;
  enablePlanning?: boolean;
  enableSubagents?: boolean;
  enableReflection?: boolean;
  maxSteps?: number;
  /** Cheaper/faster model for critique calls (saves cost on verification). */
  criticModel?: string;
  /** Max tokens for system prompt before trimming (default: 8000). */
  systemPromptBudget?: number;
  onEvent?: (event: EngineEvent) => void;
  onQuestion?: (request: QuestionRequest) => Promise<string[][]>;
  onPermissionRequest?: (request: PermissionRequest) => Promise<PermissionDecisionType>;
  onPlanReview?: (plan: Plan) => Promise<'approve' | 'reject' | 'edit'>;
}

const STAGES = [
  '🧠 UNDERSTAND',
  '🗺️ PLAN',
  '⚡ EXECUTE',
  '✅ VERIFY',
  '🔄 REFINE',
  '💡 REFLECT',
] as const;

// ═══════════════════════════════════════════════════════════════
// ENGINE
// ═══════════════════════════════════════════════════════════════
export class Engine {
  private client: UnifiedClient;
  private memory: MemoryManager | WikiMemory;
  private tools: ToolRegistry;
  private sessions: SessionManager;
  private hooks = getHooks();
  private orchestrator = getOrchestrator();
  private planner: Planner;
  private critic: Critic;
  private reflector: Reflector;
  private options: Required<EngineOptions>;
  private messages: Message[] = [];
  private systemPrompt: string = '';
  private currentSessionId: string;
  private stats = {
    tasksCompleted: 0,
    refinements: 0,
    totalTokens: 0,
    subagentsSpawned: 0,
  };

  constructor(
    client: UnifiedClient,
    memory: MemoryManager | WikiStore,
    tools: ToolRegistry,
    sessions: SessionManager,
    options: EngineOptions = {}
  ) {
    this.client = client;
    // Support both MemoryManager and WikiStore
    if (memory instanceof WikiStore) {
      this.memory = new WikiMemory(memory);
    } else {
      this.memory = memory;
    }
    this.tools = tools;
    this.sessions = sessions;
    this.planner = new Planner(client);
    this.critic = new Critic(client, options.criticModel);
    this.reflector = new Reflector(this.memory as any);
    this.options = {
      maxRefinements: options.maxRefinements ?? 3,
      // PERF: Disable planning/critic/reflection by default for speed.
      // These add 3-4 extra LLM calls per task (2-10s each). OpenCode
      // doesn't use them — it streams directly with tools. Enable
      // explicitly via options for workflows that need them.
      enableCritic: options.enableCritic ?? false,
      enablePlanning: options.enablePlanning ?? false,
      enableSubagents: options.enableSubagents ?? false,
      enableReflection: options.enableReflection ?? false,
      maxSteps: options.maxSteps ?? 15,
      criticModel: options.criticModel ?? '',
      systemPromptBudget: options.systemPromptBudget ?? 8000,
      onEvent: options.onEvent ?? (() => {}),
      onQuestion: options.onQuestion ?? (async () => []),
      onPermissionRequest: options.onPermissionRequest ?? (async () => 'allow'),
      onPlanReview: options.onPlanReview ?? (async () => 'approve'),
    };

    this.currentSessionId = this.sessions.startSession(process.cwd());
  }

  getClient(): UnifiedClient { return this.client; }
  setModel(model: string): void { this.client.setModel(model); }
  setCriticModel(model: string): void { this.critic.setCriticModel(model); }
  setProvider(providerId: string, apiKey: string, baseUrl?: string, model?: string): void {
    this.client.setProvider(providerId as any, apiKey, baseUrl, model);
  }

  async askUser(request: Omit<QuestionRequest, 'id'>): Promise<string[][]> {
    const id = `q-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const fullRequest: QuestionRequest = { id, ...request };
    this.options.onEvent({ type: 'question', request: fullRequest });
    return this.options.onQuestion(fullRequest);
  }

  async requestPermission(tool: string, args: any, preview: string, reason: string): Promise<PermissionDecisionType> {
    const id = `p-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const request: PermissionRequest = { id, tool, args, preview, reason };
    this.options.onEvent({ type: 'permission', request });
    return this.options.onPermissionRequest(request);
  }

  setOptions(opts: Partial<EngineOptions>): void {
    Object.assign(this.options, opts);
    if (opts.criticModel !== undefined) this.critic.setCriticModel(opts.criticModel);
  }

  getMessages(): Message[] { return this.messages; }
  getSystemPrompt(): string { return this.systemPrompt; }
  getStats() { return { ...this.stats, ...this.client.getStats() }; }

  // ═══════════════════════════════════════════════════════════
  // MAIN ENTRY
  // ═══════════════════════════════════════════════════════════
  async process(userMessage: string, projectContext: string = ''): Promise<string> {
    const startTime = Date.now();

    // PERF: Fire hooks without await — they shouldn't block the LLM call.
    this.hooks.emit('UserPrompt', { message: userMessage, sessionId: this.currentSessionId }).catch(() => {});

    const userMsg: Message = {
      id: nanoid(),
      role: 'user',
      content: userMessage,
      timestamp: Date.now(),
    };
    this.messages.push(userMsg);
    this.options.onEvent({ type: 'message', message: userMsg });

    // STAGE 1: UNDERSTAND
    const understand = await this.stage1_understand(userMessage, projectContext);

    // PERF: Skip memory pressure check for short conversations (< 20 messages).
    // The check itself is fast, but shouldCompact + compactMemory can trigger
    // expensive summary generation. For typical chat sessions, this is wasted work.
    if (this.messages.length > 20) {
      const memStats = estimateMemory(this.messages, this.systemPrompt);
      const pressure = shouldCompact(memStats);
      if (pressure !== 'none') {
        await this.compactMemory(pressure);
      }
    }

    let response: string;
    let finalPlan: Plan | null = null;
    let finalCritique: CritiqueResult | null = null;

    // Decide path: plan-and-execute vs chat.
    // 'trivial' and 'simple' tasks go through the fast chat path
    // (streamAgenticChat — single LLM call). Only 'moderate' and 'complex'
    // tasks go through the full 6-stage plan-and-execute pipeline
    // (planner + critic + reflector = 3-4 extra LLM calls).
    if (this.options.enablePlanning && understand.complexity !== 'trivial' && understand.complexity !== 'simple') {
      // Spawn subagent if needed (research/exploration tasks)
      if (understand.needsSubagent) {
        response = await this.runWithSubagent(userMessage, understand);
      } else {
        // STAGE 2: PLAN
        const plan = await this.stage2_plan(userMessage, understand);

        // Plan review
        const review = await this.options.onPlanReview(plan);
        if (review === 'reject') {
          this.options.onEvent({ type: 'plan_rejected', plan, reason: 'user rejected' });
          const replan = await this.stage2_plan(userMessage, understand);
          plan.goal = replan.goal;
          plan.steps = replan.steps;
          plan.taskType = replan.taskType;
          plan.complexity = replan.complexity;
          plan.status = replan.status;
          this.options.onEvent({ type: 'plan_approved', plan });
        } else {
          this.options.onEvent({ type: 'plan_approved', plan });
        }

        // STAGE 3: EXECUTE
        await this.stage3_execute(plan);

        // STAGE 4-5: VERIFY + REFINE
        let critique = this.options.enableCritic
          ? await this.stage4_verify(plan)
          : { verdict: 'pass' as const, scores: { correctness: 5, completeness: 5, quality: 5, safety: 5, efficiency: 5 }, overall: 5, feedback: 'Critic disabled', issues: [], suggestions: [] };

        let iterations = 0;
        while (critique.verdict === 'refine' && iterations < this.options.maxRefinements) {
          iterations++;
          await this.stage5_refine(plan, critique, iterations);
          if (this.options.enableCritic) {
            critique = await this.stage4_verify(plan);
          }
        }

        finalPlan = plan;
        finalCritique = critique;
        plan.status = critique.verdict === 'pass' ? 'completed' : critique.verdict === 'fail' ? 'failed' : 'completed';

        response = this.formatPlanResponse(plan, critique);

        // STAGE 6: REFLECT
        if (this.options.enableReflection) {
          await this.stage6_reflect(plan, critique);
        }
      }
    } else {
      // Simple chat path with agentic tool loop
      response = await this.streamAgenticChat();
    }

    this.stats.tasksCompleted++;
    // NOTE: We do NOT add `finalPlan.refinements` to `this.stats.refinements`
    // here because `stage5_refine` already increments `this.stats.refinements`
    // directly (see lines ~532-533). Adding it again here would double-count
    // (N refinements → 2N in stats). The previous code did `this.stats.refinements
    // += finalPlan.refinements`, which produced inflated counts.

    // PERF: Fire post-call hooks without await.
    this.hooks.emit('PostLLMCall', { response, messageCount: this.messages.length, durationMs: Date.now() - startTime }).catch(() => {});
    this.hooks.emit('AssistantReply', { response: response.slice(0, 500), sessionId: this.currentSessionId }).catch(() => {});

    return response;
  }

  // ═══════════════════════════════════════════════════════════
  // STAGE 1: UNDERSTAND
  // ═══════════════════════════════════════════════════════════
  private async stage1_understand(message: string, projectContext: string): Promise<{ taskType: TaskType; complexity: ComplexityLevel; needsSubagent: boolean }> {
    this.options.onEvent({ type: 'stage', stage: STAGES[0], status: 'start' });

    // Fast path: regex classification only. NEVER call LLM for task
    // classification — that's an extra 2-5s round-trip. OpenCode doesn't
    // classify tasks at all; it just streams. We classify for stats/memory
    // but use regex only. 'unknown' is treated as 'question'.
    let taskType = this.detectTaskTypeRegex(message);
    if (taskType === 'unknown') taskType = 'question';

    const complexity = this.detectComplexity(message, taskType);
    const needsSubagent = this.shouldUseSubagent(taskType, complexity, message);

    // PERF: Memory recall can be slow (SQLite query). Only do it if the
    // memory store has entries. For fresh sessions with 0 memories, skip
    // the query entirely.
    let memoryContext = '';
    try {
      const memStats = await Promise.resolve(this.memory.stats?.());
      if (memStats && ((memStats as any).memories > 0 || (memStats as any).skills > 0)) {
        const relevantMemories = await Promise.resolve(this.memory.recall(message, 3));
        if (relevantMemories.length > 0) {
          memoryContext = `\nRelevant memories:\n${relevantMemories.map(m => `- ${m.content.slice(0, 150)}`).join('\n')}\n`;
        }
      }
    } catch {
      // Memory recall failed — continue without it.
    }

    this.options.onEvent({
      type: 'thinking',
      content: `Task: ${taskType} | Complexity: ${complexity}${memoryContext ? ' | Memories: yes' : ''}`
    });

    // Build system prompt with token budget awareness
    this.systemPrompt = this.buildSystemPrompt(projectContext, memoryContext);

    this.options.onEvent({ type: 'stage', stage: STAGES[0], status: 'end' });
    return { taskType, complexity, needsSubagent };
  }

  /** Build system prompt with token budget management. */
  private buildSystemPrompt(projectContext: string, memoryContext: string): string {
    const toolsList = this.tools.list().map(t => `  - ${t.name}: ${t.description.split('\n')[0]}`).join('\n');

    // Detect platform for the system prompt
    const isWindows = process.platform === 'win32';
    const platformInfo = isWindows
      ? `\nPlatform: Windows. The bash tool auto-translates Unix commands (ls→dir, cat→type, grep→findstr). You can use Unix commands directly.`
      : `\nPlatform: ${process.platform}.`;

    let prompt = `You are Hua, an AI coding agent.${projectContext ? ` Working in: ${projectContext}` : ''}${platformInfo}${memoryContext}

You have tools available. USE THEM to take action — don't just talk about what you would do. When the user asks you to install, run, read, write, search, or execute something, call the appropriate tool immediately.

Available tools:
${toolsList}

Rules:
- When asked to run a command, USE the bash tool directly.
- When asked to read a file, USE the read tool directly.
- When asked to write code, USE the write or edit tool directly.
- Don't say "I can't access the terminal" — you CAN via the bash tool.
- Don't ask for permission to use tools — just use them.
- Be concise. Show results. Ship working code.`;

    // Token budget: trim if too long
    const budget = this.options.systemPromptBudget;
    const estimated = estimateTokens(prompt);
    if (estimated > budget) {
      // Trim to bare minimum — just the agent identity + tool list.
      prompt = `You are Hua, a coding agent. Use tools when needed. Be concise.

Available tools:
${toolsList}`;
    }

    return prompt;
  }

  // ═══════════════════════════════════════════════════════════
  // STAGE 2: PLAN
  // ═══════════════════════════════════════════════════════════
  private async stage2_plan(userMessage: string, understand: { taskType: TaskType; complexity: ComplexityLevel }): Promise<Plan> {
    this.options.onEvent({ type: 'stage', stage: STAGES[1], status: 'start' });
    await this.hooks.emit('PreLLMCall', { stage: 'plan', model: this.client.getModel() });

    const plan = await this.planner.plan({
      request: userMessage,
      availableTools: this.tools.list().map(t => t.name),
      taskType: understand.taskType,
    });

    plan.taskType = understand.taskType;
    plan.complexity = understand.complexity;

    this.options.onEvent({ type: 'plan_created', plan });
    this.options.onEvent({
      type: 'thinking',
      content: `🗺️ Plan: ${plan.steps.length} steps | ${plan.complexity} | ${plan.taskType}`
    });
    this.options.onEvent({ type: 'stage', stage: STAGES[1], status: 'end', detail: `${plan.steps.length} steps` });

    return plan;
  }

  // ═══════════════════════════════════════════════════════════
  // STAGE 3: EXECUTE (with tool result feedback)
  // ═══════════════════════════════════════════════════════════
  private async stage3_execute(plan: Plan): Promise<void> {
    this.options.onEvent({ type: 'stage', stage: STAGES[2], status: 'start' });
    plan.status = 'executing';

    const groups = new Map<number, PlanStep[]>();
    for (const step of plan.steps) {
      const g = step.parallel_group ?? 0;
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g)!.push(step);
    }

    const sortedGroups = [...groups.entries()].sort(([a], [b]) => a - b);

    for (const [groupNum, steps] of sortedGroups) {
      if (steps.length === 1) {
        await this.executeStep(plan, steps[0]);
      } else {
        this.options.onEvent({
          type: 'thinking',
          content: `⚡ Running ${steps.length} steps in parallel (group ${groupNum})`
        });
        await Promise.all(steps.map((s) => this.executeStep(plan, s)));
      }
    }

    this.options.onEvent({ type: 'stage', stage: STAGES[2], status: 'end' });
  }

  /** Execute a single step with dependency checking. */
  private async executeStep(plan: Plan, step: PlanStep): Promise<void> {
    // Check dependencies: skip if any dependency failed
    if (step.depends_on && step.depends_on.length > 0) {
      for (const depIdx of step.depends_on) {
        const depStep = plan.steps[depIdx];
        if (depStep && depStep.status === 'failed') {
          step.status = 'skipped';
          step.error = `Skipped: dependency step ${depIdx + 1} ("${depStep.description}") failed`;
          this.options.onEvent({ type: 'step_skipped', step, reason: step.error });
          return;
        }
      }
    }

    this.options.onEvent({ type: 'step_start', step });
    step.status = 'running';
    const start = Date.now();

    await this.hooks.emit('PreToolUse', { name: step.tool, args: step.args });

    try {
      let result: any;

      if (step.tool) {
        const call: ToolCall = { id: nanoid(), name: step.tool, args: step.args || {} };
        this.options.onEvent({ type: 'tool_call', call });

        if (call.name === 'memory') {
          result = await this.handleMemoryTool(call.args);
        } else {
          result = await this.tools.execute(call.name, call.args);
        }

        this.options.onEvent({ type: 'tool_result', call, result });

        // Feed tool result back into conversation context
        const resultSummary = this.formatToolResult(call.name, result);
        this.messages.push({
          id: nanoid(),
          role: 'tool',
          content: `[${call.name}] ${resultSummary}`,
          timestamp: Date.now(),
        });

        await this.hooks.emit('PostToolUse', {
          name: call.name,
          args: call.args,
          result,
          error: result?.error
        });
      } else {
        result = { thought: step.description };
      }

      step.status = 'done';
      step.result = result;
      step.duration = Date.now() - start;
      this.options.onEvent({ type: 'step_done', step, result });
    } catch (err: any) {
      step.status = 'failed';
      step.error = err.message;
      this.options.onEvent({ type: 'step_failed', step, error: err.message });
      await this.hooks.emit('Error', { source: 'plan_step', error: err.message });
    }
  }

  /** Format a tool result for inclusion in conversation context. */
  private formatToolResult(toolName: string, result: any): string {
    if (!result) return 'no result';
    // PERF: Increased from 500 to 5000 chars. The previous 500-char limit
    // was too aggressive — file contents, bash output, and search results
    // were truncated so heavily that the LLM couldn't see enough context
    // to act on them. OpenCode sends up to 10k chars to the LLM.
    const MAX_RESULT = 5000;
    if (typeof result === 'string') return result.slice(0, MAX_RESULT);
    if (result.error) return `ERROR: ${result.error}`;
    if (result.content) return String(result.content).slice(0, MAX_RESULT);
    if (result.stdout) return result.stdout.slice(0, MAX_RESULT);
    if (result.output) return String(result.output).slice(0, MAX_RESULT);
    return JSON.stringify(result).slice(0, MAX_RESULT);
  }

  // ═══════════════════════════════════════════════════════════
  // STAGE 4: VERIFY
  // ═══════════════════════════════════════════════════════════
  private async stage4_verify(plan: Plan): Promise<CritiqueResult> {
    this.options.onEvent({ type: 'stage', stage: STAGES[3], status: 'start' });
    const critique = await this.critic.critique(plan);
    plan.critique = critique.feedback;
    this.options.onEvent({
      type: 'critique',
      verdict: critique.verdict,
      scores: critique.scores,
      overall: critique.overall,
      feedback: critique.feedback
    });
    this.options.onEvent({
      type: 'thinking',
      content: `✅ Verdict: ${critique.verdict.toUpperCase()} (${critique.overall.toFixed(1)}/5)`
    });
    this.options.onEvent({ type: 'stage', stage: STAGES[3], status: 'end' });
    return critique;
  }

  // ═══════════════════════════════════════════════════════════
  // STAGE 5: REFINE (smart — only re-execute truly failed steps)
  // ═══════════════════════════════════════════════════════════
  private async stage5_refine(plan: Plan, critique: CritiqueResult, iteration: number): Promise<void> {
    this.options.onEvent({ type: 'stage', stage: STAGES[4], status: 'start' });
    plan.refinements++;
    this.stats.refinements++;

    const reason = critique.issues.length > 0
      ? critique.issues[0]
      : critique.feedback.slice(0, 100);

    this.options.onEvent({ type: 'refining', iteration, reason });
    this.options.onEvent({
      type: 'thinking',
      content: `🔄 Refining (iteration ${iteration}/${this.options.maxRefinements}): ${reason}`
    });

    // Only re-execute steps that actually failed — don't re-run correct steps
    const failedSteps = plan.steps.filter((s) => s.status === 'failed');

    // If no failed steps but critique says refine, use LLM to generate corrective actions
    if (failedSteps.length === 0 && critique.issues.length > 0) {
      this.options.onEvent({
        type: 'thinking',
        content: `🔄 No failed steps — using critic feedback to generate corrective actions`
      });
      // Add critic feedback as context for next execution attempt
      this.messages.push({
        id: nanoid(),
        role: 'user',
        content: `The critic found these issues:\n${critique.issues.map(i => `- ${i}`).join('\n')}\n\nPlease fix these issues.`,
        timestamp: Date.now(),
      });
    }

    for (const step of failedSteps.slice(0, 3)) {
      this.options.onEvent({
        type: 'thinking',
        content: `🔄 Re-executing: ${step.description}`
      });
      step.status = 'pending';
      step.error = undefined;
      await this.executeStep(plan, step);
    }

    this.options.onEvent({ type: 'stage', stage: STAGES[4], status: 'end' });
  }

  // ═══════════════════════════════════════════════════════════
  // STAGE 6: REFLECT
  // ═══════════════════════════════════════════════════════════
  private async stage6_reflect(plan: Plan, critique: CritiqueResult): Promise<void> {
    this.options.onEvent({ type: 'stage', stage: STAGES[5], status: 'start' });

    if (critique.verdict === 'pass' || critique.overall >= 3.5) {
      await this.reflector.reflectSuccess(plan, critique);
    } else {
      await this.reflector.reflectFailure(plan, critique);
    }

    this.memory.recordEpisode(
      `Task: ${plan.taskType} | ${plan.goal.slice(0, 100)} | Score: ${critique.overall.toFixed(1)}`,
      { taskType: plan.taskType, score: critique.overall, complexity: plan.complexity },
      Math.min(1.0, 0.5 + critique.overall / 10)
    );

    const learnedSummary = critique.overall >= 4.5
      ? `Extracted pattern for ${plan.taskType}`
      : critique.verdict === 'fail'
        ? `Recorded anti-pattern from failure`
        : `Recorded as moderate success`;

    this.options.onEvent({ type: 'reflection', learned: learnedSummary });
    this.options.onEvent({ type: 'stage', stage: STAGES[5], status: 'end' });
  }

  // ═══════════════════════════════════════════════════════════
  // SUBAGENT INTEGRATION
  // ═══════════════════════════════════════════════════════════

  /** Run a task using a subagent for research/exploration. */
  private async runWithSubagent(message: string, understand: { taskType: TaskType }): Promise<string> {
    const subagentType: SubagentType = understand.taskType === 'research'
      ? 'code-explorer'
      : understand.taskType === 'code_read'
        ? 'code-explorer'
        : 'general-purpose';

    this.options.onEvent({
      type: 'thinking',
      content: `🤖 Spawning subagent (${subagentType}) for ${understand.taskType} task`
    });

    try {
      const result = await this.runSubagent(subagentType, message);

      // Add subagent result to conversation
      this.messages.push({
        id: nanoid(),
        role: 'assistant',
        content: result,
        timestamp: Date.now(),
      });
      this.options.onEvent({ type: 'message', message: this.messages[this.messages.length - 1] });

      return result;
    } catch (err: any) {
      // Fallback to simple chat if subagent fails
      this.options.onEvent({
        type: 'thinking',
        content: `⚠️ Subagent failed (${err.message}), falling back to direct execution`
      });
      return this.streamAgenticChat();
    }
  }

  // ═══════════════════════════════════════════════════════════
  // AGENTIC CHAT (tool loop with result feedback)
  // ═══════════════════════════════════════════════════════════

  /**
   * Agentic chat loop: stream LLM response, execute tool calls,
   * feed results back, continue until LLM produces final answer.
   * Max 5 tool-call rounds to prevent infinite loops.
   */
  private async streamAgenticChat(): Promise<string> {
    this.options.onEvent({ type: 'stage', stage: STAGES[2], status: 'start' });
    this.options.onEvent({ type: 'thinking', content: 'thinking' });

    let fullResponse = '';
    const MAX_TOOL_ROUNDS = 10;

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const pendingToolCalls: Array<{ id: string; name: string; args: any }> = [];
      let roundResponse = '';

      // Clear streaming text between rounds so the TUI doesn't show
      // the previous round's text while tools are executing.
      if (round > 0) {
        this.options.onEvent({ type: 'stream_delta', delta: '', accumulated: '' });
      }

      // CRITICAL FIX: Properly format messages for OpenAI API.
      // Previously, messages were mapped to just { role, content },
      // which STRIPPED tool_calls from assistant messages and
      // tool_call_id from tool messages. The LLM couldn't see the
      // conversation history with tools → it got confused and refused
      // to call tools in subsequent rounds.
      const apiMessages = this.messages.map((m) => {
        const msg: any = { role: m.role, content: m.content };

        // Include tool_calls for assistant messages that have them
        if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
          msg.tool_calls = m.toolCalls.map((tc) => ({
            id: tc.id,
            type: 'function',
            function: {
              name: tc.name,
              arguments: typeof tc.args === 'string' ? tc.args : JSON.stringify(tc.args || {}),
            },
          }));
        }

        // Include tool_call_id for tool role messages
        if (m.role === 'tool' && m.toolCallId) {
          msg.tool_call_id = m.toolCallId;
        }

        return msg;
      });

      for await (const event of this.client.stream({
        model: this.client.getModel(),
        system: this.systemPrompt,
        messages: apiMessages,
        tools: this.tools.getSchemas(),
        temperature: 0.7,
      })) {
        if (event.type === 'text_delta') {
          roundResponse = event.accumulated;
          this.options.onEvent({ type: 'stream_delta', delta: event.delta, accumulated: event.accumulated });
        } else if (event.type === 'tool_use') {
          pendingToolCalls.push({ id: event.id, name: event.name, args: event.args });
          // Emit tool_call event immediately so TUI shows it inline
          this.options.onEvent({
            type: 'tool_call',
            call: { id: event.id, name: event.name, args: event.args },
          });
        } else if (event.type === 'message_stop') {
          break;
        } else if (event.type === 'error') {
          throw new Error(event.error);
        }
      }

      fullResponse = roundResponse;

      // If no tool calls, we're done — LLM gave a final answer
      if (pendingToolCalls.length === 0) break;

      // Add assistant message with tool calls to conversation history
      this.messages.push({
        id: nanoid(),
        role: 'assistant',
        content: roundResponse,
        timestamp: Date.now(),
        toolCalls: pendingToolCalls.map(tc => ({ id: tc.id, name: tc.name, args: tc.args })),
      });

      // Execute tool calls and feed results back
      for (const tc of pendingToolCalls) {
        const call: ToolCall = { id: tc.id, name: tc.name, args: tc.args };

        let result: any;
        try {
          if (tc.name === 'memory') {
            result = await this.handleMemoryTool(tc.args);
          } else {
            const execResult = await this.tools.execute(tc.name, tc.args);
            result = execResult.success ? execResult.result : { error: execResult.error };
          }
          this.options.onEvent({ type: 'tool_result', call, result });
        } catch (err: any) {
          result = { error: err.message };
          this.options.onEvent({ type: 'tool_result', call, result });
        }

        // Add tool result to conversation with proper tool_call_id
        // so the LLM can match it to the original tool call
        this.messages.push({
          id: nanoid(),
          role: 'tool',
          content: this.formatToolResult(tc.name, result),
          timestamp: Date.now(),
          toolCallId: tc.id,
        } as any);
      }

      // Continue loop — LLM will see tool results and decide next action
    }

    // Add final assistant message
    const assistantMsg: Message = {
      id: nanoid(),
      role: 'assistant',
      content: fullResponse,
      timestamp: Date.now(),
    };
    this.messages.push(assistantMsg);
    this.options.onEvent({ type: 'message', message: assistantMsg });
    this.options.onEvent({ type: 'stage', stage: STAGES[2], status: 'end' });

    return fullResponse;
  }

  // ═══════════════════════════════════════════════════════════
  // TASK CLASSIFICATION
  // ═══════════════════════════════════════════════════════════

  /** Fast regex-based classification. Returns 'unknown' if ambiguous. */
  private detectTaskTypeRegex(message: string): TaskType {
    const m = message.toLowerCase().trim();

    // FAST PATH: greetings and small talk → 'question' (trivial, no LLM call needed)
    // This prevents the engine from making an extra LLM call just to classify
    // "halo", "hi", "thanks", etc. as 'unknown' → triggering detectTaskTypeLLM.
    const GREETING_PATTERNS = /^(halo|hai|hi|hello|hey|sup|pagi|siang|sore|malam|thanks|terima kasih|makasih|oke|ok|yes|no|iya|nggak|gak|ya|tidak)\b/i;
    if (GREETING_PATTERNS.test(m) && m.split(/\s+/).length < 15) return 'question';

    if (/\b(what does|show me|read|explain|describe|inspect|find|where is)\b/.test(m)) return 'code_read';
    if (/\b(fix|bug|error|broken|fail|crash|debug)\b/.test(m)) return 'code_fix';
    if (/\b(refactor|clean up|improve|optimize|restructure)\b/.test(m)) return 'code_refactor';
    if (/\b(run|execute|build|deploy|install|test|start)\b/.test(m)) return 'action';
    if (/\b(what|how|why|when|where|who)\b/.test(m) && message.length < 100) return 'question';
    if (/\b(search|find|research|investigate)\b/.test(m)) return 'research';
    if (/\b(create|build|add|implement|write|make)\b/.test(m)) return 'code_write';
    return 'unknown';
  }

  /** LLM-based classification for ambiguous messages. */
  private async detectTaskTypeLLM(message: string): Promise<TaskType> {
    try {
      let text = '';
      for await (const event of this.client.stream({
        model: this.options.criticModel || this.client.getModel(),
        system: 'Classify this coding task into exactly ONE category. Reply with ONLY the category name.\nCategories: code_write, code_read, code_fix, code_refactor, question, research, action',
        messages: [{ role: 'user', content: message }],
        temperature: 0.1,
        maxTokens: 20,
      })) {
        if (event.type === 'text_delta') text = event.accumulated;
        if (event.type === 'message_stop') break;
      }

      const cleaned = text.trim().toLowerCase().replace(/[^a-z_]/g, '');
      const validTypes: TaskType[] = ['code_write', 'code_read', 'code_fix', 'code_refactor', 'question', 'research', 'action'];
      if (validTypes.includes(cleaned as TaskType)) return cleaned as TaskType;
    } catch {
      // Fallback on LLM failure
    }
    return 'unknown';
  }

  private detectComplexity(message: string, taskType: TaskType): ComplexityLevel {
    // FAST PATH: questions and greetings under 60 chars → 'trivial'.
    // This skips the entire plan-and-execute pipeline (planner LLM call,
    // critic LLM call, reflector LLM call) and goes straight to
    // streamAgenticChat (single LLM call). The previous threshold was
    // 30 chars which was too tight — "halo, kenalin nama saya david"
    // is 34 chars and fell through to 'simple', triggering the full
    // 6-stage workflow for a simple greeting.
    if (message.length < 60 && (taskType === 'question' || taskType === 'code_read')) return 'trivial';
    const words = message.split(/\s+/).length;
    if (words < 8) return 'simple';
    if (words < 25) return 'moderate';
    return 'complex';
  }

  private shouldUseSubagent(taskType: TaskType, complexity: ComplexityLevel, message: string): boolean {
    if (!this.options.enableSubagents) return false;
    if (taskType === 'research' && complexity === 'complex') return true;
    if (taskType === 'code_read' && message.length > 200) return true;
    return false;
  }

  // ═══════════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════════

    private async handleMemoryTool(args: any): Promise<any> {
    switch (args.action) {
      case 'save':
        this.memory.recordEpisode(args.content || '', { type: args.type || 'episodic' }, 0.5);
        return { action: 'save', status: 'ok', message: 'Memory saved' };
      case 'recall': {
        const memories = await Promise.resolve(this.memory.recall(args.query || '', 5));
        return { action: 'recall', status: 'ok', memories: memories.map(m => ({ type: m.type, content: m.content.slice(0, 200) })) };
      }
      case 'fact':
        this.memory.saveProjectFact(args.key || '', args.value || '');
        return { action: 'fact', status: 'ok', message: `Fact saved: ${args.key}` };
      case 'skill':
        this.memory.recordPattern(args.name || 'learned', args.description || '', args.pattern || '', []);
        return { action: 'skill', status: 'ok', message: `Skill learned: ${args.name}` };
      default:
        return { action: args.action, status: 'error', message: `Unknown memory action: ${args.action}` };
    }
  }

  private formatPlanResponse(plan: Plan, critique: CritiqueResult): string {
    const steps = plan.steps.map((s, i) => {
      const icon = s.status === 'done' ? '✓' : s.status === 'failed' ? '✗' : s.status === 'skipped' ? '⊘' : '○';
      const duration = s.duration ? ` (${s.duration}ms)` : '';
      return `${icon} ${i + 1}. ${s.description}${duration}`;
    }).join('\n');

    const emoji = critique.verdict === 'pass' ? '✨' : critique.verdict === 'refine' ? '🔄' : '⚠️';
    const verdictLine = `${emoji} Score: ${critique.overall.toFixed(1)}/5 (${critique.verdict})`;

    let output = `✨ **Plan executed:** ${plan.goal}\n\n${steps}\n\n${verdictLine}`;

    if (critique.issues.length > 0) {
      output += `\n\n**Issues:**\n${critique.issues.map((i) => `- ${i}`).join('\n')}`;
    }
    if (critique.suggestions.length > 0) {
      output += `\n\n**Suggestions:**\n${critique.suggestions.map((s) => `- ${s}`).join('\n')}`;
    }
    if (plan.refinements > 0) {
      output += `\n\n🔄 Refined ${plan.refinements} time(s)`;
    }

    return output;
  }

  /** Compact memory with better context preservation. */
  private async compactMemory(level: 'warning' | 'critical'): Promise<void> {
    const before = this.messages.length;
    await this.hooks.emit('PreCompact', { level, messageCount: before });

    if (level === 'critical') {
      // Keep 10 recent messages (not 6) for better context
      const keepCount = 10;
      const recent = this.messages.slice(-keepCount);
      const old = this.messages.slice(0, -keepCount);

      // Use compressSummary for better quality (preserves more detail per message)
      const compressed = compressSummary(old.map(m => `${m.role}: ${m.content}`).join('\n'), {
        maxChars: 2000,
        maxLines: 40,
        maxLineChars: 200,
      });

      this.messages = [
        {
          id: nanoid(),
          role: 'system',
          content: `## Earlier conversation summary\n${compressed.summary}`,
          timestamp: Date.now(),
        },
        ...recent,
      ];
    } else {
      // Warning: just record to memory, don't compact yet
      const compressed = compressSummary(this.messages.map(m => `${m.role}: ${m.content}`).join('\n'));
      this.memory.recordEpisode(
        `Conversation summary at warning: ${compressed.summary}`,
        { type: 'compaction' },
        0.6
      );
    }

    await this.hooks.emit('PostCompact', { before, after: this.messages.length });
    this.options.onEvent({ type: 'compact', before, after: this.messages.length });
  }

  async runSubagent(type: SubagentType, task: string, context?: string): Promise<string> {
    if (!this.options.enableSubagents) {
      throw new Error('Subagents are disabled');
    }

    const id = nanoid(8);
    this.options.onEvent({ type: 'subagent_start', id, subagentType: type });
    this.stats.subagentsSpawned++;
    await this.hooks.emit('SubagentStart', { id, type, task });

    const result = await this.orchestrator.run({
      type,
      task: context ? `${task}\n\nContext:\n${context}` : task,
      client: this.client,
      parentMessages: this.messages,
    });

    this.options.onEvent({ type: 'subagent_done', id, output: result.output });
    await this.hooks.emit('SubagentEnd', { id, type, status: result.status });

    return result.output;
  }

  async end(): Promise<void> {
    await this.hooks.emit('SessionEnd', {
      sessionId: this.currentSessionId,
      duration: Date.now() - (this.messages[0]?.timestamp || Date.now()),
      messageCount: this.messages.length,
    });

    // Run Evolver if using WikiStore (5-memory system)
    if (this.memory instanceof WikiMemory) {
      try {
        console.log('[Engine] Running Evolver (self-reflection)...');
        const evolver = new Evolver(this.memory.getStore());
        const report = await evolver.evolve();
        console.log(`[Engine] Evolve completed:`);
        console.log(`  Contradictions: ${report.summary.contradictionCount}`);
        console.log(`  Suggestions: ${report.summary.suggestionCount}`);
        console.log(`  Refreshes: ${report.summary.refreshCount}`);
      } catch (error) {
        console.error('[Engine] Evolve failed:', error);
      }
    }

    this.sessions.endSession(this.currentSessionId, `Ended after ${this.messages.length} messages`);
  }

  reset() {
    this.messages = [];
  }
}
