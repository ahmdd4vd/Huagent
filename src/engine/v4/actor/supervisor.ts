/**
 * v4/actor/supervisor.ts
 *
 * Supervisor: manages a tree of actors with restart strategies.
 *
 * OTP-style supervision:
 *   - Supervisor has children (actors or other supervisors)
 *   - When a child crashes, supervisor decides: restart_one / restart_all / restart_after
 *   - Intensity: if too many restarts in a window, supervisor itself crashes
 *
 * Why:
 *   - "Let it crash" — we don't try to recover in-band; we restart fresh
 *   - State preservation: optional, per-actor
 *   - Fault isolation: a buggy actor doesn't take down the engine
 */

import { Actor, type ActorConfig } from "./actor.js";
import type { Address, Transport } from "./transport.js";
import { newAddress } from "./transport.js";

export interface ChildSpec {
  /** Address (assigned if not provided) */
  address?: Address;
  /** Factory: create the actor config (called on each restart) */
  factory: () => ActorConfig<any> | Promise<ActorConfig<any>>;
  /** Restart strategy for this child (default: permanent) */
  restart: "permanent" | "transient" | "temporary";
  /** Type tag for supervisor decisions */
  kind: "worker" | "supervisor";
  /** Importance (lower = restart first) */
  importance: number;
}

export interface SupervisorConfig {
  transport: Transport;
  children: ChildSpec[];
  strategy: "one_for_one" | "one_for_all" | "rest_for_one";
  maxRestarts?: number;
  intensityPeriodMs?: number;
  /** Optional onEvent callback for observability */
  onEvent?: (event: { kind: string; data: unknown }) => void;
}

export class Supervisor {
  readonly address: Address;
  private children = new Map<string, { actor: Actor<any>; spec: ChildSpec }>();
  private config: SupervisorConfig;
  private restartTimes: number[] = [];
  private stopRequested = false;

  constructor(config: SupervisorConfig) {
    this.config = config;
    this.address = newAddress("sup");
  }

  /**
   * Start all children.
   */
  async start(): Promise<void> {
    // Sort children by importance (lower first = restart first)
    const sorted = [...this.config.children].sort((a, b) => a.importance - b.importance);
    for (const spec of sorted) {
      await this.startChild(spec);
    }
  }

  /**
   * Get a child actor by tag (the first part of the address).
   */
  getChild(tag: string): Actor<any> | undefined {
    for (const [key, value] of this.children) {
      if (key.startsWith(tag) || value.spec.address === tag) return value.actor;
    }
    return undefined;
  }

  /**
   * List all child addresses.
   */
  childAddresses(): Address[] {
    return Array.from(this.children.values()).map((c) => c.actor.address);
  }

  /**
   * Notify the supervisor that a child has crashed.
   * The supervisor decides whether to restart the child (and possibly others).
   */
  async notifyCrash(failedAddress: Address, reason: Error): Promise<boolean> {
    this.config.onEvent?.({ kind: "child_crashed", data: { address: failedAddress, reason: reason.message } });

    const maxRestarts = this.config.maxRestarts ?? 5;
    const period = this.config.intensityPeriodMs ?? 5000;
    const now = Date.now();
    this.restartTimes = this.restartTimes.filter((t) => now - t < period);
    if (this.restartTimes.length >= maxRestarts) {
      this.config.onEvent?.({ kind: "supervisor_escalating", data: { reason: "intensity exceeded" } });
      return false;
    }
    this.restartTimes.push(now);

    const failedChild = Array.from(this.children.entries()).find(([_, c]) => c.actor.address === failedAddress);
    if (!failedChild) {
      return false;
    }
    const [, child] = failedChild;
    const spec = child.spec;
    const failedIndex = this.config.children.indexOf(spec);

    if (spec.restart === "temporary") {
      // Don't restart, just remove
      this.children.delete(failedAddress);
      this.config.onEvent?.({ kind: "child_not_restarted", data: { address: failedAddress, reason: "temporary" } });
      return true;
    }

    // Decide who to restart
    let toRestart: ChildSpec[] = [];
    switch (this.config.strategy) {
      case "one_for_one":
        toRestart = [spec];
        break;
      case "one_for_all":
        toRestart = this.config.children.filter((c) => c.restart !== "temporary");
        break;
      case "rest_for_one":
        toRestart = this.config.children.slice(failedIndex).filter((c) => c.restart !== "temporary");
        break;
    }

    this.config.onEvent?.({ kind: "supervisor_restarting", data: { count: toRestart.length, strategy: this.config.strategy } });

    // Stop and restart
    for (const s of toRestart) {
      const c = Array.from(this.children.values()).find((c) => c.spec === s);
      if (c) {
        try { await c.actor.stop("restarting"); } catch {}
        this.children.delete(c.actor.address);
      }
    }
    for (const s of toRestart) {
      await this.startChild(s);
    }

    return true;
  }

  /**
   * Stop the supervisor and all children.
   */
  async stop(): Promise<void> {
    this.stopRequested = true;
    for (const [, child] of this.children) {
      try { await child.actor.stop("supervisor_stopped"); } catch {}
    }
    this.children.clear();
  }

  /**
   * Stats: number of children, restart counts.
   */
  stats(): { children: number; restarts: number } {
    return {
      children: this.children.size,
      restarts: this.restartTimes.length,
    };
  }

  private async startChild(spec: ChildSpec): Promise<void> {
    try {
      const actorConfig = await spec.factory();
      const actor = new Actor(actorConfig);
      await actor.start();
      this.children.set(actor.address, { actor, spec });
      this.config.onEvent?.({ kind: "child_started", data: { address: actor.address, kind: spec.kind } });
    } catch (err) {
      const reason = err instanceof Error ? err : new Error(String(err));
      this.config.onEvent?.({ kind: "child_start_failed", data: { reason: reason.message } });
      throw reason;
    }
  }
}
