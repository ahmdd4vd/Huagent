// ✦ Smart Engine v3.0 — 7-Stage Innovation Workflow ✦
//
// The most advanced coding agent engine, combining:
// - Aider's SEARCH/REPLACE editor + auto-commit
// - ECC's continuous learning + instincts + GateGuard
// - OpenClaude's snip projection + TTFT profiling + reactive compact
// - Pi's tree-based session + model-change tracking
// - OpenCode's doom-loop detection
//
// PLUS 7 INNOVATIONS:
// 1. IdentityContext — Cross-model persistence (ganti model = tetep sama)
// 2. Spec-Driven (Architect) — Spec dulu, code kemudian
// 3. Edit-Format Auto-Detection — SEARCH/REPLACE vs full write
// 4. Continuous Learning — Instinct synthesis from episode clusters
// 5. Pre-Flight Fact Check — Anti-hallucination via concrete facts
// 6. Snapshot + Rollback — File safety without git
// 7. Doom-Loop Self-Healing — 3-level recovery ladder

import { UnifiedClient, type StreamEvent } from '../../providers/client.js';
import { MemoryManager } from '../../memory/manager.js';
import { ToolRegistry } from '../../tools/index.js';
import { SessionManager } from '../../sessions.js';
import { getHooks } from '../../hooks.js';
import { getOrchestrator, type SubagentType } from '../../agents/subagent.js';
import { Planner } from '../planner.js';
import { Critic, type CritiqueResult } from '../critic.js';
import { Reflector } from '../reflector.js';
import { IdentityManager } from './identity.js';
import { ColdStartScanner } from './coldstart.js';
import { Architect, type Spec } from './architect.js';
import { SmartEditor } from './editor.js';
import { DoomLoopDetector } from './doomloop.js';
import { SnapshotManager } from './snapshot.js';
import { InstinctSynthesizer, type Instinct } from './instinct.js';
import { MetricsCollector } from './metrics.js';
import { prompts } from '../../llm/prompt.js';
import { estimateMemory, shouldCompact } from '../../memory/pressure.js';
import { summarizeConversation } from '../../summary.js';
import type { Message, Plan, PlanStep, ToolCall, TaskType, ComplexityLevel } from '../../types/index.js';
import { nanoid } from 'nanoid';

export interface EngineOptions {
  maxRefinements?: number;
  enableCritic?: boolean;
  enablePlanning?: boolean;
  enableSubagents?: boolean;
  enableReflection?: boolean;
  enableArchitect?: boolean;
  enableInstincts?: boolean;
  enableDoomLoopDetection?: boolean;
  enableSnapshot?: boolean;
  maxSteps?: number;
  onEvent?: (event: EngineEvent) => void;
}

export type EngineEvent =
  | { type: 'stage'; stage: string; status: 'start' | 'end'; detail?: string; durationMs?: number }
  | { type: 'identity_loaded'; files: number; language: string; framework: string[] }
  | { type: 'spec_generated'; spec: Spec }
  | { type: 'spec_rejected'; issues: string[] }
  | { type: 'thinking'; content: string }
  | { type: 'plan_created'; plan: Plan }
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
  | { type: 'instinct_synthesized'; instinct: Instinct }
  | { type: 'doom_loop_recovery'; action: string }
  | { type: 'rollback'; paths: string[] }
  | { type: 'metric'; name: string; value: number };

const STAGES = [
  '🌱 COLD-START',     // 0 (first run)
  '🧠 UNDERSTAND',     // 1
  '🔍 SCOUT',          // 1.5
  '🏛️ ARCHITECT',      // 2
  '🗺️ PLAN',           // 3
  '✏️ EDITOR',         // 4
  '✅ VERIFY',         // 5
  '🔄 REFINE',         // 6
  '💡 REFLECT',        // 7
] as const;

export class Engine {
  private client: UnifiedClient;
  private memory: MemoryManager;
  private tools: ToolRegistry;
  private sessions: SessionManager;
  private hooks = getHooks();
  private orchestrator = getOrchestrator();

