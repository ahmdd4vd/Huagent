/**
 * v4 Activity Store — Centralized state for the live activity feed.
 *
 * Design:
 *   - One global ring buffer (capped at MAX_ACTIVITIES)
 *   - Each activity has: id, kind, status, summary, detail, start_ts, end_ts, parent
 *   - Subagent activities can nest (parent → children)
 *   - State is a plain object, mutated via immer-style immutable updates
 *   - Subscribers get notified on every change
 *
 * Inspired by opencode's session-parts (in Solid.js), but minimal.
 */

import { randomUUID } from 'node:crypto';

export type ActivityKind =
  | 'read' | 'write' | 'edit' | 'bash' | 'grep' | 'search' | 'fetch'
  | 'plan' | 'observe' | 'ground' | 'verify' | 'diagnose'
  | 'subagent' | 'message' | 'system';

export type ActivityStatus = 'pending' | 'running' | 'success' | 'error' | 'skipped';

export interface Activity {
  id: string;
  kind: ActivityKind;
  status: ActivityStatus;
  /** 1-line summary (always shown) */
  summary: string;
  /** Optional detailed view (multi-line) */
  detail?: string;
  /** When the activity started (ms since epoch) */
  start_ts: number;
  /** When the activity ended (ms since epoch) */
  end_ts?: number;
  /** Duration in ms (computed at end) */
  durationMs?: number;
  /** Parent activity id (for subagent nesting) */
  parent?: string;
  /** Optional metadata */
  meta?: Record<string, unknown>;
}

export interface SubagentState {
  id: string;
  activityId: string;
  name: string;
  task: string;
  /** 0.0 - 1.0 */
  progress: number;
  status: ActivityStatus;
  start_ts: number;
  end_ts?: number;
}

const MAX_ACTIVITIES = 200;
const MAX_SUBAGENTS = 32;

export interface ActivityStoreState {
  activities: Activity[];
  subagents: SubagentState[];
}

type Listener = (state: ActivityStoreState) => void;

export class ActivityStore {
  private state: ActivityStoreState = {
    activities: [],
    subagents: [],
  };
  private listeners: Set<Listener> = new Set();
  /** Pending activities keyed by id, for quick updates */
  private pending: Map<string, Activity> = new Map();

  // ─── Subscription ──────────────────────────────────────

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getState(): ActivityStoreState {
    return this.state;
  }

  private notify(): void {
    for (const l of this.listeners) l(this.state);
  }

  // ─── Activity lifecycle ────────────────────────────────

  start(kind: ActivityKind, summary: string, opts?: { parent?: string; meta?: Record<string, unknown> }): Activity {
    const activity: Activity = {
      id: randomUUID(),
      kind,
      status: 'running',
      summary,
      start_ts: Date.now(),
      parent: opts?.parent,
      meta: opts?.meta,
    };
    this.appendActivity(activity);
    this.pending.set(activity.id, activity);
    this.notify();
    return activity;
  }

  /**
   * Append an activity to the ring buffer. If we're at capacity, drop the
   * oldest activities (but keep all subagent activities).
   */
  private appendActivity(activity: Activity): void {
    this.state = {
      ...this.state,
      activities: [...this.state.activities, activity].slice(-MAX_ACTIVITIES),
    };
  }

  /**
   * Update an existing activity. Use this to add detail, mark progress, or
   * finalize status.
   */
  update(id: string, patch: Partial<Activity>): void {
    const idx = this.state.activities.findIndex((a) => a.id === id);
    if (idx === -1) return;
    const old = this.state.activities[idx];
    const updated: Activity = { ...old, ...patch };
    if (patch.status && patch.status !== 'running' && !updated.end_ts) {
      updated.end_ts = Date.now();
      updated.durationMs = updated.end_ts - updated.start_ts;
    }
    const next = this.state.activities.slice();
    next[idx] = updated;
    this.state = { ...this.state, activities: next };
    if (updated.status !== 'running') {
      this.pending.delete(id);
    }
    this.notify();
  }

  /**
   * Finish an activity. Convenience: update({ status, ...rest }).
   */
  finish(id: string, status: ActivityStatus, opts?: { summary?: string; detail?: string }): void {
    // Build patch carefully — only include keys that are actually defined,
    // so we don't accidentally clobber the activity's existing summary/detail.
    const patch: Partial<Activity> = { status };
    if (opts?.summary !== undefined) patch.summary = opts.summary;
    if (opts?.detail !== undefined) patch.detail = opts.detail;
    this.update(id, patch);
  }

  /**
   * End a running activity with success.
   */
  succeed(id: string, summary?: string, detail?: string): void {
    this.finish(id, 'success', { summary, detail });
  }

