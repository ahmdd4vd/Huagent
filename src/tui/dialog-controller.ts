/**
 * DialogController — singleton that mediates between the engine and the TUI.
 *
 * When the engine wants to ask the user a question, request permission,
 * or review a plan, it calls one of these methods. The controller:
 *   1. Stores the pending request in state
 *   2. Notifies subscribers (the TUI)
 *   3. Returns a Promise that resolves when the user answers (via the TUI)
 *
 * The TUI subscribes via `subscribe()` and renders the right dialog
 * component. When the user picks an option, the TUI calls `resolve*()`
 * which completes the Promise and lets the engine continue.
 */

import type { QuestionRequest, PermissionRequest, PermissionDecisionType, Plan } from '../engine/core.js';

type Listener = () => void;

export interface DialogState {
  question: { request: QuestionRequest; resolve: (answers: string[][]) => void } | null;
  permission: { request: PermissionRequest; resolve: (d: PermissionDecisionType) => void } | null;
  plan: { plan: Plan; resolve: (r: 'approve' | 'reject' | 'edit') => void } | null;
}

class DialogControllerImpl {
  private state: DialogState = { question: null, permission: null, plan: null };
  private listeners = new Set<Listener>();
  private eventListeners = new Set<(event: any) => void>();

  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  /** Subscribe to engine events (plan_created, step_done, tool_call, etc). */
  subscribeEvents(l: (event: any) => void): () => void {
    this.eventListeners.add(l);
    return () => this.eventListeners.delete(l);
  }

  /** Publish an engine event to all subscribers. */
  publishEvent(event: any): void {
    for (const l of this.eventListeners) {
      try { l(event); } catch {}
    }
  }

  getState(): DialogState {
    return this.state;
  }

  private notify() {
    for (const l of this.listeners) l();
  }

  /** Engine calls this to ask the user one or more questions. */
  askUser(request: Omit<QuestionRequest, 'id'>): Promise<string[][]> {
    return new Promise((resolve) => {
      const fullRequest: QuestionRequest = {
        id: `q-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        ...request,
      };
      this.state.question = { request: fullRequest, resolve };
      this.notify();
    });
  }

  /** Engine calls this to request tool permission. */
  requestPermission(req: Omit<PermissionRequest, 'id'>): Promise<PermissionDecisionType> {
    return new Promise((resolve) => {
      const fullRequest: PermissionRequest = {
        id: `p-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        ...req,
      };
      this.state.permission = { request: fullRequest, resolve };
      this.notify();
    });
  }

  /** Engine calls this to pause for plan review. */
  reviewPlan(plan: Plan): Promise<'approve' | 'reject' | 'edit'> {
    return new Promise((resolve) => {
      this.state.plan = { plan, resolve };
      this.notify();
    });
  }

  // ── TUI-side resolvers ─────────────────────────────────────
  resolveQuestion(answers: string[][]): void {
    const q = this.state.question;
    if (!q) return;
    this.state.question = null;
    q.resolve(answers);
    this.notify();
  }

  rejectQuestion(): void {
    const q = this.state.question;
    if (!q) return;
    this.state.question = null;
    // Treat as empty answer
    q.resolve([]);
    this.notify();
  }

  resolvePermission(decision: PermissionDecisionType): void {
    const p = this.state.permission;
    if (!p) return;
    this.state.permission = null;
    p.resolve(decision);
    this.notify();
  }

  resolvePlan(r: 'approve' | 'reject' | 'edit'): void {
    const p = this.state.plan;
    if (!p) return;
    this.state.plan = null;
    p.resolve(r);
    this.notify();
  }

  /**
   * Reject all pending question/permission/plan promises with safe defaults.
   * Used by `resetDialogController()` to prevent the engine from hanging
   * forever when the dialog controller singleton is replaced mid-session.
   */
  rejectAllPending(): void {
    if (this.state.question) {
      this.state.question.resolve([]);
      this.state.question = null;
    }
    if (this.state.permission) {
      this.state.permission.resolve('deny');
      this.state.permission = null;
    }
    if (this.state.plan) {
      this.state.plan.resolve('reject');
      this.state.plan = null;
    }
  }
}

// Module-level singleton
let _instance: DialogControllerImpl | null = null;
export function getDialogController(): DialogControllerImpl {
  if (!_instance) _instance = new DialogControllerImpl();
  return _instance;
}

// Test helper
export function resetDialogController(): void {
  if (_instance) {
    // CRITICAL: Reject any pending promises before replacing the instance,
    // otherwise the engine will hang forever waiting for an answer that
    // will never come.
    _instance.rejectAllPending();
    _instance = new DialogControllerImpl();
  }
}

export type DialogController = DialogControllerImpl;