  // v3.0 components
  private identity: IdentityManager;
  private coldStart: ColdStartScanner;
  private architect: Architect;
  private smartEditor: SmartEditor;
  private doomLoop: DoomLoopDetector;
  private snapshot: SnapshotManager;
  private instincts: InstinctSynthesizer;
  private metrics: MetricsCollector;

  // Legacy components
  private planner: Planner;
  private critic: Critic;
  private reflector: Reflector;

  private options: Required<EngineOptions>;
  private messages: Message[] = [];
  private systemPrompt: string = '';
  private currentSessionId: string;
  private currentModel: string;

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
    this.currentModel = client.getModel();

    this.options = {
      maxRefinements: options.maxRefinements ?? 3,
      enableCritic: options.enableCritic ?? true,
      enablePlanning: options.enablePlanning ?? true,
      enableSubagents: options.enableSubagents ?? true,
      enableReflection: options.enableReflection ?? true,
      enableArchitect: options.enableArchitect ?? true,
      enableInstincts: options.enableInstincts ?? true,
      enableDoomLoopDetection: options.enableDoomLoopDetection ?? true,
      enableSnapshot: options.enableSnapshot ?? true,
      maxSteps: options.maxSteps ?? 15,
      onEvent: options.onEvent ?? (() => {}),
    };

    // Init v3.0 components
    const projectRoot = process.cwd();
    this.identity = new IdentityManager(projectRoot, memory);
    this.coldStart = new ColdStartScanner(projectRoot);
    this.architect = new Architect(client);
    this.smartEditor = new SmartEditor();
    this.doomLoop = new DoomLoopDetector({ modelLadder: ['MiniMax-M3', 'gpt-4o', 'claude-opus-4'] });
    this.snapshot = new SnapshotManager();
    this.instincts = new InstinctSynthesizer(memory, projectRoot);
    this.metrics = new MetricsCollector();

    // Init legacy
    this.planner = new Planner(client);
    this.critic = new Critic(client);
    this.reflector = new Reflector(memory);

    this.doomLoop.setModel(this.currentModel);

