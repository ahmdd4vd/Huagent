/**
 * LintScheduler - Menjalankan linter secara berkala untuk audit wiki.
 * 
 * Fitur:
 * - Configurable interval (default: 24 jam)
 * - Auto-fix issues yang bisa di-fix otomatis
 * - Generate report card (grade A-F)
 * - Track lint history
 */

import type { WikiStore } from "../graph/wiki-store.js";
import { Linter, type LintReport, type LintOptions } from "./linter.js";

export interface LintSchedulerOptions {
  /** Interval dalam milliseconds (default: 24 jam) */
  intervalMs?: number;
  /** Lint options untuk diteruskan ke Linter */
  lintOptions?: LintOptions;
  /** Callback saat lint selesai */
  onLintComplete?: (report: LintReport) => void;
  /** Auto-fix issues yang bisa di-fix */
  autoFix?: boolean;
}

export interface LintHistory {
  timestamp: Date;
  report: LintReport;
}

export class LintScheduler {
  private store: WikiStore;
  private linter: Linter;
  private intervalMs: number;
  private lintOptions: LintOptions;
  private autoFix: boolean;
  private timer: NodeJS.Timeout | null = null;
  private history: LintHistory[] = [];
  private onLintComplete?: (report: LintReport) => void;

  constructor(store: WikiStore, options: LintSchedulerOptions = {}) {
    this.store = store;
    this.linter = new Linter(store);
    this.intervalMs = options.intervalMs ?? 24 * 60 * 60 * 1000; // 24 jam
    this.lintOptions = options.lintOptions ?? {};
    this.autoFix = options.autoFix ?? false;
    this.onLintComplete = options.onLintComplete;
  }

  /**
   * Start scheduler - jalanin lint secara berkala
   */
  start(): void {
    if (this.timer) {
      console.warn('[LintScheduler] Scheduler already running');
      return;
    }

    console.log(`[LintScheduler] Starting scheduler (interval: ${this.intervalMs / 1000 / 60 / 60}h)`);
    
    // Jalanin lint pertama kali langsung
    this.runLint();

    // Set interval
    this.timer = setInterval(() => {
      this.runLint();
    }, this.intervalMs);
  }

  /**
   * Stop scheduler
   */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      console.log('[LintScheduler] Scheduler stopped');
    }
  }

  /**
   * Jalanin lint sekali (bisa dipanggil manual)
   */
  async runLint(): Promise<LintReport> {
    console.log('[LintScheduler] Running lint...');
    const startTime = Date.now();

    try {
      const report = await this.linter.lint(this.lintOptions);

      // Auto-fix jika di-enable
      if (this.autoFix && report.issues.length > 0) {
        await this.autoFixIssues(report);
      }

      // Simpan ke history
      this.history.push({
        timestamp: new Date(),
        report,
      });

      // Callback
      if (this.onLintComplete) {
        this.onLintComplete(report);
      }

      const duration = Date.now() - startTime;
      console.log(`[LintScheduler] Lint completed in ${duration}ms`);
      console.log(`  Grade: ${report.summary.grade} (score: ${report.summary.score}/100)`);
      console.log(`  Issues: ${report.summary.totalIssues} (${report.summary.bySeverity.error} errors, ${report.summary.bySeverity.warning} warnings, ${report.summary.bySeverity.info} info)`);

      return report;
    } catch (error) {
      console.error('[LintScheduler] Lint failed:', error);
      throw error;
    }
  }

  /**
   * Auto-fix issues yang bisa di-fix otomatis
   */
  private async autoFixIssues(report: LintReport): Promise<void> {
    console.log('[LintScheduler] Auto-fixing issues...');
    let fixedCount = 0;

    for (const issue of report.issues) {
      // Hanya fix issues yang punya suggestion
      if (!issue.suggestion || !issue.pageId) {
        continue;
      }

      try {
        // Fix berdasarkan check type
        switch (issue.check) {
          case 'title':
            // Skip - butuh human judgment
            break;

          case 'confidence':
            // Skip - butuh verification
            break;

          case 'freshness':
            // Refresh freshness
            await this.store.refreshFreshness(issue.pageId);
            fixedCount++;
            break;

          case 'backlinks':
            // Skip - butuh human judgment buat nentuin link
            break;

          case 'tags':
            // Skip - butuh human judgment buat milih tags
            break;

          case 'body':
            // Skip - butuh human judgment
            break;

          case 'conflicts':
            // Skip - butuh human resolution
            break;
        }
      } catch (error) {
        console.error(`[LintScheduler] Failed to fix issue ${issue.check} on page ${issue.pageId}:`, error);
      }
    }

    console.log(`[LintScheduler] Auto-fixed ${fixedCount} issues`);
  }

  /**
   * Get lint history
   */
  getHistory(limit: number = 10): LintHistory[] {
    return this.history.slice(-limit);
  }

  /**
   * Get latest lint report
   */
  getLatestReport(): LintReport | null {
    if (this.history.length === 0) {
      return null;
    }
    return this.history[this.history.length - 1].report;
  }

  /**
   * Check if scheduler is running
   */
  isRunning(): boolean {
    return this.timer !== null;
  }

  /**
   * Get scheduler status
   */
  getStatus(): {
    running: boolean;
    intervalMs: number;
    lastRun: Date | null;
    historyCount: number;
  } {
    return {
      running: this.isRunning(),
      intervalMs: this.intervalMs,
      lastRun: this.history.length > 0 ? this.history[this.history.length - 1].timestamp : null,
      historyCount: this.history.length,
    };
  }
}
