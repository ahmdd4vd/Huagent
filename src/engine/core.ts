// ✦ Smart Engine v2.0: 6-Stage Workflow ✦
// The "smart workflow" that makes dumb models smart
//
// STAGES:
//   1. 🧠 UNDERSTAND  — parse task type, recall memory
//   2. 🗺️ PLAN        — generate structured plan with tool-awareness
//   3. ⚡ EXECUTE     — run plan (parallel where possible) with hooks
//   4. ✅ VERIFY      — critic scores 5 dimensions
//   5. 🔄 REFINE      — loop on failure (max 3x)
//   6. 💡 REFLECT     — extract lessons, update memory
//
// All stages emit events for TUI display.

import { UnifiedClient, type StreamEvent } from '../providers/client.js';
import { MemoryManager } from '../memory/manager.js';
import { ToolRegistry } from '../tools/index.js';
import { SessionManager } from '../sessions.js';
import { getHooks } from '../hooks.js';
import { getOrchestrator, type SubagentType } from '../agents/subagent.js';
import { Planner } from './planner.js';
import { Critic, type CritiqueResult } from './critic.js';
import { Reflector } from './reflector.js';
import { prompts } from '../llm/prompt.js';
import { estimateMemory, shouldCompact } from '../memory/pressure.js';
import { summarizeConversation } from '../summary.js';
import type { Message, Plan, PlanStep, ToolCall, TaskType, ComplexityLevel } from '../types/index.js';
export type { Plan, PlanStep };
import { nanoid } from 'nanoid';

// ═══════════════════════════════════════════════════════════════
// ENGINE EVENTS — what the TUI can render
// ═══════════════════════════════════════════════════════════════
export type EngineEvent =
  | { type: 'stage'; stage: string; status: 'start' | 'end'; detail?: string }   // 6 stages visual
  | { type: 'thinking'; content: string }
  | { type: 'plan_created'; plan: Plan }
  | { type: 'plan_approved'; plan: Plan }
  | { type: 'plan_rejected'; plan: Plan; reason?: string }
  | { type: 'step_start'; step: PlanStep }
  | { type: 'step_done'; step: PlanStep; result: any }
  | { type: 'step_failed'; step: PlanStep; error: string }
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

/** A question the model wants to ask the user mid-execution (OpenCode-style). */
export interface QuestionRequest {
  id: string;
  questions: Array<{
    question: string;
    /** Short header for the question tab (max 12 chars) */
    header: string;
    options: Array<{ label: string; description?: string }>;
    multiSelect?: boolean;
  }>;
}

export type PermissionDecisionType = 'allow' | 'deny' | 'allow-always' | 'deny-always';

/** A tool permission request — fired before executing a potentially dangerous tool. */
export interface PermissionRequest {
  id: string;
  tool: string;
  args: any;
  /** Short human preview of what the tool will do (e.g. file path, command) */
  preview: string;
  /** Why this needs permission */
  reason: string;
}

export interface EngineOptions {
  maxRefinements?: number;
  enableCritic?: boolean;
  enablePlanning?: boolean;
  enableSubagents?: boolean;
  enableReflection?: boolean;
  maxSteps?: number;
  onEvent?: (event: EngineEvent) => void;
  /** Pause + ask the user a multi-option question. Returns selected labels per question. */
  onQuestion?: (request: QuestionRequest) => Promise<string[][]>;
  /** Pause + ask the user for tool permission. Returns their decision. */
  onPermissionRequest?: (request: PermissionRequest) => Promise<PermissionDecisionType>;
  /** Pause + ask the user to approve/reject a generated plan before execution. */
  onPlanReview?: (plan: Plan) => Promise<'approve' | 'reject' | 'edit'>;
}

const STAGES = [
  '🧠 UNDERSTAND',  // 1
  '🗺️ PLAN',        // 2
  '⚡ EXECUTE',     // 3
  '✅ VERIFY',      // 4
  '🔄 REFINE',      // 5
  '💡 REFLECT',     // 6
] as const;

