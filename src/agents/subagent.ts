// Subagent orchestration - spawn isolated agents for sub-tasks
// Inspired by OpenClaude AgentTool and ECC's specialist agents
//
// A subagent is a lightweight, focused agent that can:
//   - Run in parallel with the main agent
//   - Have its own system prompt
//   - Have its own tool subset
//   - Stream events back to the parent
//   - Have its own model (or inherit)

import { nanoid } from 'nanoid';
import { EventEmitter } from 'node:events';
import { UnifiedClient, type StreamEvent } from '../providers/client.js';
import { ToolRegistry } from '../tools/index.js';
import { MemoryManager } from '../memory/manager.js';

export type SubagentType =
  | 'general-purpose'
  | 'code-explorer'
  | 'code-reviewer'
  | 'test-runner'
  | 'doc-writer'
  | 'bug-hunter'
  | 'planner'
  | 'critic'
  | 'refactorer'
  | 'security-reviewer';

export interface SubagentSpec {
  type: SubagentType;
  name: string;
  description: string;
  emoji: string;
  systemPrompt: string;
  allowedTools?: string[];
  model?: string;
}

export const SUBAGENT_SPECS: Record<SubagentType, SubagentSpec> = {
  'general-purpose': {
    type: 'general-purpose',
    name: 'General Purpose',
    description: 'Versatile agent for any task',
    emoji: '✦',
    systemPrompt: 'You are a helpful AI assistant. You use tools wisely, verify your work, and explain your reasoning.',
  },
  'code-explorer': {
    type: 'code-explorer',
    name: 'Code Explorer',
    description: 'Explores codebase to understand structure',
    emoji: '🗺️',
    systemPrompt: `You are a code exploration specialist. Your job is to:
1. Navigate the codebase efficiently
2. Identify key files, patterns, and conventions
3. Map out dependencies and relationships
4. Report back with clear, structured findings
Use only read-only tools. Never modify files.`,
    allowedTools: ['read', 'search', 'grep', 'glob'],
  },
  'code-reviewer': {
    type: 'code-reviewer',
    name: 'Code Reviewer',
    description: 'Reviews code for quality, security, and best practices',
    emoji: '👀',
    systemPrompt: `You are a senior code reviewer. Your job is to:
1. Identify bugs, security issues, and performance problems
2. Check adherence to best practices
3. Suggest specific improvements
4. Categorize findings as CRITICAL, HIGH, MEDIUM, LOW
Be precise, concise, and constructive. Only report real issues.`,
    allowedTools: ['read', 'search', 'grep', 'bash'],
  },
  'test-runner': {
    type: 'test-runner',
    name: 'Test Runner',
    description: 'Runs tests and reports results',
    emoji: '🧪',
    systemPrompt: `You are a test execution specialist. Your job is to:
1. Run the project's test suite
2. Identify failing tests
3. Report root causes
4. Suggest fixes
Be thorough but fast. Report pass/fail counts and timing.`,
    allowedTools: ['bash', 'read', 'grep'],
  },
  'doc-writer': {
    type: 'doc-writer',
    name: 'Doc Writer',
    description: 'Writes clear documentation',
    emoji: '📝',
    systemPrompt: `You are a technical writer. Your job is to:
1. Write clear, concise documentation
2. Add examples where helpful
3. Match existing project documentation style
4. Update READMEs, code comments, and API docs
Be clear, be helpful.`,
    allowedTools: ['read', 'write', 'edit', 'grep', 'search'],
  },
  'bug-hunter': {
    type: 'bug-hunter',
    name: 'Bug Hunter',
    description: 'Hunts for bugs by analyzing code and running tests',
    emoji: '🐛',
    systemPrompt: `You are a debugging specialist. Your job is to:
1. Reproduce the bug
2. Trace the root cause through the code
3. Identify the exact line(s) at fault
4. Propose a minimal fix
Be systematic. Use git log/blame for context. Don't guess.`,
    allowedTools: ['read', 'bash', 'grep', 'search'],
  },
  'planner': {
    type: 'planner',
    name: 'Planner',
    description: 'Creates detailed implementation plans',
    emoji: '📋',
    systemPrompt: `You are a planning specialist. Your job is to:
1. Understand the goal completely
2. Break it into atomic steps
3. Identify dependencies
4. Estimate effort
5. Output a structured plan

Output JSON format:
{
  "goal": "...",
  "steps": [{"description": "...", "tool": "...", "args": {...}, "dependsOn": []}],
  "risks": ["..."],
  "assumptions": ["..."]
}`,
    allowedTools: ['read', 'grep', 'search'],
  },
  'critic': {
    type: 'critic',
    name: 'Critic',
    description: 'Reviews work and suggests improvements',
    emoji: '🔍',
    systemPrompt: `You are a critic. Your job is to:
1. Review the work done
2. Check correctness
3. Identify gaps and issues
4. Output verdict: PASS | REFINE | FAIL
Be specific. Be harsh but fair.`,
    allowedTools: ['read', 'bash', 'grep'],
  },
  refactorer: {
    type: 'refactorer',
    name: 'Refactorer',
    description: 'Improves code structure without changing behavior',
    emoji: '♻️',
    systemPrompt: `You are a refactoring specialist. Your job is to:
1. Improve code structure
2. Reduce duplication
3. Improve naming and clarity
4. Never change behavior - tests must still pass
Make small, safe changes. Verify after each.`,
    allowedTools: ['read', 'edit', 'bash', 'grep'],
  },
  'security-reviewer': {
    type: 'security-reviewer',
    name: 'Security Reviewer',
    description: 'Finds security vulnerabilities',
    emoji: '🔒',
    systemPrompt: `You are a security specialist. Your job is to:
1. Find vulnerabilities (XSS, SQLi, RCE, SSRF, IDOR, etc.)
2. Check for hardcoded secrets
3. Validate input handling
4. Check authentication/authorization
5. Look for injection attacks
Report CRITICAL findings immediately. Use OWASP Top 10.`,
    allowedTools: ['read', 'grep', 'search'],
  },
};

