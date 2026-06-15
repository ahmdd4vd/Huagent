/**
 * v4/actor/transport.ts
 *
 * The transport: bounded mailbox + addressing for actor communication.
 *
 * Design (OTP-inspired, simplified):
 *   - Each actor has a unique Address (UUID).
 *   - Messages are sent to an address; the transport routes to the actor.
 *   - Mailbox is bounded (default 64); send() backpressures.
 *   - Selective receive: actor can pattern-match on message type.
 *
 * In-process only (single-process actors). Distributed actors would need
 * a different transport (gRPC, message queue, etc.).
 */

import { randomUUID } from "node:crypto";
import { BoundedQueue } from "../stream/pipeline.js";

/**
 * A message: arbitrary payload with sender address.
 */
export interface ActorMessage<T = unknown> {
  kind: string;
  payload: T;
  sender?: Address;
  correlationId?: string;
  /** When sent (ms since epoch) — for ordering and timeouts */
  sentAt: number;
  /** Optional reply-to address */
  replyTo?: Address;
}

/**
 * Address: globally unique within the actor system.
 */
export type Address = string;

let _counter = 0;
export function newAddress(prefix: string = "actor"): Address {
  return `${prefix}-${++_counter}-${randomUUID().slice(0, 8)}`;
}

/**
 * Transport: routes messages between actors.
 *
 * Why a Map<Address, Mailbox>:
 *   - O(1) lookup
 *   - Easy to enumerate for "send to all" patterns
 *   - Easy to remove when actor stops
 */
export class Transport {
  private mailboxes = new Map<Address, BoundedQueue<ActorMessage>>();
  private actors = new Map<Address, { receive: (msg: ActorMessage) => Promise<void> | void; alive: boolean }>();
  private defaultCapacity = 64;
  private deadLetterQueue: Array<{ address: Address; message: ActorMessage; reason: string }> = [];

  /**
   * Register an actor with the transport.
   */
  register(address: Address, receive: (msg: ActorMessage) => Promise<void> | void): void {
    this.actors.set(address, { receive, alive: true });
    this.mailboxes.set(address, new BoundedQueue<ActorMessage>(this.defaultCapacity, "block"));
  }

  /**
   * Send a message to an actor (fire-and-forget).
   */
  async send(address: Address, message: Omit<ActorMessage, "sentAt">): Promise<boolean> {
    const mailbox = this.mailboxes.get(address);
    const actor = this.actors.get(address);
    if (!mailbox || !actor || !actor.alive) {
      // Dead letter
      this.deadLetterQueue.push({
        address,
        message: { ...message, sentAt: Date.now() },
        reason: "actor not found or not alive",
      });
      return false;
    }
    const fullMessage: ActorMessage = { ...message, sentAt: Date.now() };
    return mailbox.push(fullMessage);
  }

  /**
   * Request-response pattern: send a message and wait for reply.
   * The reply must be sent to the `replyTo` address.
   */
  async request<TReq, TRes>(
    address: Address,
    payload: TReq,
    opts: { kind?: string; timeoutMs?: number; correlationId?: string } = {}
  ): Promise<TRes> {
    const kind = opts.kind ?? "request";
    const correlationId = opts.correlationId ?? randomUUID();

    // Create a temporary reply mailbox
    const replyAddress = newAddress("reply");
    this.register(replyAddress, async () => {});

    await this.send(address, { kind, payload, correlationId, replyTo: replyAddress });

    // Wait for reply
    const mailbox = this.mailboxes.get(replyAddress)!;
    const timeout = opts.timeoutMs ?? 30000;
    const reply = await Promise.race([
      mailbox.pull(),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), timeout)),
    ]);

    // Cleanup reply mailbox
    this.mailboxes.delete(replyAddress);
    this.actors.delete(replyAddress);

    if (reply === null) throw new Error(`Actor request to ${address} timed out after ${timeout}ms`);
    return (reply.payload as TRes);
  }

  /**
   * Receive the next message for an actor (blocking).
   * Returns null if the actor is stopped.
   */
  async receive(address: Address): Promise<ActorMessage | null> {
    const mailbox = this.mailboxes.get(address);
    if (!mailbox) return null;
    const msg = await mailbox.pull();
    if (msg === null) return null;
    const actor = this.actors.get(address);
    if (actor && actor.alive) {
      try {
        await actor.receive(msg);
      } catch (err) {
        // Let the supervisor handle it; re-throw to caller
        throw err;
      }
    }
    return msg;
  }

  /**
   * Mark an actor as dead (no more messages will be delivered).
   */
  kill(address: Address, reason: string = "killed"): void {
    const actor = this.actors.get(address);
    if (actor) {
      actor.alive = false;
    }
    const mailbox = this.mailboxes.get(address);
    if (mailbox) {
      // Drain remaining messages to dead letter queue
      const remaining = mailbox.drain();
      for (const msg of remaining) {
        this.deadLetterQueue.push({ address, message: msg, reason: `actor killed: ${reason}` });
      }
      mailbox.close();
    }
  }

  /**
   * Get dead letter queue (for debugging).
   */
  getDeadLetters(): ReadonlyArray<{ address: Address; message: ActorMessage; reason: string }> {
    return this.deadLetterQueue;
  }

  /**
   * Number of registered actors.
   */
  size(): number {
    return this.actors.size;
  }
}