  /**
   * End a running activity with error.
   */
  fail(id: string, summary?: string, detail?: string): void {
    this.finish(id, 'error', { summary, detail });
  }

  // ─── Subagent tracking ─────────────────────────────────

  registerSubagent(name: string, task: string): { activity: Activity; sub: SubagentState } {
    const activity = this.start('subagent', `subagent ${name}`, { meta: { name, task } });
    const sub: SubagentState = {
      id: randomUUID(),
      activityId: activity.id,
      name,
      task,
      progress: 0,
      status: 'running',
      start_ts: Date.now(),
    };
    this.state = {
      ...this.state,
      subagents: [...this.state.subagents, sub].slice(-MAX_SUBAGENTS),
    };
    this.notify();
    return { activity, sub };
  }

  updateSubagent(id: string, patch: Partial<SubagentState>): void {
    const idx = this.state.subagents.findIndex((s) => s.id === id);
    if (idx === -1) return;
    const old = this.state.subagents[idx];
    const next = this.state.subagents.slice();
    next[idx] = { ...old, ...patch };
    if (patch.status && patch.status !== 'running' && !next[idx].end_ts) {
      next[idx].end_ts = Date.now();
    }
    this.state = { ...this.state, subagents: next };
    this.notify();
  }

  finishSubagent(id: string, status: ActivityStatus, progress: number = 1.0): void {
    const sub = this.state.subagents.find((s) => s.id === id);
    if (!sub) return;
    this.updateSubagent(id, { status, progress });
    this.finish(sub.activityId, status);
  }

  // ─── Bulk operations ────────────────────────────────────

  clear(): void {
    this.state = { activities: [], subagents: [] };
    this.pending.clear();
    this.notify();
  }

  // ─── Engine bridge: convert v4 CognitiveEvent → Activity ──

  /**
   * Ingest a v4 CognitiveEvent. Returns the activity id if the event
   * produced one, else null.
   */
  ingestEvent(event: { kind: string; [k: string]: any }): string | null {
    switch (event.kind) {
      // ── Discipline beats ──
      case 'plan_beat': {
        const beat = event.beat;
        if (!beat) return null;
        const summary = `${beat.goal}`;
        return this.start('plan', summary, { meta: { hypothesis: beat.hypothesis, beat } }).id;
      }
      case 'observe_beat': {
        const beat = event.beat;
        if (!beat) return null;
        return this.start('observe', `${beat.tool} → ${beat.summary}`, { meta: { beat } }).id;
      }
      case 'ground_beat': {
        const beat = event.beat;
        if (!beat) return null;
        const summary = `ground: ${beat.checks.length} checks (${beat.totalDurationMs}ms)`;
        return this.start('ground', summary, { meta: { beat } }).id;
      }
      case 'verify_started': {
        return this.start('verify', `${event.filePath} → ${event.command}`).id;
      }
      case 'verify_completed': {
        const r = event.result;
        if (!r) return null;
        // Find the matching started activity by command/filePath
        const pendingVerify = this.findPendingByCommand(r.command, r.filePath);
        if (pendingVerify) {
          this.finish(pendingVerify.id, r.passed ? 'success' : 'error', {
            summary: `${r.filePath}: ${r.passed ? 'passed' : 'failed'} (${r.exitCode})`,
            detail: r.output,
          });
          return pendingVerify.id;
        }
        return this.start('verify', `${r.filePath}: ${r.passed ? 'passed' : 'failed'}`).id;
      }
      case 'verify_failed': {
        const r = event.result;
        if (!r) return null;
        const pendingVerify = this.findPendingByCommand(r.command, r.filePath);
        if (pendingVerify) {
          this.finish(pendingVerify.id, 'error', {
            summary: `${r.filePath}: failed (${r.exitCode})`,
            detail: r.output,
          });
          return pendingVerify.id;
        }
        return this.start('verify', `${r.filePath}: failed`).id;
      }
      case 'diagnose_started':
      case 'diagnose_completed':
        // Already created via the diagnose_* lifecycle; we synthesize a single activity per diagnose call
        return null;
      // ── HTN / Speculation ──
      case 'subgoal_started': {
        return this.start('plan', event.description, { meta: { subgoalId: event.subgoalId } }).id;
      }
      case 'subgoal_completed': {
        const pending = this.findPendingByMeta('subgoalId', event.subgoalId);
        if (pending) {
          this.finish(pending.id, event.ok ? 'success' : 'error');
          return pending.id;
        }
        return null;
      }
      case 'step_started': {
        return this.start(this.inferKindFromTool(event.tool), `${event.tool} (${event.stepId})`, {
          meta: { stepId: event.stepId, tool: event.tool },
        }).id;
      }
      case 'step_completed': {
        const pending = this.findPendingByMeta('stepId', event.stepId);
        if (pending) {
          this.finish(pending.id, event.ok ? 'success' : 'error');
          return pending.id;
        }
        return null;
      }
      // ── Tool calls ──
      case 'tool_call': {
        const kind = this.inferKindFromTool(event.tool);
        const args = event.args || {};
        const detail = this.summarizeArgs(event.tool, args);
        return this.start(kind, detail, {
          meta: { tool: event.tool, args, stepId: event.stepId },
        }).id;
      }
      case 'tool_result': {
        const tool = event.tool;
        const pending = this.findPendingByMeta('tool', tool);
        if (pending) {
          const resultStr = this.summarizeResult(event.result);
          this.finish(pending.id, 'success', { detail: resultStr });
          return pending.id;
        }
        return null;
      }
      case 'tool_error': {
        const pending = this.findPendingByMeta('tool', event.tool);
        if (pending) {
          this.finish(pending.id, 'error', { detail: event.error });
          return pending.id;
        }
        return null;
      }
      // ── Speculation ──
      case 'speculation_started': {
        return this.start('plan', `speculate ${event.strategies.length} strategies`).id;
      }
      case 'strategy_succeeded': {
        return null; // already covered by step_completed
      }
      case 'speculation_winner': {
        return null;
      }
      default:
        return null;
    }
  }

