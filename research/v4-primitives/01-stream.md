# Primitive 1: Stream-Native Architecture

> Replacing the ReAct "think → act → observe → repeat" loop with a continuous,
> composable, back-pressured stream of cognitive events.

---

## 1. Literature & References

### 1.1 Erlang/OTP Actor Model

**Armstrong, J. (2003). "Making reliable distributed systems in the presence of software errors."**
PhD thesis, KTH Royal Institute of Technology. (The original Erlang manifesto.)
- Key insight: Processes are isolated; the *only* way to communicate is asynchronous message
  passing. No shared memory. "Let it crash" — supervisors restart failed processes rather than
  catching every error in-band.
- Why it matters for us: An AI agent that runs multiple reasoning "processes" (planner,
  executor, critic) should treat them as independent actors with mailboxes, not as
  coroutines in a single event loop. One component crashing shouldn't take down the whole
  agent.

**Cesarini, F. & Vinoski, S. (2016). "Designing for Scalability with Erlang/OTP."** O'Reilly.
- Key insight: Supervision trees are trees where parent processes restart children with
  restart strategies (one-for-one, one-for-all, rest-for-one). Linked processes propagate
  EXIT signals; monitored processes do not (cleaner separation).
- Why it matters: Our critic and verifier can be a separate process tree from the executor.
  If the executor's LLM call returns garbage, the critic can trigger a rollback without
  killing the planning process.

**Erlang Documentation — "Supervision Principles."** erlang.org/doc/design_principles/
- Documents the formal `gen_server` behavior, `supervisor` behavior, and restart frequency
  thresholds. Specifies how to declare a supervision tree in a `.app.src` file.
- Why it matters: We can borrow the *declarative* style of supervision (declare a tree,
  let a runtime walk it) even when we don't use BEAM.

### 1.2 Reactive Streams

**The Reactive Streams Specification (2015).** reactive-streams.org
- The canonical specification authored by engineers from Akka, Pivotal (Reactor),
  Netflix (RxJava), and Typesafe.
- Four core types: `Publisher<T>`, `Subscriber<T>`, `Subscription`, `Processor<T,R>`.
- Key insight: Backpressure is implemented as **demand signaling** — the subscriber
  calls `subscription.request(n)` to ask for `n` items, and the publisher must not
  emit more than the requested amount. This is a *pull model disguised as push*.
- Why it matters: In our agent, the LLM is a publisher (it streams tokens), the executor
  is a subscriber (it can only process so many tool calls per second), and the user
  interface is a *third* subscriber that may want to throttle. Reactive Streams gives us
  principled ways to interleave these without unbounded buffers.

**Manning, M. & Suzuki, J. (2019). "Reactive Streams in Java."** (Reactor reference.)
- Key insight: `Flux.parallel()` / `Flux.flatMap()` / `window` operators let you
  decompose a hot stream into parallel substreams with explicit backpressure windows.
- Why it matters: We can run the 3-critic verification in parallel by fanning the
  same execution output into three `Processor` instances, each with their own
  demand channel.

### 1.3 Backpressure in Stream Processing

**Carbone, P., Fóra, G., Ewen, S., Haridi, S. & Tzoumas, K. (2015). "Lightweight Asynchronous
Snapshots for Distributed Dataflows."** arXiv:1506.08603.
- Key insight: Apache Flink's model — network buffers are a *finite* pool. When a
  receiver cannot keep up, the sender's buffers fill up and the sender is *back-pressured*
  to slow down. The backpressure signal is in-band in the stream itself.
- Why it matters: When our LLM is generating 100 tokens/sec but our critic can only
  process 20/sec, we should not buffer 80 tokens/sec indefinitely. Reactive Streams
  pull-demand gives us a way to *pause* the LLM stream at the protocol level.

**Wang, G. et al. (2015). "An Experimental Evaluation of the Reliability of Kafka
Streams."** (LinkedIn Engineering blog series.)
- Documents the cost-quality tradeoff of Kafka Streams' commit/acknowledge protocols.
  At-least-once requires waiting for ack; exactly-once requires waiting for end-to-end
  barrier alignment. Both add latency.
