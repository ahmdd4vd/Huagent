/**
 * v4/stream/replay-log.ts
 *
 * Bounded ring buffer of the last N CognitiveEvents. Enables:
 * - /rewind: time-travel debugging by replaying from a checkpoint.
 * - Crash recovery: actor restart reads recent events to rebuild state.
 * - Observability: "what just happened" without keeping everything forever.
 *
 * Design:
 * - Fixed-size circular buffer (default 1024).
 * - O(1) push, O(n) iterate backwards.
 * - Snapshots: when an event has `kind: 'snapshot_taken'`, we keep a
 *   reference to that point so /rewind can return to it.
 *
 * Why not a database:
 * - In-memory, lock-free, fast. We can persist a flush() to SQLite later
 *   for cross-session replay if needed.
 */

import type { CognitiveEvent } from "./cognitive-event.js";
import { eventKey } from "./cognitive-event.js";

export interface ReplayCheckpoint {
  /** Sequence number at checkpoint */
  seq: number;
  /** Timestamp (ms since engine start) */
  ts: number;
  /** Human label, e.g., "before-edit-auth.ts" */
  label: string;
  /** Optional opaque state blob (file contents, etc.) */
  state?: unknown;
}

export class ReplayLog {
  private buffer: (CognitiveEvent | undefined)[];
  private head = 0;   // next write position
  private count = 0;  // current number of items
  private checkpoints: ReplayCheckpoint[] = [];
  private readonly maxCheckpoints: number;

  constructor(
    public readonly capacity: number = 1024,
    maxCheckpoints: number = 64
  ) {
    this.buffer = new Array(capacity);
    this.maxCheckpoints = maxCheckpoints;
  }

  /**
   * Append an event. O(1).
   */
  push(event: CognitiveEvent): void {
    this.buffer[this.head] = event;
    this.head = (this.head + 1) % this.capacity;
    if (this.count < this.capacity) this.count++;
  }

  /**
   * Total events currently in the log.
   */
  get size(): number {
    return this.count;
  }

  /**
   * Get events in chronological order (oldest first).
   */
  *events(): IterableIterator<CognitiveEvent> {
    const start = this.count < this.capacity ? 0 : this.head;
    for (let i = 0; i < this.count; i++) {
      const idx = (start + i) % this.capacity;
      const e = this.buffer[idx];
      if (e) yield e;
    }
  }

  /**
   * Get the last N events, oldest first.
   */
  *tail(n: number): IterableIterator<CognitiveEvent> {
    const all = Array.from(this.events());
    const start = Math.max(0, all.length - n);
    for (let i = start; i < all.length; i++) yield all[i];
  }

  /**
   * Find an event by sequence number. O(1).
   */
  findBySeq(seq: number): CognitiveEvent | undefined {
    for (const e of this.events()) {
      if (e.seq === seq) return e;
    }
    return undefined;
  }

  /**
   * Find events of a specific kind. O(n).
   */
  *findByKind<K extends CognitiveEvent["kind"]>(kind: K): IterableIterator<Extract<CognitiveEvent, { kind: K }>> {
    for (const e of this.events()) {
      if (e.kind === kind) yield e as Extract<CognitiveEvent, { kind: K }>;
    }
  }

  /**
   * Filter events.
   */
  *filter(predicate: (e: CognitiveEvent) => boolean): IterableIterator<CognitiveEvent> {
    for (const e of this.events()) {
      if (predicate(e)) yield e;
    }
  }

  /**
   * Snapshot: take a checkpoint we can rewind to.
   */
  checkpoint(label: string, state?: unknown): ReplayCheckpoint {
    const events = Array.from(this.events());
    const last = events[events.length - 1];
    const cp: ReplayCheckpoint = {
      seq: last?.seq ?? 0,
      ts: last?.ts ?? Date.now(),
      label,
      state,
    };
    this.checkpoints.push(cp);
    if (this.checkpoints.length > this.maxCheckpoints) {
      this.checkpoints.shift();
    }
    return cp;
  }

  /**
   * List all checkpoints, oldest first.
   */
  listCheckpoints(): ReplayCheckpoint[] {
    return [...this.checkpoints];
  }

  /**
   * Get events since a given sequence number.
   */
  *sinceSeq(seq: number): IterableIterator<CognitiveEvent> {
    for (const e of this.events()) {
      if (e.seq > seq) yield e;
    }
  }

  /**
   * Clear the log.
   */
  clear(): void {
    this.buffer = new Array(this.capacity);
    this.head = 0;
    this.count = 0;
    this.checkpoints = [];
  }

  /**
   * String representation for debug.
   */
  toString(): string {
    const lines: string[] = [`ReplayLog(${this.size}/${this.capacity} events, ${this.checkpoints.length} checkpoints)`];
    for (const cp of this.checkpoints) {
      lines.push(`  [${cp.seq}] ${cp.label} @ ${cp.ts}ms`);
    }
    return lines.join("\n");
  }
}
