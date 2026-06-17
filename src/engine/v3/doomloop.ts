// ✦ Doom-Loop Detector — Self-Healing ✦
// Inspired by OpenCode's doom_loop guard
// Innovation: 3-level recovery ladder (hint → swap model → ask user)

import { createHash } from 'node:crypto';

export interface ToolExecution {
  tool: string;
  args: Record<string, any>;
  timestamp: number;
  result?: any;
  error?: string;
}

export type RecoveryAction =
  | { type: 'hint'; message: string }
  | { type: 'switch_model'; from: string; to: string; reason: string }
  | { type: 'ask_user'; question: string }
  | { type: 'abort'; reason: string };

export interface DoomLoopConfig {
  windowMs: number;          // default 60_000 (60s)
  threshold: number;         // default 3 (3x same call in window)
  enableModelSwap: boolean;  // default true
  enableAskUser: boolean;    // default true
  modelLadder?: string[];    // [cheap, mid, expensive]
}

const DEFAULT_CONFIG: DoomLoopConfig = {
  windowMs: 60_000,
  threshold: 3,
  enableModelSwap: true,
  enableAskUser: true,
  modelLadder: ['MiniMax-M3', 'gpt-4o', 'claude-opus-4'],
};

export class DoomLoopDetector {
  private history: ToolExecution[] = [];
  private config: DoomLoopConfig;
  private currentModel = '';

  constructor(config: Partial<DoomLoopConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Record a tool execution.
   * Returns a recovery action if doom loop detected, else null.
   */
  record(exec: ToolExecution): RecoveryAction | null {
    this.history.push(exec);
    // Keep history bounded
    if (this.history.length > 100) {
      this.history = this.history.slice(-100);
    }
    return this.check();
  }

  /**
   * Check for doom loop without recording.
   */
  check(): RecoveryAction | null {
    if (this.history.length < this.config.threshold) return null;

    const now = Date.now();
    const recent = this.history.filter(
      (e) => now - e.timestamp < this.config.windowMs
    );
    if (recent.length < this.config.threshold) return null;

    // Group by signature
    const signatures = new Map<string, ToolExecution[]>();
    for (const exec of recent) {
      const sig = this.signature(exec);
      if (!signatures.has(sig)) signatures.set(sig, []);
      signatures.get(sig)!.push(exec);
    }

    // Find dominant signature
    let dominant: { sig: string; executions: ToolExecution[] } | null = null;
    for (const [sig, execs] of signatures.entries()) {
      if (!dominant || execs.length > dominant.executions.length) {
        dominant = { sig, executions: execs };
      }
    }

    if (!dominant || dominant.executions.length < this.config.threshold) return null;

    // Doom loop confirmed!
    return this.recover(dominant.executions[0], dominant.executions.length);
  }

  /**
   * Set the current model (for escalation).
   */
  setModel(model: string): void {
    this.currentModel = model;
  }

  /**
   * Get stats.
   */
  stats() {
    return {
      totalExecutions: this.history.length,
      recentExecutions: this.history.filter(
        (e) => Date.now() - e.timestamp < this.config.windowMs
      ).length,
      uniqueSignatures: new Set(this.history.map((e) => this.signature(e))).size,
    };
  }

  /**
   * Reset history (after successful recovery).
   */
  reset(): void {
    this.history = [];
  }

  // ═══════════════════════════════════════════════════
  // Private
  // ═══════════════════════════════════════════════════

  private signature(exec: ToolExecution): string {
    // Hash of tool name + canonicalized args
    const canonical = JSON.stringify(exec.args, Object.keys(exec.args).sort());
    return `${exec.tool}:${createHash('sha256').update(canonical).digest('hex').slice(0, 12)}`;
  }

  private recover(exec: ToolExecution, count: number): RecoveryAction {
    const tool = exec.tool;
    const argsStr = JSON.stringify(exec.args).slice(0, 100);

    // Level 1: Inject a hint into the system prompt
    if (count < this.config.threshold + 2) {
      return {
        type: 'hint',
        message: `⚠️ Doom loop: ${tool} called ${count}x with same args. Try a different approach.`,
      };
    }

    // Level 2: Escalate to bigger model
    if (this.config.enableModelSwap) {
      const ladder = this.config.modelLadder || [];
      const currentIdx = ladder.indexOf(this.currentModel);
      if (currentIdx >= 0 && currentIdx < ladder.length - 1) {
        return {
          type: 'switch_model',
          from: this.currentModel,
          to: ladder[currentIdx + 1],
          reason: `Doom loop on ${tool} (${count}x) — escalating to ${ladder[currentIdx + 1]}`,
        };
      }
    }

    // Level 3: Ask user
    if (this.config.enableAskUser) {
      return {
        type: 'ask_user',
        question: `I'm stuck calling ${tool} with the same arguments (${count}x). Should I:\n1. Try a different tool\n2. Simplify the task\n3. Skip this step`,
      };
    }

    // Level 4: Abort
    return {
      type: 'abort',
      reason: `Doom loop on ${tool} (${count}x) with args ${argsStr}`,
    };
  }
}
