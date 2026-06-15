/**
 * v4/actor/actor.ts
 *
 * The Actor base class: gen_server-style contract.
 *
 *   1. Actor has a state (typed) and a behavior (handle message).
 *   2. Each actor runs in its own "process" (async loop).
 *   3. On crash, the supervisor restarts with a fresh state (or preserved
 *      state if `preserveStateOnRestart` is true).
 *   4. Messages are processed serially within an actor (no concurrent
 *      state mutation).
 *
 * State preservation: when a crash happens, the supervisor calls
 * `preRestart(reason, state)` to optionally extract a snapshot, then
 * `postRestart(snapshot)` on the new instance to restore it.
 *
 * For v4.0, we default to "fresh state on restart". A future enhancement
 * could persist state to a snapshot file.
 */

import type { Address, ActorMessage, Transport } from "./transport.js";

/**
 * Actor behavior: how to handle messages.
 */
export interface ActorBehavior<S, M = unknown> {
  /** Initial state */
  init: () => S | Promise<S>;
  /** Handle a message; may return a new state */
  handle: (state: S, msg: ActorMessage<M>) => Promise<S | void> | S | void;
  /** Optional: called before restart to extract state */
  preRestart?: (reason: Error, state: S) => S | undefined | Promise<S | undefined>;
  /** Optional: called after restart to recover state */
  postRestart?: (snapshot: S | undefined) => S | Promise<S>;
  /** Optional: cleanup on stop */
  terminate?: (reason: string, state: S) => void | Promise<void>;
}

/**
 * Restart strategy (OTP-inspired).
 */
export type RestartStrategy =
  | "one_for_one"   // restart only the failed actor
  | "one_for_all"   // restart all actors in the supervision tree
  | "rest_for_one"; // restart failed + all started after it

/**
 * Supervisor configuration for an actor.
 */
export interface ActorConfig<S> {
  /** Address (assigned if not provided) */
  address?: Address;
  /** Behavior */
  behavior: ActorBehavior<S>;
  /** Transport to use (shared with supervisor) */
  transport: Transport;
  /** Preserve state across restarts? Default: false */
  preserveStateOnRestart?: boolean;
  /** Max restarts in `intensityPeriodMs` before giving up */
  maxRestarts?: number;
  /** Time window for restart intensity check (ms) */
  intensityPeriodMs?: number;
  /** Initial delay before first start (ms) */
  startDelayMs?: number;
}

/**
 * Stats about an actor.
 */
export interface ActorStats {
  address: Address;
  startedAt: number;
  messageCount: number;
  crashCount: number;
  lastCrashReason?: string;
  lastCrashAt?: number;
  alive: boolean;
}

/**
 * The Actor.
 */
export class Actor<S = unknown> {
  readonly address: Address;
  private state: S | undefined;
  private stats: ActorStats;
  private loop?: Promise<void>;
  private stopRequested = false;
  private restartTimes: number[] = [];
  private config: ActorConfig<S>;
  private crashed = false;
  private crashError?: Error;

  constructor(config: ActorConfig<S>) {
    this.config = config;
    this.address = config.address ?? `actor-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.stats = {
      address: this.address,
      startedAt: Date.now(),
      messageCount: 0,
      crashCount: 0,
      alive: false,
    };
    // Register with transport
    config.transport.register(this.address, (msg) => this.deliver(msg));
  }

  /**
   * Start the actor (initialize state, begin message loop).
   */
  async start(): Promise<void> {
    this.state = await this.config.behavior.init();
    this.stats.alive = true;
    this.stats.startedAt = Date.now();
    this.startLoop();
  }

  /**
   * Send a message to this actor.
   */
  async send(kind: string, payload: unknown, opts?: { replyTo?: Address; correlationId?: string }): Promise<boolean> {
    return this.config.transport.send(this.address, { kind, payload, ...opts });
  }

  /**
   * Stop the actor gracefully.
   */
  async stop(reason: string = "normal"): Promise<void> {
    this.stopRequested = true;
    if (this.config.behavior.terminate && this.state !== undefined) {
      await this.config.behavior.terminate(reason, this.state);
    }
    this.config.transport.kill(this.address, reason);
    this.stats.alive = false;
    if (this.loop) {
      // Wait for loop to exit
      try { await this.loop; } catch {}
    }
  }

  /**
   * Get current state (read-only access).
   * Returns undefined if not yet started.
   */
  getState(): S | undefined {
    return this.state;
  }

  getStats(): ActorStats {
    return { ...this.stats };
  }

  /**
   * Internal: deliver a message to the actor's handler.
   */
  private async deliver(msg: ActorMessage): Promise<void> {
    if (this.crashed) {
      // Re-throw to supervisor
      throw this.crashError ?? new Error("actor crashed");
    }
    try {
      const newState = await this.config.behavior.handle(this.state as S, msg as ActorMessage<any>);
      if (newState !== undefined) this.state = newState as S;
      this.stats.messageCount++;
    } catch (err) {
      this.crashed = true;
      this.crashError = err instanceof Error ? err : new Error(String(err));
      this.stats.crashCount++;
      this.stats.lastCrashReason = this.crashError.message;
      this.stats.lastCrashAt = Date.now();
      throw this.crashError;
    }
  }

  private startLoop(): void {
    this.loop = (async () => {
      // Continuously pull messages from our mailbox and deliver to handler.
      // If handler throws, the actor is marked as crashed; the loop exits
      // and the supervisor decides what to do.
      while (!this.stopRequested && !this.crashed) {
        try {
          const msg = await this.config.transport.receive(this.address);
          // If transport returns null, the actor was killed
          if (msg === null) break;
        } catch (err) {
          // The handler threw. We're now in crashed state.
          // Exit the loop; supervisor will decide.
          break;
        }
      }
    })();
  }

  /**
   * For supervisor use: attempt to restart this actor.
   * Returns true if restart succeeded; false if intensity exceeded.
   */
  async restart(reason: Error): Promise<boolean> {
    const maxRestarts = this.config.maxRestarts ?? 5;
    const period = this.config.intensityPeriodMs ?? 5000;

    // Intensity check: how many restarts in last `period` ms?
    const now = Date.now();
    this.restartTimes = this.restartTimes.filter((t) => now - t < period);
    if (this.restartTimes.length >= maxRestarts) {
      // Too many restarts; escalate
      return false;
    }
    this.restartTimes.push(now);

    // Preserve state if configured
    let snapshot: S | undefined;
    if (this.config.preserveStateOnRestart && this.config.behavior.preRestart && this.state !== undefined) {
      snapshot = await this.config.behavior.preRestart(reason, this.state);
    } else if (this.config.preserveStateOnRestart && this.state !== undefined) {
      snapshot = this.state;
    }

    // Reset crashed flag
    this.crashed = false;
    this.crashError = undefined;

    // Re-init state
    this.state = await this.config.behavior.init();
    if (this.config.behavior.postRestart && snapshot !== undefined) {
      this.state = await this.config.behavior.postRestart(snapshot);
    }
    this.stats.startedAt = Date.now();
    this.stats.alive = true;
    return true;
  }
}