    this.currentSessionId = this.sessions.startSession(projectRoot);
  }

  getClient(): UnifiedClient { return this.client; }
  getMessages(): Message[] { return this.messages; }
  getMetrics() { return this.metrics; }
  getIdentity() { return this.identity; }
  getInstincts() { return this.instincts.getAll(); }

  // Public helper to read current identity state
  getCurrentIdentity() {
    return (this.identity as any).cache;
  }

  /**
   * Main entry: process a user message through the 7-stage workflow.
   */
  async process(userMessage: string, projectContext: string = ''): Promise<string> {
    const taskId = nanoid(8);
    this.metrics.startTask(taskId, this.currentModel);
    this.metrics.startStage('process_total');

    try {
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

      // ═══════════════════════════════════════════════════════════
      // STAGE 0: 🌱 COLD-START (first run or after major change)
      // ═══════════════════════════════════════════════════════════
      this.metrics.startStage('coldstart');
      const identity = await this.identity.get();
      this.metrics.endStage('success', `${identity.project.fileCount} files, ${identity.project.type}`);

      this.options.onEvent({
        type: 'identity_loaded',
        files: identity.project.fileCount,
        language: identity.project.type,
        framework: identity.project.framework,
      });

      // Use the manager (it has render())
      const coldStartManager = this.coldStart;
      const coldStartResult = coldStartManager.scan();

      // Memory pressure check
      const memStats = estimateMemory(this.messages, this.systemPrompt);
      const pressure = shouldCompact(memStats);
      if (pressure !== 'none') {
        await this.compactMemory(pressure);
      }

      // ═══════════════════════════════════════════════════════════
      // STAGE 1: 🧠 UNDERSTAND
      // ═══════════════════════════════════════════════════════════
      this.metrics.startStage('understand');
      const understand = this.detectTask(userMessage);
      this.metrics.endStage('success', `${understand.taskType}/${understand.complexity}`);

      // Build system prompt WITH identity (cross-model persistence!)
      this.systemPrompt = this.buildSystemPrompt(this.identity, this.coldStart, understand, userMessage);
      this.identity.updateContext({ currentFiles: [], recentTools: [] });

      // Pre-LLM hook
      await this.hooks.emit('PreLLMCall', { model: this.currentModel, messageCount: this.messages.length });

      let response: string;
      let finalPlan: Plan | null = null;
      let finalSpec: Spec | null = null;
      let finalCritique: CritiqueResult | null = null;

      // Decide path
      if (this.options.enablePlanning && understand.complexity !== 'trivial' && understand.taskType !== 'question') {
        // ═══════════════════════════════════════════════════════════
        // STAGE 2: 🏛️ ARCHITECT (spec-driven, anti-hallucination)
        // ═══════════════════════════════════════════════════════════
        if (this.options.enableArchitect && (understand.taskType === 'code_write' || understand.taskType === 'code_fix' || understand.taskType === 'code_refactor')) {
          this.metrics.startStage('architect');
          const spec = await this.architect.design(
            userMessage,
            this.coldStart.render(),
            this.tools.list().map((t) => t.name)
          );

          // Validate spec is concrete (not hallucinated)
          const validation = this.architect.validateSpecIsConcrete(spec);
          if (!validation.valid && validation.issues.length > 2) {
            // Spec too vague — reject and fall back to direct plan
            this.options.onEvent({ type: 'spec_rejected', issues: validation.issues });
            this.metrics.endStage('failure', `rejected: ${validation.issues.length} issues`);
          } else {
            this.options.onEvent({ type: 'spec_generated', spec });
            this.metrics.endStage('success', `${spec.requirements.length} reqs, ${spec.filesAffected.length} files`);
            finalSpec = spec;
          }
        }

        // ═══════════════════════════════════════════════════════════
        // STAGE 3: 🗺️ PLAN
        // ═══════════════════════════════════════════════════════════
        this.metrics.startStage('plan');
        const planPrompt = finalSpec
          ? this.enrichPromptWithSpec(userMessage, finalSpec)
          : userMessage;
        const plan = await this.planner.plan({
          request: planPrompt,
          availableTools: this.tools.list().map((t) => t.name),
          taskType: understand.taskType,
        });
        plan.taskType = understand.taskType;
        plan.complexity = understand.complexity;
        this.metrics.endStage('success', `${plan.steps.length} steps`);

        this.options.onEvent({ type: 'plan_created', plan });

        // ═══════════════════════════════════════════════════════════
        // STAGE 4: ✏️ EDITOR (execute plan with safety)
        // ═══════════════════════════════════════════════════════════
        this.metrics.startStage('execute');
        plan.status = 'executing';

        // Snapshot files before write (rollback safety)
        if (this.options.enableSnapshot) {
          const filesToWrite = plan.steps
            .filter((s) => s.tool === 'write' || s.tool === 'edit')
            .map((s) => s.args?.path || s.args?.file)
            .filter(Boolean) as string[];
          if (filesToWrite.length > 0) {
            this.snapshot.snapshotAll(filesToWrite);
          }
        }

        // Execute steps (parallel groups)
        await this.executePlan(plan);

        this.metrics.endStage('success', `${plan.steps.filter((s) => s.status === 'done').length}/${plan.steps.length} done`);

        // ═══════════════════════════════════════════════════════════
        // STAGE 5: ✅ VERIFY (critic + GateGuard)
        // ═══════════════════════════════════════════════════════════
        let critique = this.options.enableCritic
          ? await this.runStage('verify', () => this.critic.critique(plan))
          : { verdict: 'pass' as const, scores: { correctness: 5, completeness: 5, quality: 5, safety: 5, efficiency: 5 }, overall: 5, feedback: 'Critic disabled', issues: [], suggestions: [] };

        // ═══════════════════════════════════════════════════════════
        // STAGE 6: 🔄 REFINE (loop max 3x with doom-loop detection)
        // ═══════════════════════════════════════════════════════════
        let iterations = 0;
        while (critique.verdict === 'refine' && iterations < this.options.maxRefinements) {
          iterations++;
          this.metrics.recordRefinement();
          await this.runStage('refine', () => this.refinePlan(plan, critique, iterations));
          if (this.options.enableCritic) {
            critique = await this.runStage('verify', () => this.critic.critique(plan));
          }
        }

        // If failure, roll back snapshots
        if (critique.verdict === 'fail' && this.options.enableSnapshot) {
          const rolled = this.snapshot.rollbackAll();
          this.options.onEvent({ type: 'rollback', paths: rolled.map((r) => r.path) });
        }

        finalPlan = plan;
        finalCritique = critique;
        plan.status = critique.verdict === 'pass' ? 'completed' : critique.verdict === 'fail' ? 'failed' : 'completed';

        response = this.formatResponse(plan, critique, finalSpec);

        // ═══════════════════════════════════════════════════════════
        // STAGE 7: 💡 REFLECT + INSTINCT SYNTHESIS
        // ═══════════════════════════════════════════════════════════
        if (this.options.enableReflection) {
          await this.runStage('reflect', async () => {
            if (critique.verdict === 'pass' || critique.overall >= 3.5) {
              await this.reflector.reflectSuccess(plan, critique);
            } else {
              await this.reflector.reflectFailure(plan, critique);
            }

            // v3.0: Synthesize instincts (continuous learning!)
            if (this.options.enableInstincts) {
              const newInstincts = await this.instincts.synthesizeFromEpisodes(plan, critique);
              for (const inst of newInstincts) {
                this.options.onEvent({ type: 'instinct_synthesized', instinct: inst });
              }
            }
          });
        }
      } else {
        // Simple chat path
        this.metrics.startStage('chat');
        response = await this.streamSimpleChat();
        this.metrics.endStage('success');
      }

      // Post-LLM hook
      await this.hooks.emit('PostLLMCall', { response, messageCount: this.messages.length });

      this.metrics.endTask(true);
      this.metrics.endStage('process_total' as any);

      // Final reply hook
      await this.hooks.emit('AssistantReply', { response: response.slice(0, 500), sessionId: this.currentSessionId });

      return response;
    } catch (err: any) {
      this.metrics.endTask(false);
      throw err;
    }
  }

  // ═══════════════════════════════════════════════════════════
  // PRIVATE
  // ═══════════════════════════════════════════════════════════

  private buildSystemPrompt(identityManager: any, coldStart: any, understand: any, userMessage: string): string {
    const identity = (identityManager as any).cache;
    const instinctContext = this.options.enableInstincts
      ? this.instincts.renderForPrompt(understand.taskType, understand.complexity)
      : '';

    if (!identity) return '';

    return [
      identityManager.render(),
      coldStart.render(),
      `# Current Task`,
      `Type: ${understand.taskType} | Complexity: ${understand.complexity}`,
      instinctContext,
      `# Available Tools`,
      this.tools.list().map((t) => `  - ${t.name}: ${t.description.split('\n')[0]}`).join('\n'),
    ].filter(Boolean).join('\n\n');
  }

  private enrichPromptWithSpec(original: string, spec: Spec): string {
    return [
      `# Original Request`,
      original,
      `# Architect-Generated Spec`,
      `Goal: ${spec.goal}`,
      `Requirements:\n${spec.requirements.map((r) => `  - ${r}`).join('\n')}`,
      `Files to create/modify:\n${spec.filesAffected.map((f) => `  - ${f}`).join('\n')}`,
      spec.dataFlow ? `Data flow: ${spec.dataFlow}` : '',
      `Acceptance criteria:\n${spec.acceptance.map((a) => `  - ${a}`).join('\n')}`,
      `\n# Your job: create a step-by-step plan to satisfy the spec.`,
    ].filter(Boolean).join('\n\n');
  }

  private async executePlan(plan: Plan): Promise<void> {
    const groups = new Map<number, PlanStep[]>();
    for (const step of plan.steps) {
      const g = step.parallel_group ?? 0;
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g)!.push(step);
    }

    const sortedGroups = [...groups.entries()].sort(([a], [b]) => a - b);

    for (const [, steps] of sortedGroups) {
      if (steps.length === 1) {
        await this.executeStep(plan, steps[0]);
      } else {
        await Promise.all(steps.map((s) => this.executeStep(plan, s)));
      }
    }
  }

  private async executeStep(plan: Plan, step: PlanStep): Promise<void> {
    this.options.onEvent({ type: 'step_start', step });
    step.status = 'running';
    const start = Date.now();

    await this.hooks.emit('PreToolUse', { name: step.tool, args: step.args });

    try {
      let result: any;
      if (step.tool) {
        const call: ToolCall = { id: nanoid(), name: step.tool, args: step.args || {} };
        this.options.onEvent({ type: 'tool_call', call });
        this.identity.updateContext({ recentTools: [step.tool, ...(this.getCurrentIdentity()?.context.recentTools.slice(0, 2) || [])] });

        // Doom loop detection
        if (this.options.enableDoomLoopDetection) {
          const recovery = this.doomLoop.record({
            tool: step.tool,
            args: step.args || {},
            timestamp: Date.now(),
          });
          if (recovery) {
            this.options.onEvent({ type: 'doom_loop_recovery', action: recovery.type });
            if (recovery.type === 'abort') {
              throw new Error(recovery.reason);
            }
            // For hint/switch/ask: continue but adjust
            if (recovery.type === 'switch_model' && recovery.type === 'switch_model') {
              this.currentModel = (recovery as any).to;
              this.client.setModel(this.currentModel);
            }
          }
        }

        result = await this.tools.execute(call.name, call.args);
        this.options.onEvent({ type: 'tool_result', call, result });

        if (result?.error) {
          this.identity.updateContext({ lastError: result.error });
        } else if (step.tool === 'write' || step.tool === 'edit') {
          // Track files we've worked on
          const path = step.args?.path;
          if (path) {
            const ctx = this.getCurrentIdentity()?.context;
            if (ctx && !ctx.currentFiles.includes(path)) {
              this.identity.updateContext({ currentFiles: [path, ...ctx.currentFiles.slice(0, 4)] });
            }
          }
        }

        await this.hooks.emit('PostToolUse', { name: call.name, args: call.args, result, error: result?.error });
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

  private async refinePlan(plan: Plan, critique: CritiqueResult, iteration: number): Promise<void> {
    this.options.onEvent({ type: 'refining', iteration, reason: critique.feedback.slice(0, 100) });

    const failedSteps = plan.steps.filter((s) => s.status === 'failed');
    if (failedSteps.length > 0) {
      for (const step of failedSteps.slice(0, 3)) {
        step.status = 'pending';
        step.error = undefined;
        await this.executeStep(plan, step);
      }
    }
  }

  private async streamSimpleChat(): Promise<string> {
    this.options.onEvent({ type: 'thinking', content: '💭 Thinking...' });
    let fullResponse = '';

    for await (const event of this.client.stream({
      model: this.currentModel,
      system: this.systemPrompt,
      messages: this.messages.map((m) => ({ role: m.role as any, content: m.content })) as any,
      tools: this.tools.getSchemas(),
      temperature: 0.7,
    })) {
      if (event.type === 'text_delta') {
        fullResponse = event.accumulated;
        this.options.onEvent({ type: 'stream_delta', delta: event.delta, accumulated: event.accumulated });
        if (this.metrics.getLastTask()?.ttftMs === null || this.metrics.getLastTask()?.ttftMs === undefined) {
          this.metrics.recordTTFT();
        }
      } else if (event.type === 'usage') {
        this.metrics.recordTokens(event.input || 0, event.output || 0, event.cost || 0);
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

    return fullResponse;
  }

  private async runStage<T>(name: string, fn: () => Promise<T>): Promise<T> {
    this.options.onEvent({ type: 'stage', stage: name.toUpperCase(), status: 'start' });
    this.metrics.startStage(name);
    try {
      const result = await fn();
      this.metrics.endStage('success');
      this.options.onEvent({ type: 'stage', stage: name.toUpperCase(), status: 'end' });
      return result;
    } catch (err: any) {
      this.metrics.endStage('failure', err.message);
      this.options.onEvent({ type: 'stage', stage: name.toUpperCase(), status: 'end', detail: err.message });
      throw err;
    }
  }

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
    }

    await this.hooks.emit('PostCompact', { before, after: this.messages.length });
    this.options.onEvent({ type: 'compact', before, after: this.messages.length });
  }

  private detectTask(message: string): { taskType: TaskType; complexity: ComplexityLevel; needsSubagent: boolean } {
    const m = message.toLowerCase();
    let taskType: TaskType = 'unknown';
    if (/\b(what does|show me|read|explain|describe|cek|lihat|inspect|find|where is)\b/.test(m)) taskType = 'code_read';
    else if (/\b(fix|bug|error|broken|fail|crash|debug)\b/.test(m)) taskType = 'code_fix';
    else if (/\b(refactor|clean up|improve|optimize|restructure)\b/.test(m)) taskType = 'code_refactor';
    else if (/\b(run|execute|build|deploy|install|test|start)\b/.test(m)) taskType = 'action';
    else if (/\b(what|how|why|when|where|who|apa|bagaimana|mengapa|kapan)\b/.test(m) && message.length < 100) taskType = 'question';
    else if (/\b(search|find|research|investigate|carikan|riset)\b/.test(m)) taskType = 'research';
    else if (/\b(create|build|add|implement|write|make|bikin|buat|tambah)\b/.test(m)) taskType = 'code_write';

    let complexity: ComplexityLevel = 'simple';
    if (message.length < 30 && (taskType === 'question' || taskType === 'code_read')) complexity = 'trivial';
    else {
      const words = message.split(/\s+/).length;
      if (words >= 25) complexity = 'complex';
      else if (words >= 8) complexity = 'moderate';
    }

    const needsSubagent = taskType === 'research' && complexity === 'complex';
    return { taskType, complexity, needsSubagent };
  }

  private formatResponse(plan: Plan, critique: CritiqueResult, spec: Spec | null): string {
    const steps = plan.steps.map((s, i) => {
      const icon = s.status === 'done' ? '✓' : s.status === 'failed' ? '✗' : '○';
      const duration = s.duration ? ` (${s.duration}ms)` : '';
      return `${icon} ${i + 1}. ${s.description}${duration}`;
    }).join('\n');

    const emoji = critique.verdict === 'pass' ? '✨' : critique.verdict === 'refine' ? '🔄' : '⚠️';

    let output = `✨ **Plan executed:** ${plan.goal}\n\n`;
    if (spec) {
      output += `📋 **Spec:** ${spec.requirements.length} requirements across ${spec.filesAffected.length} files\n\n`;
    }
    output += `${steps}\n\n${emoji} Score: ${critique.overall.toFixed(1)}/5 (${critique.verdict})`;

    if (critique.issues.length > 0) {
      output += `\n\n**Issues:**\n${critique.issues.map((i) => `- ${i}`).join('\n')}`;
    }

    if (plan.refinements > 0) {
      output += `\n\n🔄 Refined ${plan.refinements} time(s)`;
    }

    return output;
  }

  async runSubagent(type: SubagentType, task: string, context?: string): Promise<string> {
    if (!this.options.enableSubagents) throw new Error('Subagents disabled');
    const id = nanoid(8);
    this.options.onEvent({ type: 'subagent_start', id, subagentType: type });
    await this.hooks.emit('SubagentStart', { id, type, task });
    const result = await this.orchestrator.run({
      type, task: context ? `${task}\n\nContext:\n${context}` : task,
      client: this.client, parentMessages: this.messages,
    });
    this.options.onEvent({ type: 'subagent_done', id, output: result.output });
    await this.hooks.emit('SubagentEnd', { id, type, status: result.status });
    return result.output;
  }

  async end(): Promise<void> {
    await this.hooks.emit('SessionEnd', { sessionId: this.currentSessionId, messageCount: this.messages.length });
    this.sessions.endSession(this.currentSessionId, `Ended after ${this.messages.length} messages`);
  }

  reset() {
    this.messages = [];
  }
}