- Why it matters: We need to pick: do we wait for critic verification (latency cost)
  or stream-through to the user first and verify async (risk of showing wrong answer)?

### 1.4 Promises, Callbacks, and Async Composition

**Madsen, L. & Lhotak, J. (2015). "Push-pull functional reactive programming."**
- Key insight: Promises are single-shot values; observables are multi-shot streams.
  A ReAct loop is "single-shot per turn" — but the *output of many turns* is naturally
  a stream (each turn produces a state delta, tool result, log line, etc.).
- Why it matters: We want to model the agent's *whole session* as a stream of
  *cognitive events* (spec, plan, step, tool_call, tool_result, critique, etc.)
  rather than as a loop that returns a single final result.

### 1.5 Apache Flink & Kafka Streams (real-world scale)

**Flink Forward, "The Stream Processor as a Database" (2020).**
- Key insight: Flink treats streams as the source of truth — the database is a
  *materialized view* of the stream. Operators are stateful; state is checkpointed
  to durable storage.
- Why it matters: For v4.0, our session transcript *is* a stream; checkpoints are
  sessions; the user's view is a downstream subscriber.

---

## 2. Existing Implementations

| System | Type | Notable Property | Relevance to HuaEngine |
|---|---|---|---|
| **Akka Streams** (Lightbend) | JVM actor-based stream library | "Reactive Streams 1.0 compliant"; typed and untyped APIs; materialized values for state | Closest analogue to what we want, but JVM only. We borrow the *mental model*, not the runtime. |
| **Reactor / RxJava / RxJS** | Reactive Streams impls on JVM/JS | Pull-demand backpressure; rich operator set (map/filter/merge/window) | RxJS is JS-native and we could use it. Trade-off: ~50KB gz, non-trivial learning curve, we avoid 3rd-party deps. |
| **Apache Flink** | Distributed stream processor | Exactly-once semantics, watermarks for out-of-order events, stateful operators | Reference architecture for "long-running, fault-tolerant, stateful cognitive agent." |
| **Kafka Streams** | Embedded stream processor on top of Kafka | KStream / KTable duality; commit log as source of truth | Patterns for *event sourcing* the agent's state. |
| **Cloudflare Workers / V8 isolates** | Event-driven serverless | Lightweight, fast cold start, message-passing model | Inspiration for "many small reasoning processes" pattern. |
| **Bun / Deno streams** | Modern JS runtimes | Native Web Streams API (WHATWG), backpressure-aware | Our target runtime Node.js 22 has full Web Streams support. |

### Two code references worth studying

1. **Akka Streams "Throttling for Live Connections"** — shows how to rate-limit an
   outbound stream with `throttle()` and how to handle over-demand by *buffering*
   vs *dropping* vs *failing*. We can apply the same pattern to the 3-critic fan-out
   in v4.0.
2. **Cloudflare Workers "Service Bindings"** — pass-by-reference RPC between isolates,
   with streaming bodies. Their model of "isolates that talk to each other via
   streams" maps almost directly onto our "planner isolate talks to executor isolate
   via cognitive-event stream."

---

## 3. Trade-offs

### Pros of stream-native over ReAct loop

| Property | ReAct loop | Stream-native |
|---|---|---|
| **Latency to first byte** | Wait for one full thought + tool call before showing anything | Show spec, plan, first tool call as soon as each is generated |
| **Cancellation** | Hard (loop is mid-iteration; abort discards partial state) | First-class via `AbortSignal` / `subscription.cancel()` |
| **Parallelism** | Sequential; even "parallel" subagents are wrapped in `Promise.all` | Native: fan out, merge, race — operators are part of the language |
| **Error handling** | Try/catch in loop, hope to recover | Error is just another event (`onError`); upstream can `materialize` it |
| **Composability** | New loops for new behaviors | `pipe`, `merge`, `map`, `filter` — composable by default |
| **Observability** | Logs; one event per turn | Built-in: a stream is a sequence of inspectable events |
| **Testability** | Mock the LLM client and replay the loop | A stream is a sequence of values; `toArray()` gives you a determinizable trace |
| **Resource bounds** | Loop can spin forever; max-iter is a hack | Buffer sizes + demand are first-class; bounded by construction |

