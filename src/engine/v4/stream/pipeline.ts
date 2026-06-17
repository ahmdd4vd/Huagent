/**
 * v4/stream/pipeline.ts
 *
 * The pipeline primitive: a chain of operators that consume and emit
 * CognitiveEvents. This is the core abstraction that replaces the ReAct
 * loop. We build on top of Node's native Web Streams (WHATWG), with
 * additional pull-demand backpressure and AbortController-based cancellation.
 *
 * Why custom on top of WHATWG:
 * - We need bounded queues with explicit backpressure semantics.
 * - We need replay logs (Flink-style event sourcing).
 * - We need tee() for fan-out (e.g., 3-critic mesh consumes the same event).
 * - We need operators to be composable as functions.
 *
 * The mental model:
 *   Source  --pull()-->  Transform1  --pull()-->  Transform2  --pull()-->  Sink
 *                ↑______________________________|
 *                backpressure: if Sink is slow, Transform2 blocks
 */

import type { CognitiveEvent, EventOf } from "./cognitive-event.js";
import { EventFactory, eventKey, summarize } from "./cognitive-event.js";

/**
 * Backpressure strategy: how to handle a slow consumer.
 *
 * - `block` (default): pause upstream, wait for consumer to catch up.
 *   Simple, but can cause head-of-line blocking.
 * - `drop_old`: drop oldest events when buffer is full. Useful for log streams.
 * - `drop_new`: drop newest events when buffer is full. Useful for "latest state" streams.
 * - `error`: throw if buffer is full. Strict mode for debugging.
 */
export type BackpressureStrategy = "block" | "drop_old" | "drop_new" | "error";

/**
 * Bounded queue with the four backpressure strategies.
 *
 * Designed for an in-process stream; not thread-safe. The whole point of
 * an actor model is that there's no shared state across actors, so a single
 * bounded queue per stage is enough.
 */
export class BoundedQueue<T> {
  private items: T[] = [];
  // CRITICAL FIX: separate consumer-waiters (pull waiting for items) from
  // producer-waiters (push waiting for space). The previous code used a
  // single `waiters` array for both, which caused deadlocks and data loss:
  // when pull() shifted an item, it never notified the producer-waiter that
  // space was now available. The producer hung forever and its item was lost.
  private consumerWaiters: Array<(item: T | null) => void> = [];
  private producerWaiters: Array<() => void> = [];
  private closed = false;

  constructor(
    public readonly capacity: number = 64,
    public readonly strategy: BackpressureStrategy = "block"
  ) {
    if (capacity < 1) throw new Error(`BoundedQueue capacity must be >= 1, got ${capacity}`);
  }

  /**
   * Push an item. Behavior depends on strategy:
   * - block: returns Promise that resolves when there's space
   * - drop_old: silently drops the oldest, returns resolved
   * - drop_new: silently drops this item, returns resolved
   * - error: throws if at capacity
   *
   * Returns true if the item was enqueued, false if dropped, throws on error strategy.
   */
  async push(item: T): Promise<boolean> {
    if (this.closed) {
      throw new Error("BoundedQueue: push on closed queue");
    }
    // If there's a consumer waiting, deliver directly.
    const cw = this.consumerWaiters.shift();
    if (cw) {
      cw(item);
      return true;
    }
    if (this.items.length < this.capacity) {
      this.items.push(item);
      return true;
    }
    switch (this.strategy) {
      case "block":
        // Wait for a pull to free up space. The producer-waiter is called
        // by pull() when an item is shifted (making room).
        await new Promise<void>((resolve) => {
          this.producerWaiters.push(resolve);
        });
        if (this.closed) return false;
        // Space is now available — push our item.
        this.items.push(item);
        return true;
      case "drop_old":
        this.items.shift();
        this.items.push(item);
        return false;
      case "drop_new":
        return false;
      case "error":
        throw new Error(`BoundedQueue: capacity ${this.capacity} exceeded (strategy=error)`);
    }
  }

  /**
   * Pull an item. Returns null if the queue is closed and empty.
   */
  async pull(signal?: AbortSignal): Promise<T | null> {
    if (this.items.length > 0) {
      const item = this.items.shift()!;
      // CRITICAL FIX: after shifting an item, notify a producer-waiter
      // that space is now available. The producer will push its item
      // into items[], which the NEXT pull() will pick up.
      const pw = this.producerWaiters.shift();
      if (pw) pw();
      return item;
    }
    if (this.closed) return null;
    // No items available — wait for a push.
    return new Promise<T | null>((resolve) => {
      const abort = () => {
        const idx = this.consumerWaiters.findIndex((w) => w === waiter);
        if (idx >= 0) this.consumerWaiters.splice(idx, 1);
        resolve(null);
      };
      const waiter = (item: T | null) => resolve(item);
      if (signal) {
        if (signal.aborted) {
          abort();
          return;
        }
        signal.addEventListener("abort", abort, { once: true });
      }
      this.consumerWaiters.push(waiter);
    });
  }

