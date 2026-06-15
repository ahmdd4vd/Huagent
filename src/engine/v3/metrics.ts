// ✦ Metrics + Profiler — Performance Tracking ✦
// Inspired by OpenClaude's queryProfiler + streamingOptimizer

export interface StageMetric {
  name: string;
  startMs: number;
  endMs?: number;
  durationMs?: number;
  detail?: string;
  status: 'running' | 'success' | 'failure' | 'skipped';
}

export interface TaskMetric {
  taskId: string;
  totalDurationMs: number;
  stages: StageMetric[];
  ttftMs: number | null;          // time to first token
  tokensIn: number;
  tokensOut: number;
  cost: number;
  refinements: number;
  model: string;
  success: boolean;
}

export interface PerformanceReport {
  avgTaskMs: number;
  p50StageMs: Record<string, number>;
  p95TaskMs: number;
  ttftAvgMs: number | null;
  successRate: number;
  totalTasks: number;
  totalTokens: number;
  totalCost: number;
}

export class MetricsCollector {
  private tasks: TaskMetric[] = [];
  private currentTask: TaskMetric | null = null;
  private currentStage: StageMetric | null = null;

  /**
   * Start a new task.
   */
  startTask(taskId: string, model: string): void {
    this.currentTask = {
      taskId,
      totalDurationMs: 0,
      stages: [],
      ttftMs: null,
      tokensIn: 0,
      tokensOut: 0,
      cost: 0,
      refinements: 0,
      model,
      success: false,
    };
  }

  /**
   * End current task.
   */
  endTask(success: boolean = true): void {
    if (!this.currentTask) return;
    this.currentTask.totalDurationMs = Date.now() - (this.currentTask.stages[0]?.startMs || Date.now());
    this.currentTask.success = success;
    this.tasks.push(this.currentTask);
    this.currentTask = null;
    this.currentStage = null;
  }

  /**
   * Start a stage within current task.
   */
  startStage(name: string, detail?: string): void {
    if (!this.currentTask) return;
    this.currentStage = {
      name,
      startMs: Date.now(),
      detail,
      status: 'running',
    };
    this.currentTask.stages.push(this.currentStage);
  }

  /**
   * End current stage.
   */
  endStage(status: 'success' | 'failure' | 'skipped' = 'success', detail?: string): void {
    if (!this.currentStage) return;
    this.currentStage.endMs = Date.now();
    this.currentStage.durationMs = this.currentStage.endMs - this.currentStage.startMs;
    this.currentStage.status = status;
    if (detail) this.currentStage.detail = detail;
    this.currentStage = null;
  }

  /**
   * Record first token time (TTFT).
   */
  recordTTFT(): void {
    if (!this.currentTask || this.currentTask.ttftMs !== null) return;
    this.currentTask.ttftMs = Date.now() - (this.currentTask.stages[0]?.startMs || Date.now());
  }

  /**
   * Record token usage.
   */
  recordTokens(input: number, output: number, cost: number = 0): void {
    if (!this.currentTask) return;
    this.currentTask.tokensIn += input;
    this.currentTask.tokensOut += output;
    this.currentTask.cost += cost;
  }

  /**
   * Record refinement iteration.
   */
  recordRefinement(): void {
    if (this.currentTask) this.currentTask.refinements++;
  }

  /**
   * Get performance report.
   */
  getReport(): PerformanceReport {
    if (this.tasks.length === 0) {
      return {
        avgTaskMs: 0,
        p50StageMs: {},
        p95TaskMs: 0,
        ttftAvgMs: null,
        successRate: 0,
        totalTasks: 0,
        totalTokens: 0,
        totalCost: 0,
      };
    }

    const totalDurations = this.tasks.map((t) => t.totalDurationMs).sort((a, b) => a - b);
    const avgTaskMs = totalDurations.reduce((a, b) => a + b, 0) / totalDurations.length;
    const p95TaskMs = totalDurations[Math.floor(totalDurations.length * 0.95)];

    // Per-stage median
    const stageDurations: Record<string, number[]> = {};
    for (const task of this.tasks) {
      for (const stage of task.stages) {
        if (stage.durationMs === undefined) continue;
        if (!stageDurations[stage.name]) stageDurations[stage.name] = [];
        stageDurations[stage.name].push(stage.durationMs);
      }
    }
    const p50StageMs: Record<string, number> = {};
    for (const [name, durations] of Object.entries(stageDurations)) {
      const sorted = durations.sort((a, b) => a - b);
      p50StageMs[name] = sorted[Math.floor(sorted.length * 0.5)];
    }

    const ttfts = this.tasks.filter((t) => t.ttftMs !== null).map((t) => t.ttftMs!);
    const ttftAvgMs = ttfts.length > 0 ? ttfts.reduce((a, b) => a + b, 0) / ttfts.length : null;

    const successes = this.tasks.filter((t) => t.success).length;

    return {
      avgTaskMs,
      p50StageMs,
      p95TaskMs,
      ttftAvgMs,
      successRate: successes / this.tasks.length,
      totalTasks: this.tasks.length,
      totalTokens: this.tasks.reduce((sum, t) => sum + t.tokensIn + t.tokensOut, 0),
      totalCost: this.tasks.reduce((sum, t) => sum + t.cost, 0),
    };
  }

  /**
   * Get last task details (for /status).
   */
  getLastTask(): TaskMetric | null {
    return this.tasks[this.tasks.length - 1] || null;
  }

  /**
   * Format report for display.
   */
  formatReport(): string {
    const r = this.getReport();
    let out = '╔═══════════════════════════════════════╗\n';
    out += '║  Performance Report                    ║\n';
    out += '╚═══════════════════════════════════════╝\n\n';
    out += `Total tasks:      ${r.totalTasks}\n`;
    out += `Success rate:     ${(r.successRate * 100).toFixed(0)}%\n`;
    out += `Avg duration:     ${r.avgTaskMs.toFixed(0)}ms\n`;
    out += `P95 duration:     ${r.p95TaskMs.toFixed(0)}ms\n`;
    if (r.ttftAvgMs !== null) {
      out += `Avg TTFT:         ${r.ttftAvgMs.toFixed(0)}ms\n`;
    }
    out += `Total tokens:     ${r.totalTokens}\n`;
    out += `Total cost:       $${r.totalCost.toFixed(4)}\n`;

    if (Object.keys(r.p50StageMs).length > 0) {
      out += `\nStage P50 timings:\n`;
      for (const [name, ms] of Object.entries(r.p50StageMs)) {
        out += `  ${name.padEnd(20)} ${ms}ms\n`;
      }
    }

    return out;
  }
}