### Cons / when NOT to use streams

- **Simplicity**: A loop is easier to reason about for a single user turn. Streams shine
  when you have *multiple subscribers*, *cancellation*, *backpressure*, or *time*.
  For a one-shot "translate this text" task, a function is fine.
- **Debugging**: Stacks of in-flight generators are hard to inspect. We need a stream
  inspector / replay tool from day 1.
- **Memory**: AsyncIterables backed by a `Queue` can grow unboundedly if the subscriber
  is slow. Need explicit bounded queues.
- **Determinism**: Out-of-order events (e.g., two parallel tool calls finishing in
  unexpected order) are the *norm* in streams. Loop code is naturally deterministic
  per turn.

### When to use streams vs loops

- ✅ Use streams when the consumer can subscribe *concurrently* (UI + execution +
  observability) or when **time matters** (TTFT, deadlines).
- ✅ Use streams when **cancellation is a first-class requirement** (user hits Ctrl-C;
  budget runs out).
- ✅ Use streams when you need **fan-out** (3 critics reading the same output).
- ❌ Stick with a loop for tiny one-shot tasks where the overhead of designing
  operators is more than the savings.

---

## 4. Our Adaptation for HuaEngine v4.0

### 4.1 Mental model

> HuaEngine v4.0 is a **typed event stream** that flows from a source (the user request)
> through a graph of **stream operators** (planner, executor, critic) to a sink (the user
> UI), with **explicit backpressure** at every operator boundary and **abort signals**
> that fan out from any subscriber.

The *engine* is a topology. The *user request* is a message on the upstream
`Publisher`. The *final answer* is a message on the downstream `Subscriber`.

### 4.2 Concrete design decisions

1. **`CognitiveEvent` as the wire type.** A discriminated union of:
   `spec | plan | step_start | step_done | tool_call | tool_result | critique
    | refining | message | delta | subagent_start | subagent_done | compact
    | instinct_synthesized | doom_loop_recovery | rollback | metric | done`.
   Every operator consumes and produces this type.

2. **Web Streams API as the foundation.** Node.js 22 has full support for
   WHATWG Streams (`ReadableStream`, `WritableStream`, `TransformStream`).
   We will *not* introduce RxJS or xstream — the native API is enough.
   AsyncIterables (ES2018) wrap them for the LLM call sites.

3. **`AbortController` as the cancellation primitive.** Every operator accepts an
   `AbortSignal`. When the user hits Ctrl-C, the budget expires, or the critic
   issues a fatal verdict, the controller's signal fires and all in-flight work
   cancels cooperatively.

4. **Pull-demand backpressure at operator boundaries.** Each `TransformStream`
   has a default `highWaterMark`. When the downstream is slow, the upstream
   awaits `controller.desiredSize` becoming positive. We do *not* need explicit
   `request(n)` like the full Reactive Streams spec — Node's Streams handle
   that for us.

5. **Bounded queues between operators.** No global unbounded `Promise.all` pile-ups.
   Each operator has a queue size we tune: e.g., `executor.highWaterMark = 4`
   (4 concurrent tool calls). When full, the planner pauses.