  // ─── Internals ──────────────────────────────────────────

  private inferKindFromTool(tool: string): ActivityKind {
    if (tool === 'read_file' || tool === 'Read' || tool === 'read') return 'read';
    if (tool === 'write_file' || tool === 'Write' || tool === 'write') return 'write';
    if (tool === 'Edit' || tool === 'edit' || tool === 'MultiEdit') return 'edit';
    if (tool === 'bash' || tool === 'Bash' || tool === 'shell') return 'bash';
    if (tool === 'grep' || tool === 'Grep' || tool === 'search_files') return 'grep';
    if (tool === 'WebSearch' || tool === 'web_search') return 'search';
    if (tool === 'WebFetch' || tool === 'web_fetch') return 'fetch';
    if (tool === 'verify') return 'verify';
    return 'bash';
  }

  private summarizeArgs(tool: string, args: any): string {
    if (tool === 'read_file' || tool === 'Read') {
      return `read ${args.file_path ?? args.path ?? '?'}`;
    }
    if (tool === 'write_file' || tool === 'Write') {
      return `write ${args.file_path ?? args.path ?? '?'}`;
    }
    if (tool === 'Edit' || tool === 'MultiEdit') {
      return `edit ${args.file_path ?? args.path ?? '?'}`;
    }
    if (tool === 'bash' || tool === 'Bash') {
      const cmd = (args.command ?? '').toString();
      return `$ ${cmd.length > 60 ? cmd.slice(0, 57) + '…' : cmd}`;
    }
    if (tool === 'grep' || tool === 'Grep') {
      return `grep "${args.pattern ?? '?'}" in ${args.path ?? '.'}`;
    }
    return `${tool}(${JSON.stringify(args).slice(0, 60)})`;
  }

  private summarizeResult(result: unknown): string {
    if (result === null || result === undefined) return 'no result';
    if (typeof result === 'string') return `${result.length} chars`;
    if (typeof result === 'object' && result !== null) {
      const obj = result as Record<string, unknown>;
      if ('stdout' in obj || 'exitCode' in obj) {
        const exit = 'exitCode' in obj ? `exit=${obj.exitCode}` : '';
        const len = 'stdout' in obj ? `${String(obj.stdout).length}c` : '';
        return [exit, len].filter(Boolean).join(' ');
      }
      if ('content' in obj) return `${String(obj.content).length} chars`;
      return `${Object.keys(obj).length} keys`;
    }
    return String(result);
  }

  private findPendingByMeta(key: string, value: string): Activity | null {
    for (const a of this.state.activities) {
      if (a.meta?.[key] === value && a.status === 'running') return a;
    }
    return null;
  }

  private findPendingByCommand(command: string, filePath: string): Activity | null {
    for (const a of this.state.activities) {
      if (a.kind === 'verify' && a.status === 'running') {
        // Match by file path appearing in summary
        if (a.summary.includes(filePath)) return a;
      }
    }
    return null;
  }
}

// ─── Singleton (per process) ───────────────────────────────────
let _store: ActivityStore | null = null;
export function getActivityStore(): ActivityStore {
  if (!_store) _store = new ActivityStore();
  return _store;
}
export function resetActivityStore(): void {
  _store = null;
}
