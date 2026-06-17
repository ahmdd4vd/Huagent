// Hook System - lifecycle events for observability and customization
// Inspired by ECC memory-persistence hooks and OpenClaude's hook system
//
// Hook events:
//   SessionStart    - Beginning of session, load context
//   SessionEnd      - End of session, persist state
//   PreToolUse      - Before a tool executes
//   PostToolUse     - After a tool completes
//   PreCompact      - Before context compaction
//   PostCompact     - After context compaction
//   PreLLMCall      - Before sending to LLM
//   PostLLMCall     - After LLM responds
//   UserPrompt      - User submitted a prompt
//   AssistantReply  - Assistant replied
//   Error           - An error occurred
//   SubagentStart   - Subagent spawned
//   SubagentEnd     - Subagent finished

import { existsSync, readFileSync } from 'node:fs';
import { join, extname } from 'node:path';
import { homedir } from 'node:os';

export type HookEvent =
  | 'SessionStart'
  | 'SessionEnd'
  | 'PreToolUse'
  | 'PostToolUse'
  | 'PreCompact'
  | 'PostCompact'
  | 'PreLLMCall'
  | 'PostLLMCall'
  | 'UserPrompt'
  | 'AssistantReply'
  | 'Error'
  | 'SubagentStart'
  | 'SubagentEnd';

export interface HookContext {
  event: HookEvent;
  timestamp: number;
  data: Record<string, any>;
}

export type HookHandler = (ctx: HookContext) => void | Promise<void>;

export class HookSystem {
  private handlers: Map<HookEvent, HookHandler[]> = new Map();
  private history: Array<{ event: HookEvent; timestamp: number; data: any; result?: string }> = [];
  private enabled: boolean = true;
  private configPath: string;

  constructor(configPath?: string) {
    this.configPath = configPath || join(homedir(), '.huagent', 'hooks');
    this.registerBuiltins();
  }

  // Register a handler for an event
  register(event: HookEvent, handler: HookHandler): void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, []);
    }
    this.handlers.get(event)!.push(handler);
  }

  unregister(event: HookEvent, handler: HookHandler): void {
    const handlers = this.handlers.get(event);
    if (handlers) {
      const idx = handlers.indexOf(handler);
      if (idx >= 0) handlers.splice(idx, 1);
    }
  }

  // Emit an event - calls all handlers
  async emit(event: HookEvent, data: Record<string, any> = {}): Promise<void> {
    if (!this.enabled) return;

    const ctx: HookContext = { event, timestamp: Date.now(), data };

    // Record in history (cap at 1000)
    this.history.push({ event, timestamp: ctx.timestamp, data });
    if (this.history.length > 1000) {
      this.history = this.history.slice(-1000);
    }

    const handlers = this.handlers.get(event) || [];
    for (const handler of handlers) {
      try {
        await handler(ctx);
      } catch (err) {
        console.error(`Hook error in ${event}:`, err);
      }
    }
  }

  // Load hooks from JSON config
  loadFromConfig(configPath: string): void {
    if (!existsSync(configPath)) return;
    try {
      const config = JSON.parse(readFileSync(configPath, 'utf-8'));
      if (config.events) {
        for (const eventConfig of config.events) {
          this.register(eventConfig.event, async (ctx) => {
            if (eventConfig.script) {
              await this.runScript(eventConfig.script, ctx);
            }
            if (eventConfig.log) {
              console.log(`[hook:${eventConfig.event}]`, JSON.stringify(ctx.data).slice(0, 200));
            }
          });
        }
      }
    } catch (err) {
      console.error('Failed to load hooks config:', err);
    }
  }

  // Run a script as a hook handler
  private async runScript(scriptPath: string, ctx: HookContext): Promise<void> {
    if (!existsSync(scriptPath)) return;
    const ext = extname(scriptPath);
    try {
      if (ext === '.js' || ext === '.mjs') {
        const mod = await import(scriptPath);
        if (typeof mod.default === 'function') {
          await mod.default(ctx);
        }
      } else if (ext === '.sh') {
        const { exec } = await import('node:child_process');
        const { promisify } = await import('node:util');
        const execAsync = promisify(exec);
        const safeData = JSON.stringify(ctx.data).replace(/'/g, "'\\''");
        await execAsync(`bash "${scriptPath}" '${safeData}'`);
      }
    } catch (err) {
      console.error(`Hook script failed (${scriptPath}):`, err);
    }
  }

  // Built-in hooks
  private registerBuiltins(): void {
    this.register('SessionStart', (ctx) => {
      if (process.env.HUAGENT_VERBOSE) {
        console.log(`[hook] Session started: ${ctx.data.id || 'new'}`);
      }
    });

    this.register('SessionEnd', (ctx) => {
      if (process.env.HUAGENT_VERBOSE) {
        const duration = ctx.data.duration ? `${Math.round(ctx.data.duration / 1000)}s` : 'unknown';
        console.log(`[hook] Session ended: ${duration}`);
      }
    });

    this.register('PreToolUse', (ctx) => {
      if (process.env.HUAGENT_DEBUG) {
        console.log(`[hook] PreToolUse: ${ctx.data.name}`);
      }
    });

    this.register('PostToolUse', (ctx) => {
      if (ctx.data.error && !ctx.data._fromHook) {
        this.emit('Error', { source: 'tool', name: ctx.data.name, error: ctx.data.error, _fromHook: true });
      }
    });

    this.register('Error', (ctx) => {
      if (process.env.HUAGENT_VERBOSE) {
        console.error(`[hook] Error:`, ctx.data);
      }
    });
  }

  getHistory(limit = 50): Array<{ event: HookEvent; timestamp: number; data: any }> {
    return this.history.slice(-limit);
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }
}

let _instance: HookSystem | null = null;

export function getHooks(): HookSystem {
  if (!_instance) _instance = new HookSystem();
  return _instance;
}