6. **Fan-out with `BroadcastChannel` (or a hand-rolled tee).** When the same
   cognitive event needs to go to 3 critics, we use a `TransformStream` that
   duplicates writes. Critics can race each other and the fastest valid result
   wins (this is primitive #3, speculative execution).

7. **Replay log as a first-class feature.** Every cognitive event is also written
   to an in-memory ring buffer (last N events) so the user can ask "what did
   the planner do 3 turns ago?" without re-querying the LLM. This is
   Flink-style event sourcing.

### 4.3 What we are *not* doing

- **Not** introducing RxJS / xstream / Kefir / most.js. Native Web Streams
  cover our needs.
- **Not** implementing the full Reactive Streams spec. We use the WHATWG
  abstraction, which is *similar in spirit* but simpler. The pull-demand
  semantics are baked into `ReadableStream`.
- **Not** using a separate actor runtime. We run on Node 22 single-threaded
  with `setImmediate` for scheduling. The Erlang model is a *design pattern*,
  not a runtime we deploy.

---

## 5. TypeScript Sketch

The sketch shows the core ideas: typed events, native streams, abort signals,
bounded queues, fan-out to critics, and a replay log.

```ts
// ─────────────────────────────────────────────────────────────────
// HuaEngine v4.0 — Stream-Native Core (sketch)
// ─────────────────────────────────────────────────────────────────

// 1. The wire type — every event flowing through the engine
export type CognitiveEvent =
  | { kind: 'spec'; goal: string; requirements: string[] }
  | { kind: 'plan'; steps: PlanStep[] }
  | { kind: 'step_start'; step: PlanStep }
  | { kind: 'step_done'; step: PlanStep; result: unknown }
  | { kind: 'tool_call'; call: ToolCall }
  | { kind: 'tool_result'; call: ToolCall; result: unknown }
  | { kind: 'critique'; verdict: 'pass' | 'refine' | 'fail'; score: number }
  | { kind: 'delta'; text: string; accumulated: string }
  | { kind: 'subagent_done'; output: string }
  | { kind: 'rollback'; paths: string[] }
  | { kind: 'done'; finalAnswer: string }
  | { kind: 'error'; err: Error; recoverable: boolean };

// 2. Bounded queue for backpressure (no unbounded Promise.all!)
class BoundedQueue<T> {
  private readonly buf: T[] = [];
  private readonly waiters: Array<(v: IteratorResult<T>) => void> = [];
  constructor(private readonly capacity = 4) {}

  push(v: T): boolean {           // returns false → backpressure
    const w = this.waiters.shift();
    if (w) { w({ value: v, done: false }); return true; }
    if (this.buf.length >= this.capacity) return false;
    this.buf.push(v);
    return true;
  }

  pull(): Promise<IteratorResult<T>> {
    if (this.buf.length) {
      return Promise.resolve({ value: this.buf.shift()!, done: false });
    }
    return new Promise((res) => this.waiters.push(res));
  }
}

// 3. A stream operator — transforms one stream into another
type Operator<In, Out> = (
  src: AsyncIterable<In>,
  signal: AbortSignal
) => AsyncIterable<Out>;

// 4. Planner: LLM event stream → plan + step events
const planner: Operator<{ user: string }, CognitiveEvent> = async function* (
  src, signal
) {
  for await (const { user } of src) {
    if (signal.aborted) return;
    const plan = await llm.decomposePlan(user, { signal });
    yield { kind: 'plan', steps: plan };
    for (const step of plan.steps) {
      yield { kind: 'step_start', step };
      // ⓪ Note: the executor below produces the matching step_done.
    }
  }
};

// 5. Executor: turns step_start events into step_done events
const executor: Operator<CognitiveEvent, CognitiveEvent> = async function* (src, signal) {
  for await (const ev of src) {
    if (ev.kind !== 'step_start') { yield ev; continue; }
    try {
      const result = await runStep(ev.step, { signal });
      yield { kind: 'step_done', step: ev.step, result };
    } catch (err) {
      yield { kind: 'error', err: err as Error, recoverable: true };
    }
  }
};

// 6. Fan-out to 3 critics — each gets its own subscription (broadcast)
function tee<T>(src: AsyncIterable<T>, n: number): AsyncIterable<T>[] {
  const queues = Array.from({ length: n }, () => new BoundedQueue<T>(2));
  (async () => {
    try {
      for await (const ev of src) {
        // ⓪ Round-robin or broadcast — broadcast here
        for (const q of queues) q.push(ev);
      }
      for (const q of queues) q.push(/* DONE sentinel */);
    } catch (err) {
      for (const q of queues) q.push({ __err: err });
    }
  })();
  return queues.map((q) => ({
    [Symbol.asyncIterator]: () => ({
      next: () => q.pull().then((r) => r.value.__err
        ? { value: undefined, done: true }
        : r),
    }),
  })) as any;
}

// 7. The 3-critic merge — first 'pass' wins, all 'fail' → escalate
const criticMerge: Operator<CognitiveEvent, CognitiveEvent> = async function* (src, signal) {
  const branches = tee(src, 3);
  const iterators = branches.map((b) => b[Symbol.asyncIterator]());
  // ⓪ The full implementation is in 03-speculative.md; this is just a placeholder
  for await (const ev of iterators[0]) yield ev;
};

// 8. Wire it all up — a stream topology
export function runEngine(
  request: string,
  client: LLMClient,
  signal: AbortSignal
): AsyncIterable<CognitiveEvent> {
  const input = (async function* () { yield { user: request }; })();
  return executor(
    planner(input, signal),
    signal
  );
}

// 9. The replay log — a ring buffer you can query later
class ReplayLog {
  private buf: CognitiveEvent[] = [];
  constructor(private capacity = 1024) {}
  record(ev: CognitiveEvent) {
    this.buf.push(ev);
    if (this.buf.length > this.capacity) this.buf.shift();
  }
  query(filter: (e: CognitiveEvent) => boolean): CognitiveEvent[] {
    return this.buf.filter(filter);
  }
}
```

### Key points in the sketch

- **Native `AsyncIterable` + `for await…of`** — no third-party lib.
- **`AbortSignal` everywhere** — cancellation is cooperative.
- **`BoundedQueue` is the backpressure primitive** — `push()` returns `false`
  to signal the upstream to slow down.
- **`tee()`** — fan-out for parallel critics. This is the *only* place we
  deviate from "one linear stream" and it is the *only* place where order
  is not preserved.
- **`ReplayLog`** — Flink-style event sourcing for free.

---

## 6. Open Questions

1. **How do we serialize state across operator boundaries?**
   - Do we pass immutable `CognitiveEvent` objects (cheap, no shared mutation) or
     reference-counted snapshots (allows rollback)?
   - If we go immutable, every downstream subscriber holds its own copy → memory.
   - Lean toward immutable + structural sharing (`immer`-style) for hot events.

2. **Where does the abort signal originate?**
   - User Ctrl-C (SIGINT) → process-level `AbortController`.
   - Budget expired → timeout in a `setTimeout` that calls `controller.abort()`.
   - Critic fatal verdict → the critic itself gets a controller to abort siblings.
   - This is the supervision-tree decision: who supervises whom?

3. **How big is a `CognitiveEvent`'s `tool_result`?**
   - Reading a 1MB file produces a 1MB `tool_result` event. If the replay log keeps
     1024 of them, the log is 1GB. We need either a max-size cap or a separate
     "blob" channel for large payloads (RDBMS-style "TOAST" idea).

4. **Do we need the full Reactive Streams semantics?**
   - `request(n)` pull-demand is great for *credit-based* backpressure, but Node
     Streams already do this. Do we add a thin `request` wrapper or stay with
     `highWaterMark`? Answer: stay with `highWaterMark`; it's enough for our scale.

5. **What's the operator's failure semantics?**
   - If the executor throws, do we (a) abort the whole engine, (b) send a
     `step_failed` event and let the planner re-route, (c) restart just the executor
     (Erlang-style)?
   - Option (b) is most flexible. Option (c) is the "let it crash" idiom. We start
     with (b) and add (c) for known-bad operators (e.g., a flaky LLM call).

6. **TypeScript: pull types from LLM providers, or invent our own?**
   - LLM providers give `StreamEvent = delta | done | error`. Our `CognitiveEvent`
     is *richer* (has `critique`, `rollback`, etc.). The adapter is a `TransformStream`
     that turns provider events into our events.

7. **Performance budget per operator?**
   - What's the cost of a `TransformStream` hop? In Node 22, roughly 1–5 µs per
     chunk. We can support ~10 operators in the hot path before we exceed 50 µs of
     framework overhead. *Empirically* that's fine; we will measure.

8. **Backward compat with v3.0's `EngineEvent` type?**
   - The CLI consumes `EngineEvent`. v4.0 will publish *both* a `CognitiveEvent`
     stream *and* a `v3.compat` `EngineEvent` adapter, so we don't have to rewrite
     the Ink UI in one go.