  close(): void {
    this.closed = true;
    // Notify all consumer-waiters with null (signals closed).
    for (const w of this.consumerWaiters) w(null);
    this.consumerWaiters = [];
    // Notify all producer-waiters (they'll check `this.closed` and return false).
    for (const w of this.producerWaiters) w();
    this.producerWaiters = [];
  }

  /**
   * Drain all remaining items, returning them. Does not close the queue.
   */
  drain(): T[] {
    const items = this.items;
    this.items = [];
    return items;
  }

  get size(): number {
    return this.items.length;
  }

  isClosed(): boolean {
    return this.closed;
  }
}

/**
 * Source: produces events into a queue.
 */
export class Source<T> {
  private queue = new BoundedQueue<T>();
  private producer?: Promise<void>;
  private done = false;

  constructor(
    private readonly produce: (emit: (item: T) => Promise<void>) => Promise<void>,
    public readonly capacity: number = 64,
    public readonly strategy: BackpressureStrategy = "block"
  ) {
    this.queue = new BoundedQueue(capacity, strategy);
  }

  /**
   * Start producing. Resolves when producer is done; events remain in queue
   * until pulled.
   */
  start(): void {
    if (this.producer) return;
    this.producer = (async () => {
      try {
        await this.produce(async (item) => {
          await this.queue.push(item);
        });
      } finally {
        this.queue.close();
        this.done = true;
      }
    })();
  }

  /**
   * Pull an event. Returns null when source is exhausted.
   */
  async pull(signal?: AbortSignal): Promise<T | null> {
    this.start();
    return this.queue.pull(signal);
  }

  /**
   * Get the underlying producer promise (resolves when done).
   */
  async waitForDone(): Promise<void> {
    await this.producer;
  }

  isDone(): boolean {
    return this.done && this.queue.size === 0;
  }
}

/**
 * Transform: a stage that consumes events, emits transformed events.
 * This is the operator that replaces the body of a ReAct loop iteration.
 *
 * Lifecycle:
 * 1. User calls `push(item)` repeatedly to feed input.
 * 2. The transform's loop pulls input, calls `fn`, pushes results to output.
 * 3. User calls `closeInput()` to signal "no more input".
 * 4. The loop processes all remaining input, then marks "done".
 * 5. User calls `pull()` repeatedly; gets items until `pull` returns null
 *    (signals: no more output will come).
 * 6. To forcibly cancel, call `abort()`.
 *
 * This is a "loop until null" pattern. The user does not need to know when
 * the loop is done — pull() simply returns null when there's no more output.
 */
export class Transform<TIn, TOut> {
  private queue = new BoundedQueue<TIn>();
  private outQueue = new BoundedQueue<TOut>();
  private loop?: Promise<void>;
  private aborted = false;
  private inputClosed = false;
  private loopDone = false;

  constructor(
    private readonly fn: (event: TIn, emit: (out: TOut) => Promise<void>) => Promise<void>,
    public readonly capacity: number = 64,
    public readonly strategy: BackpressureStrategy = "block"
  ) {
    this.queue = new BoundedQueue(capacity, "block");  // input always blocks (otherwise we'd lose events)
    this.outQueue = new BoundedQueue(capacity, strategy);
  }

  /**
   * Push an event into the transform.
   */
  async push(item: TIn, signal?: AbortSignal): Promise<boolean> {
    if (this.aborted) return false;
    if (signal?.aborted) {
      this.abort();
      return false;
    }
    return this.queue.push(item);
  }

  /**
   * Pull a transformed event. Returns null when the input is closed, the
   * loop has finished, AND the output queue is empty.
   */
  async pull(signal?: AbortSignal): Promise<TOut | null> {
    // Fast-path: items already in outQueue
    if (this.outQueue.size > 0) {
      return this.outQueue.pull(signal);
    }
    // No items in queue
    if (this.aborted) return null;
    if (this.loopDone) {
      // Loop done, queue empty → no more output
      return null;
    }
    this.ensureLoop();
    // Otherwise wait for an item (or for loop to finish)
    const item = await this.outQueue.pull(signal);
    if (item !== null) return item;
    // Queue was empty + closed. Check if loop is done.
    if (this.loopDone) return null;
    return null;  // abort case
  }

  /**
   * Signal that no more input will come.
   */
  closeInput(): void {
    if (this.inputClosed) return;
    this.inputClosed = true;
    this.queue.close();
    this.ensureLoop();
  }

  /**
   * Abort: stop processing, cancel all in-flight work.
   */
  abort(): void {
    this.aborted = true;
    this.queue.close();
    this.outQueue.close();
  }

  /**
   * Wait for the transform to finish processing all queued input.
   * Useful for synchronization in tests.
   */
  async drain(): Promise<void> {
    this.closeInput();
    if (this.loop) await this.loop;
  }