export interface SubagentRunOptions {
  task: string;
  type: SubagentType;
  parentMessages?: any[];
  client: UnifiedClient;
  model?: string;
  customSystemPrompt?: string;
  workdir?: string;
  streamOutput?: boolean;
}

export interface SubagentResult {
  id: string;
  type: SubagentType;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  output: string;
  toolCalls: Array<{ name: string; args: any; result?: any }>;
  startTime: number;
  endTime?: number;
  error?: string;
  tokensUsed?: number;
  cost?: number;
}

export class Subagent extends EventEmitter {
  public readonly id: string;
  public readonly type: SubagentType;
  public readonly spec: SubagentSpec;
  public status: SubagentResult['status'] = 'running';
  public output: string = '';
  public toolCalls: SubagentResult['toolCalls'] = [];

  private startTime: number;

  constructor(type: SubagentType) {
    super();
    this.id = nanoid(8);
    this.type = type;
    this.spec = SUBAGENT_SPECS[type];
    this.startTime = Date.now();
  }

  // Run the subagent
  async run(opts: SubagentRunOptions): Promise<SubagentResult> {
    this.emit('start', { id: this.id, type: this.type });
    this.startTime = Date.now();

    const spec = opts.type === this.type ? this.spec : SUBAGENT_SPECS[opts.type];
    const systemPrompt = opts.customSystemPrompt || spec.systemPrompt;

    const messages = [
      ...(opts.parentMessages || []).slice(-5).map((m: any) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
      { role: 'user' as const, content: opts.task },
    ];

    let totalTokens = 0;
    let totalCost = 0;

    try {
      for await (const event of opts.client.stream({
        model: opts.model || opts.client.getModel(),
        system: systemPrompt,
        messages,
        temperature: 0.3,
        maxTokens: 4096,
      })) {
        if (event.type === 'text_delta') {
          this.output = event.accumulated;
          this.emit('text', { id: this.id, delta: event.delta, accumulated: event.accumulated });
        } else if (event.type === 'usage') {
          totalTokens = event.total;
          totalCost = event.cost;
          this.emit('usage', { id: this.id, ...event });
        } else if (event.type === 'message_stop') {
          break;
        } else if (event.type === 'error') {
          this.status = 'failed';
          this.emit('error', { id: this.id, error: event.error });
          return {
            id: this.id,
            type: this.type,
            status: 'failed',
            output: this.output,
            toolCalls: this.toolCalls,
            startTime: this.startTime,
            endTime: Date.now(),
            error: event.error,
          };
        }
      }

      this.status = 'completed';
      this.emit('done', { id: this.id, output: this.output });

      return {
        id: this.id,
        type: this.type,
        status: 'completed',
        output: this.output,
        toolCalls: this.toolCalls,
        startTime: this.startTime,
        endTime: Date.now(),
        tokensUsed: totalTokens,
        cost: totalCost,
      };
    } catch (err: any) {
      this.status = 'failed';
      this.emit('error', { id: this.id, error: err.message });
      return {
        id: this.id,
        type: this.type,
        status: 'failed',
        output: this.output,
        toolCalls: this.toolCalls,
        startTime: this.startTime,
        endTime: Date.now(),
        error: err.message,
      };
    }
  }
}

export class SubagentOrchestrator {
  private running: Map<string, Subagent> = new Map();
  private history: SubagentResult[] = [];

  // Run a subagent synchronously (waits for result)
  async run(opts: SubagentRunOptions): Promise<SubagentResult> {
    const agent = new Subagent(opts.type);
    this.running.set(agent.id, agent);

    const result = await agent.run(opts);
    this.history.push(result);
    this.running.delete(agent.id);
    return result;
  }

  // Run multiple subagents in parallel
  async runParallel(optsList: SubagentRunOptions[]): Promise<SubagentResult[]> {
    const promises = optsList.map((opts) => this.run(opts));
    return Promise.all(promises);
  }

  // Get currently running subagents
  getRunning(): Subagent[] {
    return Array.from(this.running.values());
  }

  // Get history
  getHistory(limit = 20): SubagentResult[] {
    return this.history.slice(-limit);
  }

  // Cancel a running subagent
  cancel(id: string): boolean {
    const agent = this.running.get(id);
    if (agent) {
      agent.status = 'cancelled';
      this.running.delete(id);
      return true;
    }
    return false;
  }
}

let _instance: SubagentOrchestrator | null = null;

export function getOrchestrator(): SubagentOrchestrator {
  if (!_instance) _instance = new SubagentOrchestrator();
  return _instance;
}