// ═══════════════════════════════════════════════════════════════
// ENGINE — orchestrator
// ═══════════════════════════════════════════════════════════════
export class Engine {
  private client: UnifiedClient;
  private memory: MemoryManager;
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
    memory: MemoryManager,
    tools: ToolRegistry,
    sessions: SessionManager,
    options: EngineOptions = {}
  ) {
    this.client = client;
    this.memory = memory;
    this.tools = tools;
    this.sessions = sessions;
    this.planner = new Planner(client);
    this.critic = new Critic(client);
    this.reflector = new Reflector(memory);
    this.options = {
      maxRefinements: options.maxRefinements ?? 3,
      enableCritic: options.enableCritic ?? true,
      enablePlanning: options.enablePlanning ?? true,
      enableSubagents: options.enableSubagents ?? true,
      enableReflection: options.enableReflection ?? true,
      maxSteps: options.maxSteps ?? 15,
      onEvent: options.onEvent ?? (() => {}),
      onQuestion: options.onQuestion ?? (async () => []),
      onPermissionRequest: options.onPermissionRequest ?? (async () => 'allow'),
      onPlanReview: options.onPlanReview ?? (async () => 'approve'),
    };

    this.currentSessionId = this.sessions.startSession(process.cwd());
  }

  getClient(): UnifiedClient { return this.client; }
  setModel(model: string): void { this.client.setModel(model); }
  setProvider(providerId: string, apiKey: string, baseUrl?: string, model?: string): void {
    this.client.setProvider(providerId as any, apiKey, baseUrl, model);
  }
  /**
   * Ask the user a multi-option question (paused execution). Returns
   * the selected labels, one array per question.
   */
  async askUser(request: Omit<QuestionRequest, 'id'>): Promise<string[][]> {
    const id = `q-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const fullRequest: QuestionRequest = { id, ...request };
    this.options.onEvent({ type: 'question', request: fullRequest });
    return this.options.onQuestion(fullRequest);
  }
  /**
   * Request permission for a tool (paused execution). Returns the
   * user's decision.
   */
  async requestPermission(
    tool: string,
    args: any,
    preview: string,
    reason: string,
  ): Promise<PermissionDecisionType> {
    const id = `p-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const request: PermissionRequest = { id, tool, args, preview, reason };
    this.options.onEvent({ type: 'permission', request });
    return this.options.onPermissionRequest(request);
  }
  /**
   * Update per-call options (e.g. for the next process() invocation).
   * The TUI uses this to inject dialog callbacks for question /
   * permission / plan-review without having to rebuild the engine.
   */
  setOptions(opts: Partial<EngineOptions>): void {
    Object.assign(this.options, opts);
  }
  getMessages(): Message[] { return this.messages; }
  getSystemPrompt(): string { return this.systemPrompt; }
  getStats() { return { ...this.stats, ...this.client.getStats() }; }

  // ═══════════════════════════════════════════════════════════
  // MAIN ENTRY: process a user message
  // ═══════════════════════════════════════════════════════════
  async process(userMessage: string, projectContext: string = ''): Promise<string> {
    const startTime = Date.now();

    // Pre-process hook
    await this.hooks.emit('UserPrompt', { message: userMessage, sessionId: this.currentSessionId });

    // Add user message
    const userMsg: Message = {
      id: nanoid(),
      role: 'user',
      content: userMessage,
      timestamp: Date.now(),
    };
    this.messages.push(userMsg);
    this.options.onEvent({ type: 'message', message: userMsg });

    // ═════════════════════════════════════════════════════════
    // STAGE 1: 🧠 UNDERSTAND
    // ═════════════════════════════════════════════════════════
    const understand = await this.stage1_understand(userMessage, projectContext);

    // Memory pressure check (after adding message)
    const memStats = estimateMemory(this.messages, this.systemPrompt);
    const pressure = shouldCompact(memStats);
    if (pressure !== 'none') {
      await this.compactMemory(pressure);
    }

    let response: string;
    let finalPlan: Plan | null = null;
    let finalCritique: CritiqueResult | null = null;

    // Decide path: chat vs plan-and-execute
    if (this.options.enablePlanning && understand.complexity !== 'trivial') {
      // ═════════════════════════════════════════════════════════
      // STAGE 2: 🗺️ PLAN
      // ═════════════════════════════════════════════════════════
      const plan = await this.stage2_plan(userMessage, understand);

      // ── Interactive plan review (OpenCode-style) ────────────
      // Pause here so the user can approve / reject / edit the plan
      // before we touch any tools.
      const review = await this.options.onPlanReview(plan);
      if (review === 'reject') {
        this.options.onEvent({ type: 'plan_rejected', plan, reason: 'user rejected' });
        // Replan by re-running stage 2 with feedback
        const replan = await this.stage2_plan(userMessage, understand);
        Object.assign(plan, replan);
        this.options.onEvent({ type: 'plan_approved', plan });
      } else if (review === 'edit') {
        // User edited — for now we accept the edited plan as-is.
        // (Full plan-editing UI is a future enhancement; the picker
        // already lets the user override steps via the existing model
        // picker / scope picker / mode picker.)
        this.options.onEvent({ type: 'plan_approved', plan });
      } else {
        this.options.onEvent({ type: 'plan_approved', plan });
      }

      // ═════════════════════════════════════════════════════════
      // STAGE 3: ⚡ EXECUTE
      // ═════════════════════════════════════════════════════════
      await this.stage3_execute(plan);

      // ═════════════════════════════════════════════════════════
      // STAGE 4-5: VERIFY + REFINE loop
      // ═════════════════════════════════════════════════════════
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
      plan.status = critique.verdict === 'pass' ? 'completed' : (critique.verdict === 'fail' ? 'failed' : 'completed');

      // Format the final response
      response = this.formatPlanResponse(plan, critique);

      // ═════════════════════════════════════════════════════════
      // STAGE 6: 💡 REFLECT
      // ═════════════════════════════════════════════════════════
      if (this.options.enableReflection) {
        await this.stage6_reflect(plan, critique);
      }
    } else {
      // Simple chat path: just stream
      response = await this.streamSimpleChat();
    }

    this.stats.tasksCompleted++;
    this.stats.refinements += finalPlan ? finalPlan.refinements : 0;

    // Post-LLM hook
    await this.hooks.emit('PostLLMCall', { response, messageCount: this.messages.length, durationMs: Date.now() - startTime });

    // Final reply hook
    await this.hooks.emit('AssistantReply', { response: response.slice(0, 500), sessionId: this.currentSessionId });

    return response;
  }

  // ═══════════════════════════════════════════════════════════
  // STAGE 1: 🧠 UNDERSTAND
  // Detect what the user really wants
  // ═══════════════════════════════════════════════════════════
  private async stage1_understand(message: string, projectContext: string): Promise<{ taskType: TaskType; complexity: ComplexityLevel; needsSubagent: boolean }> {
    this.options.onEvent({ type: 'stage', stage: STAGES[0], status: 'start' });

    const taskType = this.detectTaskType(message);
    const complexity = this.detectComplexity(message, taskType);
    const needsSubagent = this.shouldUseSubagent(taskType, complexity, message);

    // Recall relevant memories
    const relevantMemories = this.memory.recall(message, 5);
    const memoryContext = relevantMemories.length > 0
      ? `\n## What I Remember\n${relevantMemories.map(m => `- [${m.type}] ${m.content.slice(0, 200)}`).join('\n')}\n`
      : '';

    this.options.onEvent({
      type: 'thinking',
      content: `🧠 Task: ${taskType} | Complexity: ${complexity} | Subagent: ${needsSubagent ? 'yes' : 'no'} | Memories: ${relevantMemories.length}`
    });

    // Build base system prompt (will be enriched if planning)
    this.systemPrompt = `You are Hua, an anime-powered AI coding agent working in ${projectContext || 'a project'}.${memoryContext}

Your personality: Magical, precise, helpful. Use sparkle emojis sparingly (✦, ✧, ✿, ♡).

Workflow you follow internally:
1. UNDERSTAND what user really wants
2. PLAN the steps with the right tools
3. EXECUTE step by step
4. VERIFY (correctness, completeness, quality, safety, efficiency)
5. REFINE if needed
6. REFLECT and learn

Available tools:
${this.tools.list().map(t => `  - ${t.name}: ${t.description.split('\n')[0]}`).join('\n')}

Be concise. Show your work. Ship working code, not promises.`;

    this.options.onEvent({ type: 'stage', stage: STAGES[0], status: 'end' });

    return { taskType, complexity, needsSubagent };
  }

  // ═══════════════════════════════════════════════════════════
  // STAGE 2: 🗺️ PLAN
  // Generate structured plan via specialized planner
  // ═══════════════════════════════════════════════════════════
  private async stage2_plan(userMessage: string, understand: { taskType: TaskType; complexity: ComplexityLevel }): Promise<Plan> {
    this.options.onEvent({ type: 'stage', stage: STAGES[1], status: 'start' });

    // Pre-LLM hook
    await this.hooks.emit('PreLLMCall', { stage: 'plan', model: this.client.getModel() });

    const plan = await this.planner.plan({
      request: userMessage,
      availableTools: this.tools.list().map(t => t.name),
      taskType: understand.taskType,
    });

    // Override task type from detection
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
  // STAGE 3: ⚡ EXECUTE
  // Run plan with hooks, support parallel groups
  // ═══════════════════════════════════════════════════════════
  private async stage3_execute(plan: Plan): Promise<void> {
    this.options.onEvent({ type: 'stage', stage: STAGES[2], status: 'start' });
    plan.status = 'executing';

    // Group steps by parallel_group; within a group, run in parallel
    const groups = new Map<number, PlanStep[]>();
    for (const step of plan.steps) {
      const g = step.parallel_group ?? 0;
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g)!.push(step);
    }

    const sortedGroups = [...groups.entries()].sort(([a], [b]) => a - b);

    for (const [groupNum, steps] of sortedGroups) {
      // If only one step in group, run sequentially (preserves any local state)
      // If multiple, run in parallel
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

  private async executeStep(plan: Plan, step: PlanStep): Promise<void> {
    this.options.onEvent({ type: 'step_start', step });
    step.status = 'running';
    const start = Date.now();

    // Pre-tool hook
    await this.hooks.emit('PreToolUse', { name: step.tool, args: step.args });

    try {
      let result: any;

      if (step.tool) {
        const call: ToolCall = { id: nanoid(), name: step.tool, args: step.args || {} };
        this.options.onEvent({ type: 'tool_call', call });

        result = await this.tools.execute(call.name, call.args);

        this.options.onEvent({ type: 'tool_result', call, result });

        // Post-tool hook
        await this.hooks.emit('PostToolUse', {
          name: call.name,
          args: call.args,
          result,
          error: result?.error
        });
      } else {
        // No tool: just record the thought
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

  // ═══════════════════════════════════════════════════════════
  // STAGE 4: ✅ VERIFY
  // Critic scores 5 dimensions, returns verdict
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
  // STAGE 5: 🔄 REFINE
  // Re-execute failed/refinable steps, max N iterations
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

    // Find steps that need re-execution
    const failedSteps = plan.steps.filter((s) => s.status === 'failed');
    const incompleteSteps = plan.steps.filter(
      (s) => s.status === 'done' && critique.issues.length > 0
    );

    const stepsToRefine = [...failedSteps, ...incompleteSteps].slice(0, 3);

    for (const step of stepsToRefine) {
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
  // STAGE 6: 💡 REFLECT
  // Extract lessons, update memory
  // ═══════════════════════════════════════════════════════════
  private async stage6_reflect(plan: Plan, critique: CritiqueResult): Promise<void> {
    this.options.onEvent({ type: 'stage', stage: STAGES[5], status: 'start' });

    if (critique.verdict === 'pass' || critique.overall >= 3.5) {
      await this.reflector.reflectSuccess(plan, critique);
    } else {
      await this.reflector.reflectFailure(plan, critique);
    }

    // Also record raw episode
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
  // HELPERS
  // ═══════════════════════════════════════════════════════════

  // Simple chat: no planning, just stream
  private async streamSimpleChat(): Promise<string> {
    this.options.onEvent({ type: 'stage', stage: STAGES[2], status: 'start' });

    this.options.onEvent({ type: 'thinking', content: '💭 Thinking...' });
    let fullResponse = '';

    for await (const event of this.client.stream({
      model: this.client.getModel(),
      system: this.systemPrompt,
      messages: this.messages.map((m) => ({ role: m.role as any, content: m.content })) as any,
      tools: this.tools.getSchemas(),
      temperature: 0.7,
    })) {
      if (event.type === 'text_delta') {
        fullResponse = event.accumulated;
        this.options.onEvent({ type: 'stream_delta', delta: event.delta, accumulated: event.accumulated });
      } else if (event.type === 'message_stop') {
        break;
      } else if (event.type === 'error') {
        throw new Error(event.error);
      }
    }

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

  // Detect task type from message
  private detectTaskType(message: string): TaskType {
    const m = message.toLowerCase();
    if (/\b(what does|show me|read|explain|describe|cek|lihat|inspect|find|where is)\b/.test(m)) return 'code_read';
    if (/\b(fix|bug|error|broken|fail|crash|debug|kena error|gw error)\b/.test(m)) return 'code_fix';
    if (/\b(refactor|clean up|improve|optimize|restructure)\b/.test(m)) return 'code_refactor';
    if (/\b(run|execute|build|deploy|install|test|start)\b/.test(m)) return 'action';
    if (/\b(what|how|why|when|where|who|apa|bagaimana|mengapa|kapan)\b/.test(m) && message.length < 100) return 'question';
    if (/\b(search|find|research|investigate|carikan|riset)\b/.test(m)) return 'research';
    if (/\b(create|build|add|implement|write|make|bikin|buat|tambah)\b/.test(m)) return 'code_write';
    return 'unknown';
  }

  // Detect complexity
  private detectComplexity(message: string, taskType: TaskType): ComplexityLevel {
    if (message.length < 30 && (taskType === 'question' || taskType === 'code_read')) return 'trivial';
    const words = message.split(/\s+/).length;
    if (words < 8) return 'simple';
    if (words < 25) return 'moderate';
    return 'complex';
  }

  // Decide if we need a subagent
  private shouldUseSubagent(taskType: TaskType, complexity: ComplexityLevel, message: string): boolean {
    if (!this.options.enableSubagents) return false;
    // Big research/review tasks benefit from subagent
    if (taskType === 'research' && complexity === 'complex') return true;
    if (taskType === 'code_read' && message.length > 200) return true;
    return false;
  }

  // Format plan response for user
  private formatPlanResponse(plan: Plan, critique: CritiqueResult): string {
    const steps = plan.steps.map((s, i) => {
      const icon = s.status === 'done' ? '✓' : s.status === 'failed' ? '✗' : '○';
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

  // Compact memory
  private async compactMemory(level: 'warning' | 'critical'): Promise<void> {
    const before = this.messages.length;
    await this.hooks.emit('PreCompact', { level, messageCount: before });

    if (level === 'critical') {
      const recent = this.messages.slice(-6);
      const summary = summarizeConversation(this.messages.slice(0, -6));
      this.messages = [
        {
          id: nanoid(),
          role: 'system',
          content: `## Earlier conversation summary\n${summary}`,
          timestamp: Date.now(),
        },
        ...recent,
      ];
    } else {
      this.memory.recordEpisode(
        `Conversation summary at warning: ${summarizeConversation(this.messages)}`,
        { type: 'compaction' },
        0.6
      );
    }

    await this.hooks.emit('PostCompact', { before, after: this.messages.length });
    this.options.onEvent({ type: 'compact', before, after: this.messages.length });
  }

  // Spawn subagent (public API)
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

  // End session
  async end(): Promise<void> {
    await this.hooks.emit('SessionEnd', {
      sessionId: this.currentSessionId,
      duration: Date.now() - (this.messages[0]?.timestamp || Date.now()),
      messageCount: this.messages.length,
    });
    this.sessions.endSession(this.currentSessionId, `Ended after ${this.messages.length} messages`);
  }

  reset() {
    this.messages = [];
  }
}