  private ensureLoop(): void {
    if (this.loop) return;
    this.loop = (async () => {
      try {
        while (!this.aborted) {
          const item = await this.queue.pull();
          if (item === null) break;
          if (this.aborted) break;
          try {
            await this.fn(item, async (out) => {
              if (this.aborted) return;
              await this.outQueue.push(out);
            });
          } catch (err) {
            // Don't let one bad event kill the pipeline. Log to console; in
            // production this should be a structured log event.
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`[transform] handler error: ${msg}`);
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[transform] loop error: ${msg}`);
      } finally {
        this.loopDone = true;
        // Do NOT close outQueue — let the user drain remaining items via pull().
        // pull() will return null once queue is empty AND loopDone.
      }
    })();
  }
}

/**
 * Sink: consumes events without emitting.
 */
export class Sink<T> {
  private queue = new BoundedQueue<T>();
  private loop?: Promise<void>;

  constructor(
    private readonly consume: (event: T) => Promise<void> | void,
    public readonly capacity: number = 64
  ) {
    this.queue = new BoundedQueue(capacity, "block");
  }

  async push(item: T): Promise<boolean> {
    return this.queue.push(item);
  }

  /**
   * Start consuming. Resolves when input closes and queue is drained.
   */
  async run(): Promise<void> {
    if (this.loop) return this.loop;
    this.loop = (async () => {
      while (true) {
        const item = await this.queue.pull();
        if (item === null) break;
        await this.consume(item);
      }
    })();
    return this.loop;
  }

  close(): void {
    this.queue.close();
  }
}

/**
 * tee(): multicast a source into N independent sinks, each with its own
 * backpressure. Used for the critic mesh (3 critics consume the same event).
 *
 * Returns:
 *   - `push(item)`: fan out an item to all consumers.
 *   - `newConsumer()`: returns an AsyncIterable for one consumer.
 *   - `close()`: signal end-of-stream to all consumers.
 */
export function tee<T>(capacity: number = 64): {
  push: (item: T) => Promise<void>;
  newConsumer: () => AsyncIterable<T>;
  close: () => void;
  consumerCount: () => number;
} {
  const queues: BoundedQueue<T>[] = [];

  const push = async (item: T): Promise<void> => {
    // Fan out to all consumers
    await Promise.all(queues.map((q) => q.push(item)));
  };

  const newConsumer = (): AsyncIterable<T> => {
    const q = new BoundedQueue<T>(capacity, "block");
    queues.push(q);
    return {
      [Symbol.asyncIterator](): AsyncIterator<T> {
        return {
          async next(): Promise<IteratorResult<T>> {
            const item = await q.pull();
            if (item === null) return { value: undefined, done: true };
            return { value: item, done: false };
          },
        };
      },
    };
  };

  const close = (): void => {
    for (const q of queues) q.close();
  };

  return { push, newConsumer, close, consumerCount: () => queues.length };
}

/**
 * pipeline(): a fluent builder for source → transform → transform → ... → sink.
 *
 * Usage:
 *   const p = pipeline<MyEvent>()
 *     .from(async (emit) => { ... })
 *     .map(e => transformed(e))
 *     .filter(e => e.ok)
 *     .to(async (e) => { console.log(e); });
 *   await p.run();
 */
export class PipelineBuilder<T> {
  private sourceFn?: (emit: (item: T) => Promise<void>) => Promise<void>;
  private transforms: Array<(input: AsyncIterable<T>) => AsyncIterable<any>> = [];
  private sinkFn?: (item: any) => Promise<void> | void;

  from(producer: (emit: (item: T) => Promise<void>) => Promise<void>): this {
    this.sourceFn = producer;
    return this;
  }

  transform<R>(fn: (item: T, emit: (out: R) => Promise<void>) => Promise<void>): PipelineBuilder<R> {
    this.transforms.push(async function* (input: AsyncIterable<T>): AsyncIterable<R> {
      for await (const item of input) {
        const outs: R[] = [];
        await fn(item, async (out) => { outs.push(out); });
        for (const out of outs) yield out;
      }
    } as any);
    return this as unknown as PipelineBuilder<R>;
  }

  to(consumer: (item: T) => Promise<void> | void): { run: () => Promise<void> } {
    this.sinkFn = consumer;
    return {
      run: async () => {
        if (!this.sourceFn) throw new Error("Pipeline: missing .from()");
        if (!this.sinkFn) throw new Error("Pipeline: missing .to()");

        // Build the async iterator chain
        const src = new Source<T>(this.sourceFn);
        src.start();

        let iter: AsyncIterable<any> = {
          [Symbol.asyncIterator]: () => ({
            async next() {
              const v = await src.pull();
              return v === null ? { value: undefined, done: true } : { value: v, done: false };
            },
          }),
        };

        for (const t of this.transforms) {
          iter = t(iter);
        }

        const sink = new Sink<any>(this.sinkFn);
        sink.run();
        for await (const item of iter) {
          await sink.push(item);
        }
        sink.close();
        await sink.run();
        await src.waitForDone();
      },
    };
  }
}

export function pipeline<T>(): PipelineBuilder<T> {
  return new PipelineBuilder<T>();
}
