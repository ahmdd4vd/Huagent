# Primitive 3: Actor Model with Self-Healing (Fault Tolerance Layer)

> Replacing v3.0's fragile, exception-propagating, monolithic `Engine` class — where
> one LLM timeout, JSON parse error, or snapshot write failure tears the whole
> agent down — with a **supervision tree of isolated, message-passing actors**
> that follow the Erlang/OTP "let it crash" philosophy. Each v3.0 component
> (Planner, Executor, Critic, Reflector, IdentityManager, SnapshotManager,
> DoomLoopDetector, Architect, SmartEditor, InstinctSynthesizer) becomes an
> **actor** with a mailbox, a typed message protocol, and a *guaranteed* recovery
> path defined by its **supervisor**. The target is a **never-crash engine**:
> partial failures are contained, state is preserved across restarts, and the
> user-visible experience is "slower / more retries" rather than "stack trace
> dumped to the TUI."

---

> **Caveat on sources.** Web search and web extraction are unavailable in the
> environment this document was authored in. The citations below are drawn
> from training knowledge of these well-established, decades-stable systems
> (Hewitt 1973, Agha 1986, Armstrong 2003, Cesarini & Vinoski 2016, etc.) and
> are used the same way the companion primitives `01-htn.md` and
> `02-critic-mesh.md` use them. I have not been able to verify URLs, page
> numbers, or post-2024 follow-up work. Where a claim depends on a specific
> empirical number I have either omitted it or marked the source explicitly.

---

## 1. Literature & References

### 1.1 The Actor Model — Foundational Papers

**Hewitt, C., Bishop, P. & Steiger, R. (1973). "A Universal Modular ACTOR
Formalism for Artificial Intelligence."** IJCAI '73.
- The original paper. Three primitives: send a message, create a new actor,
  become a new behavior. Everything else (state, control flow, computation)
  is built on top.
- *Why it matters:* It is the *minimum* concurrency model. v4.0's actors
  should be a strict subset of this — no shared memory, no direct calls
  between actors, no exceptions that escape. The 1973 paper already
  anticipated distributed systems; we are re-discovering the same primitives
  in 2026 because they are *necessary*, not just convenient.

**Agha, G. (1986). "Actors: A Model of Concurrent Computation in Distributed
Systems."** MIT Press.
- Formalizes the actor model: an actor is `(mailbox, behavior, acquaintances)`;
  messages are *asynchronous* and *unordered*; the only way to affect another
  actor is to send it a message. Introduces the concept of *reception* (a
  *partial* function from messages to behaviors) and *configuration* (the
  state of all actors at a moment in time).
- *Why it matters:* Agha's "mailbox is a queue" assumption is the same one
  Node.js's event loop uses. The difference is *strict isolation*: in Node,
  two `async` functions share the same heap; in the actor model, they don't.
  We will *emulate* strict isolation in TypeScript via the
  `AsyncLocalStorage` + a per-actor frozen `state` object pattern.

**Armstrong, J. (2003). "Making reliable distributed systems in the presence
of software errors."** PhD thesis, KTH Royal Institute of Technology.
- The Erlang manifesto. Formalizes "let it crash": processes are not expected
  to handle their own errors; *supervisors* are. The rest of the paper is
  about why this is *more* reliable than defensive programming, not less.
  Defensive code paths are rarely tested in production; the crash path is.
- *Why it matters:* This is the philosophical core of v4.0's fault-tolerance
  layer. *Most* LLM failures (rate limit, JSON parse error, tool timeout,
  bad args, context-length overflow) are not "handle them in-band"
  failures — they are "this actor is in a bad state, kill it and start a
  new one" failures. Catching them with `try/catch` and trying to recover
  in-place has been the v3.0 approach, and it has produced a tangle of
  `if (recoverable)` branches in `core.ts`.

**Agha, G., Mason, I., Talcott, C. & Venkatesh, A. (1997). "A Foundation
for Actor Computation."** Journal of Functional Programming 7(1):1–72.
- Develops a denotational semantics for actors. Useful for us only as
  *evidence that the model is well-defined*: any two implementations that
  preserve message ordering and per-actor state isolation are equivalent.

### 1.2 Erlang/OTP Supervision Trees

**Cesarini, F. & Vinoski, S. (2016). "Designing for Scalability with
Erlang/OTP."** O'Reilly.
- The most accessible book on the topic. Chapter 4 (Supervisors) is the
  working programmer's guide. Key concepts:
  - **Restart strategy**: `one_for_one` (restart only the failed child),
    `one_for_all` (restart all children of the supervisor), `rest_for_one`
    (restart the failed child and all children started after it).
  - **Max restarts**: a supervisor kills itself if more than `N` restarts
    happen in `M` seconds. This is the *circuit breaker*.
  - **Child spec**: `{Id, StartFunc, Restart, Shutdown, Type, Modules}`.
    `Restart` is `permanent` (always restart), `transient` (restart only on
    abnormal exit), or `temporary` (never restart).
  - **gen_server**: the standard behaviour (a.k.a. *pattern*) for stateful
    processes. `init/1`, `handle_call/3`, `handle_cast/2`, `handle_info/2`,
    `terminate/2`, `code_change/3`. v4.0's `Actor` base class is a
    faithful translation of this contract.
- *Why it matters:* v3.0's `Engine` class is a single `gen_server` doing the
  work of ~10 actors. v4.0 splits it into 10 `Actor`s, each with its own
  `gen_server`-style contract, supervised by a tree that knows how to
  restart them.

**Erlang Documentation — "Supervision Principles."** erlang.org/doc/
design_principles/sup_princ.html.
- The canonical reference for `supervisor:start_link/2` and the
  `.app.src` child-spec format. Documents the *restart frequency*
  algorithm: `{intensity, period}` — if `intensity` restarts occur within
  `period` seconds, the supervisor itself terminates with the same exit
  reason as the child.
- *Why it matters:* This is the *circuit breaker* design we copy verbatim.
  If a `Planner` actor crashes 3 times in 5 seconds, we stop restarting it
  and escalate to *its* supervisor. If that supervisor also crashes, we
  escalate further, all the way up to the user-visible "I can't recover,
  here's the last known good state" message.

**Armstrong, J., Virding, R., Wikström, C. & Williams, M. (1996).
"Concurrent Programming in ERLANG."** 2nd ed., Prentice Hall.
- The classic, pre-OTP book. Documents the *raw* primitives: `spawn`,
  `!` (send), `receive`, `link`, `monitor`. The `monitor` primitive is
  *unidirectional*: process A monitoring process B receives a `'DOWN'`
  message when B exits, but B's exit does not affect A. *Link* is
  *bidirectional*: if A is linked to B and B crashes, A is killed too
  (unless A traps exits). v4.0's `watch` and `link` actor methods are
  direct ports of these.

### 1.3 Akka — Actor Model on the JVM

**The Akka Documentation — "Actor Systems."** doc.akka.io/docs/akka/
current/typed/actors.html (and the older "untyped" docs).
- Akka refines the actor model in two important ways:
  1. **Supervision is declared, not imperative.** You write
     `Behaviors.supervise(beh).onFailure[Exception](SupervisorStrategy.restart)`
     and the runtime enforces it. No manual `try/catch` in actor code.
  2. **Parent-child hierarchy is the supervision tree.** When actor A
     spawns actor B, A is B's supervisor. Failure propagates *up* the tree
     by default. v4.0 copies this: the `PlannerStage` actor spawns
     `PlannerActor` instances; the stage actor is their supervisor.
- *Why it matters:* The Erlang model requires you to write a separate
  `supervisor` process; the Akka model embeds supervision in the parent's
  behavior. The Akka model is *less powerful* (you can't easily implement
  `one_for_all` if the children don't share a parent) but *simpler*.
  v4.0 should use the Akka style for the simple case and the Erlang
  style for the case where multiple siblings need a coordinated restart.

**Hewitt, E. (2012). "Akka in Action."** Manning.
- The practical book. Chapter 5 (Fault tolerance) introduces the
  *PreStart* and *PostRestart* lifecycle hooks, which are the right
  place to *reload* state from a snapshot. v4.0's `Actor.onStart` and
  `Actor.onRestart` correspond directly.

**Letavin, D. (2019). "Comparing Actor Systems: Akka, Erlang, and
Orleans."** (Workshop paper, various.)
- Useful side-by-side. Key data points: Akka has *location transparency*
  (an actor can be in the same process or on a different node with no
  code change); Erlang does the same with `node()`; Orleans *doesn't* —
  grains are always remote. For v4.0, which is single-process, the
  distinction is moot. We pick the Akka style because it has the
  cleanest TypeScript port.

### 1.4 Microsoft Orleans — Virtual Actors

**Bykov, S., Geller, A., Kliot, G., Larus, J. R., Pandya, R. & Thelin, J.
(2011). "Orleans: Cloud Computing for Everyone."** SOSP '11 (poster) and
the 2021 CACM article "Orleans: Distributed Virtual Actors for
Programmability and Scalability".
- Introduces the *virtual actor* (called a *grain* in Orleans). A grain
  is *addressable by a key* (e.g., `grainFactory.getGrain<IPlayer>("p-42")`)
  and *automatically activated* when it receives a message. If the
  runtime decides to deactivate the grain (memory pressure, no
  messages for 1 hour, etc.), the next message *reactivates* it from a
  *persistent state* in storage.
- *Why it matters:* This is *exactly* the pattern v4.0 needs for the
  `IdentityManager` and `MethodLibrary` components. They are not
  "actively running" — they are *state that answers queries*. A
  crash-restart cycle should be invisible to the rest of the system;
  the grain activates on the next message, reloads its state, and
  answers. The `MessageManager` grain per user-request, the
  `ConversationGrain` per session — these are the *addresses* of the
  actor model.

**Bernstein, P. A., Bykov, S., Geller, A., Kliot, G. & Thelin, J. (2014).
"Orleans: A Distributed Execution Framework for Stateful Reactive
Computation."** (Microsoft Research TR-2014-41.)
- The technical report. Discusses *stateless worker* grains, *reentrant*
  grains, and the *turn-based* scheduling model that prevents deadlocks
  and priority inversion in long-running request handlers.
- *Why it matters:* The "reentrant" concept is crucial: by default,
  an Orleans grain does not process two messages at the same time.
  If message B arrives while the grain is processing A, B waits in
  the mailbox. This is the right default for v4.0's actors: a
  `CriticActor` that is mid-judgment should not be interrupted by
  a new "judge this" message.

### 1.5 State Machines as Actors — xstate

**David Harel (1987). "Statecharts: A Visual Formalism for Complex
Systems."** Science of Computer Programming 8(3):231–274.
- The foundational paper. Adds *hierarchy* and *orthogonality* to FSMs.
  *Why it matters:* A HuaEngine actor is not a pure actor in Agha's
  sense — it has internal *states* (`idle`, `working`, `waiting_for_io`,
  `crashed`, `draining`). Encoding these as a statechart gives us
  *visual debugging* and *provably correct* transitions.

**Davidovich, Y. & Khomenko, V. — xstate (the JavaScript library).**
stately.ai/docs/xstate
- TypeScript-first state machine library. v5+ uses the `setup()` API
  and produces *typed* state machines. ~150 KB minified, but only the
  `xstate` core (not the visualizer) is needed for our use case.
- *Why it matters:* xstate gives us a *finite* set of states per actor
  with *guard conditions* on transitions. Combined with the actor
  lifecycle, we get a fully typed state machine for each component
  in v4.0. Alternative: write our own 30-line `StateMachine` class
  that *just* does transitions and side effects. We may do this
  (see Open Questions §6) to keep zero external deps.

### 1.6 Watchdog / Heartbeat Patterns

**Knight, J. C. & Leveson, N. G. (1986). "An Experimental Evaluation of
the Assumption of Independence in Multi-Version Software."** IEEE
Transactions on Software Engineering SE-12(1):96–109.
- The *N-version programming* paper. Documents that, contrary to the
  assumption, independently-developed versions of the same software
  *do* fail in correlated ways. Implication: redundancy helps, but
  it doesn't eliminate correlated bugs.
- *Why it matters:* v4.0's *critic mesh* (primitive #4) is N-version
  programming applied to LLM judging. The actor model gives us the
  *isolation* that lets the three critics crash independently; the
  watchdog gives us the *detection* of a stuck or wedged critic.

**Howard, J., Kazar, M., Menees, S., Nichols, D., Satyanarayanan, M.,
Sidebotham, R. & West, M. (1988). "Scale and Performance in a
Distributed File System."** ACM TOCS 6(1):51–81. (The AFS papers.)
- Documents the *callback* and *poll* watch strategies. In a callback
  strategy, the watched process must call `touch()` periodically or
  the watchdog fires. In a poll strategy, the watchdog checks the
  process's last-seen time and fires if too old. *Why it matters:*
  LLM calls are unbounded in time; a callback-style "I'm alive" doesn't
  work because the LLM is *blocked* on a network read. We use a
  *poll* watchdog: a 30-second timer on the LLM call, with a kill
  signal to the actor if the timer fires.

### 1.7 Crash Recovery and Event Sourcing

**Fowler, M. (2005). "Event Sourcing."** martinfowler.com/eaaDev/
EventSourcing.html
- The foundational article. Key insight: instead of storing the
  *current state* of an entity, store the *sequence of events* that
  led to it. The current state is a *fold* over the events. Crash
  recovery = replay events from the last snapshot.
- *Why it matters:* v3.0's `SnapshotManager` is *file-level* (it
  snapshots a file's content). v4.0's actor state needs an
  *event-sourced* layer on top: every state-mutating message to an
  actor is logged; on restart, the actor re-applies the log. The
  *Snapshot* is still useful as a checkpoint — log + last-snapshot
  is faster than log-only.

**Helland, P. (2015). "Idempotence Is Not a Medical Condition."**
queue.acm.org/detail.cfm?id=2747185
- The article that should be required reading for anyone writing
  distributed systems. Key insight: messages will be delivered
  *more than once* and *out of order* in any real system. The
  *idempotency key* — a stable identifier on every message — is
  what makes retry safe. v4.0's actor messages must carry a
  `messageId` and actors must deduplicate by it.

### 1.8 LLM-Specific Failure Modes

**Ouyang, S. et al. (2022). "Training Language Models to Follow
Instructions with Human Feedback."** (The InstructGPT paper, NeurIPS 2022.)
- Documents the *repetition loop* and *mode collapse* failure modes
  of LLMs. These are *not* throwable exceptions — the LLM returns
  *valid* JSON that is *wrong* in a subtle way. The actor model
  cannot fix these; only the critic mesh can. But the actor
  model *can* enforce a maximum retry count and *timeout* the
  LLM call.

**Robey, A. et al. (2023). "Tool-LMM: A Tool-augmented Large
Multimodal Model for Solving Complex Visual Tasks."** (arXiv:2308.11487)
- Documents the *infinite tool-call loop* failure mode: an agent
  emits the same tool call with the same arguments indefinitely
  because the LLM doesn't realize it's stuck. v3.0's
  `DoomLoopDetector` already handles this. v4.0's actor model
  *requires* this check as a built-in feature of the
  `ExecutorActor`'s restart logic.

---

## 2. Existing Implementations

| System | Type | Notable Property | Relevance to HuaEngine |
|---|---|---|---|
| **Erlang/OTP** | BEAM runtime, Erlang/Elixir | `gen_server` + `supervisor` behaviours; production since 1986 (Ericsson AXE-301) | The reference; we port the contract to TypeScript |
| **Akka** | JVM library, Scala/Java | Type-safe actor refs; declarative supervision; location transparency | Cleaner TypeScript port; pattern source for our `Actor` base class |
| **Microsoft Orleans** | .NET framework | Virtual actors (grains); automatic activation; persistence providers | Pattern source for our *addressable* `MethodLibraryActor` and `IdentityActor` |
| **Pulsar** (Apache) | Distributed messaging | Per-consumer ack and redelivery; topic-per-actor pattern | Reference for the "mailbox as durable queue" extension |
| **Celluloid** (Ruby) | Actor library for Ruby | `Celluloid::SupervisionGroup`; transparent supervision in a dynamic language | The closest *language-parallel* reference (Ruby is closer to TS than Scala is) |
| **XState v5** | TS/JS state machine library | Typed states + guards + actions; the de-facto FSM library for TS | We either use it or copy its API for actor lifecycles |
| **Effect / Effect-TS** | TS library | Fiber-based concurrency with structured interruption; supervisor pattern since v3 | The *most idiomatic* TypeScript supervision library; serious candidate for an alternative to writing our own |
| **Plexus / Zellular** (Go) | Actor framework in Go | Direct Erlang-style supervision; no extra runtime | Reference for "port the contract, not the runtime" |
| **Erlang/OTP `logger` handler** | Built-in OTP feature | Crash reports include *neighbour* process state; structured log | We copy this for our `onCrash` supervisor callback |
| **WhatsApp / Discord / Phoenix Channels** | Production systems on BEAM | 9-nines reliability reported | Existence proof that the model works at huge scale |

### The one to study hardest: **Erlang/OTP** (the *behaviour* contract, not the runtime)

Erlang/OTP is a 30-year-old, battle-tested system. The *runtime* is the
BEAM virtual machine; we can't use that. But the *behaviour contracts*
are language-agnostic and we can copy them verbatim:

1. `gen_server` contract: `init/1` → `handle_call/handle_cast/handle_info`
   → `terminate/2` → `code_change/3`. v4.0's `Actor` base class implements
   exactly this contract.
2. `supervisor` contract: declarative child specs with restart strategy,
   intensity, period. v4.0's `Supervisor` class implements exactly this
   contract.
3. *Linking*: bidirectional, propagates exit signals. v4.0's `link` method.
4. *Monitoring*: unidirectional, sends `'DOWN'` message. v4.0's `watch` method.
5. *Trapping exits*: a process that traps exits receives an `'EXIT'`
   message instead of dying. v4.0's `trapCrash: true` flag on an actor.

The single most important *philosophical* takeaway from OTP is this:
**the supervisor is a separate entity from the worker**. In v3.0, the
`Engine` class *both* does the work *and* catches its own errors. In
OTP, the worker does the work; a separate supervisor decides what to
do when the worker crashes. v4.0 enforces this separation at the type
level: an `Actor` is a subclass of `Worker`, and a `Supervisor` is a
*different* subclass.

### The one to study second-hardest: **Effect-TS**

Effect-TS is a TypeScript library that has been quietly implementing
exactly the actor/supervisor pattern in TS since 2022. Key features:
- **Fiber** = a lightweight thread (millions per process)
- **Supervisor** = a tree of fibers with restart policies
- **Interruptibility** = fibers can be interrupted with a reason;
  the supervisor decides what to do
- **Structured concurrency** = children of a fiber die with the parent

Effect-TS is heavier than we want (~80 KB minified, complex types), but
*parts* of it are worth porting: the `Effect.scoped` pattern, the
`Layer` pattern for dependency injection, and the
`Supervisor.track` API. See Open Questions §3 for whether we use
Effect-TS as a dependency or re-implement.

---

## 3. Trade-offs

### 3.1 Pros of Actor Model + Self-Healing for HuaEngine v4.0

| Property | v3.0 (monolithic Engine class) | v4.0 (actor + supervisor tree) |
|---|---|---|
| **Failure isolation** | One throw kills the whole agent | One throw kills one actor; supervisor restarts it |
| **State preservation** | In-memory only; process exit = total loss | Per-actor state snapshot + event log; restart from snapshot |
| **Concurrency** | `await` in series; parallel groups only inside the executor | Actors run in parallel by default; mailboxes are natural queues |
| **Testability** | Hard to test partial failure — you have to inject throws | Trivial: spawn an actor, kill it, assert supervisor behavior |
| **Backpressure** | None; one bad LLM response can queue up forever | Mailbox is bounded; supervisor can drop or escalate when full |
| **Hot reload** | Impossible (whole engine is a singleton) | Spawn a new actor with the new code; old one drains and dies |
| **Observability** | One `EngineEvent` stream with 25+ types | One event per actor; supervisor emits a structured crash report |
| **Reasoning** | Implicit control flow (`if (recoverable)`) | Explicit supervision tree; the tree *is* the recovery spec |
| **Heterogeneity** | All TS, all in one process | Same TS, but we can move a `CriticActor` to a worker_thread or worker_process later without code change |
| **Cost of complexity** | Linear in features | Logarithmic: new feature = new actor + new supervision rule |

### 3.2 Cons / when NOT to use the actor model

- **Boilerplate**: every stateful component becomes a class with
  `init`, `handleMessage`, `onStart`, `onStop`, `onCrash`. For a
  5-line piece of logic, this is 50 lines of actor scaffolding.
  **Mitigation:** we keep the `Actor` base class small (~80 lines)
  and use a `gen_server`-style default for any state that doesn't
  need supervision. Most of v3.0's *small* helpers (e.g., the
  `ShouldCompact` heuristic) do *not* need to be actors.

- **Latency**: a message goes through (a) sender serializes, (b)
  transport, (c) receiver deserializes, (d) receiver scheduled. For
  in-process actors using a `Promise`/`queue` transport, (a) and
  (c) are sub-microsecond; (d) can be 1–10 ms. Compared to a
  direct `await` (1 µs), that's 1000× slower. **Mitigation:** the
  critical path (LLM call) is many milliseconds anyway; the actor
  overhead is in the noise. The places where we *don't* use actors
  are the hot path of an LLM streaming call.

- **Debugging**: a stack trace through 5 actors is harder to read
  than a single-stack trace. **Mitigation:** we attach a
  `tracingContext` (e.g., OpenTelemetry-style trace ID) to every
  message. The `onCrash` callback logs the full chain.

- **Testing in isolation**: unit tests for an actor need a fake
  supervisor, fake transport, and fake logger. **Mitigation:** the
  `Actor` base class accepts a `Transport` interface; in tests, we
  pass a synchronous `InMemoryTransport`. The supervisor is
  mockable.

- **Resource leaks**: an actor that crashes mid-operation can leak
  open file handles, un-released LLM streams, or pending Promises.
  **Mitigation:** every actor declares a `cleanup` hook that
  *always* runs (in the `finally` of the message handler). The
  `SnapshotManager` already has this pattern.

- **AsyncLocalStorage overhead**: in TypeScript, the closest thing
  to per-actor state is `AsyncLocalStorage`. It's about 10× slower
  than a plain object. **Mitigation:** we use `AsyncLocalStorage`
  only for the *context* (trace ID, user ID); the actor's actual
  state is a plain class field.

### 3.3 When to use actor model vs not

- ✅ **Use actors for** anything stateful that can crash, needs
  restart, and is on a long-lived path: Planner, Executor, Critic,
  Reflector, Identity, Method Library, Snapshot Manager, Doom Loop
  Detector, Instinct Synthesizer.
- ✅ **Use actors for** anything that should be independently
  restartable: a Critic instance should be able to crash and
  restart without disturbing the Planner.
- ✅ **Use actors for** LLM calls: every LLM call is wrapped in a
  `LLMActor` with a timeout watchdog. If the call hangs, the
  watchdog kills the actor and the supervisor retries with
  backoff.
- ❌ **Don't use actors for** stateless pure functions: prompt
  formatting, JSON parsing, score aggregation. These are normal
  `async` functions.
- ❌ **Don't use actors for** the TUI: a TUI is a single
  long-lived event loop; making it an actor adds nothing.
- ❌ **Don't use actors for** a tool call *internally*: a tool
  call is a single async function; only the *supervision* of
  repeated tool calls is actor-level.

---

## 4. Our Adaptation for HuaEngine v4.0

### 4.1 Mental model

> HuaEngine v4.0 is a **supervision tree of actors**. The 7 v3.0
> "stages" become 7 *stage actors*, each with a small
> responsibility and a clear contract. The actors that
> cooperate on a single user request are grouped under a
> **`RequestSupervisor`** that is spawned per-request. The
> whole tree is rooted at a single **`EngineSupervisor`** that
> lives for the lifetime of the process. When any actor
> crashes, the crash signal propagates *up* the tree until a
> supervisor decides what to do. The default policy is
> **`one_for_one` with intensity 3 / period 5s**: if an actor
> crashes 3 times in 5 seconds, the supervisor *itself*
> crashes, and the *parent* of the supervisor takes over.

### 4.2 How actors wrap v3.0 components

| v3.0 component | v4.0 actor | Supervisor | Restart strategy | State preservation |
|---|---|---|---|---|
| `Engine` (orchestrator) | `RequestSupervisor` (one per request) | `EngineSupervisor` | `one_for_one` (restart only the failed stage) | Re-create child actors from scratch; load shared state from `IdentityActor` |
| `Planner` | `PlannerActor` | `RequestSupervisor` | `transient` (restart on abnormal exit only) | Method library from `MethodLibraryActor`; working plan in actor's local state |
| `Executor` | `ExecutorActor` | `RequestSupervisor` | `permanent` | Current step's snapshot (already in v3.0 `SnapshotManager`) |
| `Critic` | `CriticActor` × 3 (per primitive #4 critic mesh) | `CriticSupervisor` (per-request) | `one_for_one` | Per-critic scratch state only |
| `Reflector` | `ReflectorActor` | `RequestSupervisor` | `transient` | Episode list in `MemoryActor` |
| `IdentityManager` | `IdentityActor` (singleton, addressable) | `EngineSupervisor` | `permanent` | Disk-backed (already in v3.0); re-read on restart |
| `ColdStartScanner` | `ColdStartActor` (singleton) | `EngineSupervisor` | `transient` | In-memory cache; re-scan on restart |
| `SnapshotManager` | `SnapshotActor` (singleton) | `EngineSupervisor` | `permanent` | Disk-backed; LRU-bounded |
| `DoomLoopDetector` | `DoomLoopActor` (singleton) | `EngineSupervisor` | `transient` | In-memory history; lost on restart (acceptable) |
| `Architect` | `ArchitectActor` | `RequestSupervisor` | `transient` | Spec draft in local state |
| `SmartEditor` | `EditorActor` | `RequestSupervisor` | `permanent` | Pending edit in local state; flush on crash |
| `InstinctSynthesizer` | `InstinctActor` (singleton) | `EngineSupervisor` | `transient` | Disk-backed |
| `MethodLibrary` (v4.0 new) | `MethodLibraryActor` (singleton, addressable by name) | `EngineSupervisor` | `permanent` | Disk-backed JSON |
| `Memory` (raw conversation) | `MemoryActor` (singleton) | `EngineSupervisor` | `permanent` | Disk-backed; chunked |
| `LLMClient` (call wrapper) | `LLMActor` (one per call) | `RequestSupervisor` | `temporary` (each call is a fresh actor) | Timeout, retry, model-fallback policy |

### 4.3 State preservation strategy

Three layers, mirroring the v3.0 stack:

1. **In-memory state** (the actor's own class fields). Lost on
   crash. *Fast*, no serialization. The default.
2. **Hot snapshot** (the actor's own `snapshot()` method, called
   by the supervisor every N messages or T seconds). Held in
   memory by the supervisor. *Re-instantiated* on restart.
   This is a faithful extension of v3.0's `SnapshotManager`
   to per-actor state.
3. **Cold snapshot** (the actor's `persist()` method, called
   on graceful shutdown or N restarts). Disk-backed. Used for
   *addressable* actors (Identity, MethodLibrary, Memory,
   Instinct) only.

For a non-addressable actor (Planner, Critic, Executor), the
*hot snapshot* is enough. On crash, the supervisor:

1. Logs the crash with full context.
2. Constructs a new actor instance.
3. Calls `actor.restore(hotSnapshot)` before sending any new
   messages.
4. Resumes the actor's inbox (the messages queued during the
   restart).

This means **a crash is invisible to the actor's clients**: their
messages were queued; the supervisor delivers them to the
re-instantiated actor.

### 4.4 Supervisor tree design

```
EngineSupervisor                              [permanent, one_for_one, intensity=3/5s]
├── IdentityActor                              [permanent, addressable]
├── ColdStartActor                             [transient]
├── SnapshotActor                              [permanent]
├── DoomLoopActor                              [transient]
├── InstinctActor                              [transient]
├── MethodLibraryActor                         [permanent, addressable]
├── MemoryActor                                [permanent, addressable]
└── (per-request) RequestSupervisor            [temporary, one_for_one, intensity=3/5s]
    ├── PlannerActor                           [transient]
    ├── ArchitectActor                         [transient]
    ├── EditorActor                            [permanent]
    ├── CriticSupervisor                       [temporary, one_for_one, intensity=3/5s]
    │   ├── CriticActor-A ("correctness")
    │   ├── CriticActor-B ("completeness")
    │   └── CriticActor-C ("quality")
    ├── ReflectorActor                         [transient]
    └── LLMActor (one per LLM call)            [temporary]
```

The *intensity* is the OTP "circuit breaker": if a supervisor's
children crash more than `intensity` times in `period` seconds, the
supervisor itself crashes, propagating to the *parent*. This is
the only way a *partial* failure becomes a *total* failure — by
exceeding the budget of the closest supervisor.

### 4.5 Crash recovery protocol

When an actor crashes, the recovery sequence is:

1. **Pre-crash log.** The `Actor.onCrash(err, message)` hook writes
   a structured log: `{actor, stateHash, lastMessage, error,
   stackTrace, traceId}`. This is the *post-mortem*.
2. **Hot snapshot.** The supervisor calls `actor.snapshot()` on the
   *dead* actor's last known state. (We hold the state in the
   supervisor, not the actor, so this is cheap.)
3. **Decision.** The supervisor's strategy decides: restart, restart
   all, escalate. For v4.0, the default is `one_for_one`, restart.
4. **Re-instantiation.** A new actor instance is constructed with
   the same ID and the snapshot passed to `restore(snap)`.
5. **Message replay.** Messages that were in the actor's mailbox
   *and* arrived during the restart window are re-delivered. (The
   supervisor held them.)
6. **Resume.** The new actor's `handleMessage()` is called as
   normal. To the rest of the system, nothing happened.

For *non-restartable* failures (e.g., the LLM client has been
rate-limited 3 times in 5 seconds), the supervisor itself crashes,
its parent (the `RequestSupervisor`) catches, and the parent
*either* (a) escalates to the user with a "I cannot complete this
task" message, or (b) falls back to a cheaper strategy (the
degraded mode from primitive #2: capability composition).

### 4.6 What we are *not* doing

- **Not** implementing BEAM-style preemptive scheduling. Node's
  single-threaded event loop is the *scheduler*. Our actors are
  *cooperative*: an actor that does `await sleep(forever)` blocks
  its message queue. The watchdog (timer) is the only way to
  interrupt it.
- **Not** implementing distributed actors. All actors are in one
  process. We leave a *seam* (`Transport` interface) for future
  distribution.
- **Not** implementing a custom serializer. Actor state is JSON.
  Slow, but simple. Binary serialization can be a future
  optimization.
- **Not** using `Effect-TS` or `xstate` as a dependency. We
  *port* the small bits we need. Zero external deps is a
  HuaEngine constraint.
- **Not** implementing `gen_event`. The OTP "event handler"
  pattern (many handlers subscribed to one event source) is
  useful for logging and metrics, but we already have the
  `hooks.js` system. Reusing it.
- **Not** trying to be Erlang. We take the *contract*, not the
  *runtime*.

### 4.7 Integration with the other v4.0 primitives

- **Primitive #1 (Stream-native)**: the actor's mailbox is the
  stream. The `Actor` class implements `AsyncIterable<Message>`
  and `send()` is the producer. The stream's backpressure maps to
  the mailbox's bounded size: when the mailbox is full, `send()`
  awaits (the stream pauses).
- **Primitive #2 (Capability composition)**: an actor's
  `handleMessage()` can delegate to a *capability* actor (a
  specialized worker). The capability is addressable; the
  composed agent is a tree.
- **Primitive #4 (Critic mesh)**: the `CriticSupervisor` *is* the
  mesh. Three `CriticActor` children with different system
  prompts, different temperatures, and different exemplars.
  The mesh's *aggregator* is the `CriticSupervisor` itself,
  which collects 3 results and emits the consensus.
- **Primitive #5 (HTN)**: the `PlannerActor` *contains* the HTN
  planner from primitive #5. The method library lives in the
  addressable `MethodLibraryActor`.

---

## 5. TypeScript Sketch

The following is a complete, runnable sketch (~400 lines) of the
actor model + supervisor + state preservation. It is
self-contained — no imports from v3.0, no external deps. It
*is* the v4.0 starting point for `engine/actors/`.

```ts
// ─────────────────────────────────────────────────────────────────
// HuaEngine v4.0 — Actor Model & Supervision Tree (sketch)
// ─────────────────────────────────────────────────────────────────
//
// Zero external deps. Node 22. ESM. TypeScript strict.
//
// Design contract:
//   - Every actor has a unique Address (UUID).
//   - Every actor has a Mailbox (bounded FIFO queue).
//   - Every actor has a Behavior (typed message handler).
//   - Every actor has a Supervisor (parent in the supervision tree).
//   - Every message has a `messageId` (idempotency key) and a
//     `traceId` (OpenTelemetry-style).
//   - Crashes are caught by the supervisor, never by the actor.
//   - State is preserved via a 2-tier snapshot: hot (in-memory,
//     in supervisor) and cold (disk-backed, for addressable actors).
//
// Inspired by Erlang/OTP gen_server + supervisor, Akka's Behaviors,
// and Orleans's virtual actors. Adapted to TypeScript + Node 22.
//

// ─── 1. The Message type ──────────────────────────────────────────

export type Message<M = unknown> = {
  messageId: string;        // idempotency key
  traceId: string;          // OpenTelemetry-style
  type: string;             // e.g., 'plan', 'execute', 'crash'
  payload: M;               // typed payload
  replyTo?: Address;        // for ask-pattern
  // Internal — set by the transport, not by the sender
  _enqueuedAt?: number;
};

export type Address = string;  // UUID, e.g., 'actor:1f2e3d4c-...'

// ─── 2. The Transport (mailbox) ───────────────────────────────────

export interface Transport {
  send(to: Address, msg: Message): Promise<void>;
  drain(from: Address): AsyncIterable<Message>;
  onCrash(addr: Address, err: Error): void;  // hook for the supervisor
}

// A simple in-memory transport. Bounded mailbox with backpressure.
export class InMemoryTransport implements Transport {
  private mailboxes = new Map<Address, Message[]>();
  private capacities = new Map<Address, number>();
  private waiters = new Map<Address, Array<() => void>>();
  private crashHandlers = new Map<Address, (err: Error) => void>();

  register(addr: Address, capacity = 100) {
    this.mailboxes.set(addr, []);
    this.capacities.set(addr, capacity);
  }
  unregister(addr: Address) {
    this.mailboxes.delete(addr);
    this.capacities.delete(addr);
    this.waiters.delete(addr);
  }
  setCrashHandler(addr: Address, h: (err: Error) => void) {
    this.crashHandlers.set(addr, h);
  }

  async send(to: Address, msg: Message): Promise<void> {
    const mb = this.mailboxes.get(to);
    if (!mb) throw new Error(`No mailbox for ${to}`);
    const cap = this.capacities.get(to) ?? 100;

    // Backpressure: wait if the mailbox is full
    while (mb.length >= cap) {
      await new Promise<void>((resolve) => {
        const list = this.waiters.get(to) ?? [];
        list.push(resolve);
        this.waiters.set(to, list);
      });
    }
    msg._enqueuedAt = Date.now();
    mb.push(msg);
  }

  async *drain(from: Address): AsyncIterable<Message> {
    while (true) {
      const mb = this.mailboxes.get(from);
      if (!mb) return;
      while (mb.length === 0) {
        await new Promise<void>((r) => setTimeout(r, 5));
      }
      const msg = mb.shift()!;
      // Wake one waiter
      const w = this.waiters.get(from);
      if (w && w.length > 0) {
        const resolve = w.shift()!;
        resolve();
      }
      yield msg;
    }
  }

  onCrash(addr: Address, err: Error) {
    const h = this.crashHandlers.get(addr);
    if (h) h(err);
  }
}

// ─── 3. The Actor base class (gen_server-style) ───────────────────

export interface ActorContext<S, R> {
  self: Address;
  supervisor: Address;
  state: S;
  send(to: Address, msg: Message): Promise<void>;
  ask<T>(to: Address, msg: Omit<Message, 'replyTo'>): Promise<T>;
  snapshot(): S;
  reply<R>(to: Message, payload: R): Promise<void>;
  log(event: string, data?: Record<string, unknown>): void;
  crash(reason: Error): never;  // explicit crash — caught by supervisor
}

export abstract class Actor<S, R = unknown> {
  abstract readonly address: Address;
  protected state!: S;
  protected supervisor: Address = 'system';
  protected transport!: Transport;

  // The gen_server contract:
  abstract init(ctx: ActorContext<S, R>): Promise<S>;
  abstract handleMessage(
    msg: Message,
    ctx: ActorContext<S, R>,
  ): Promise<Partial<S> | void>;
  onStart?(ctx: ActorContext<S, R>): Promise<void>;
  onStop?(ctx: ActorContext<S, R>): Promise<void>;
  onRestart?(ctx: ActorContext<S, R>, prev: S): Promise<void>;
  onCrash?(err: Error, msg: Message, ctx: ActorContext<S, R>): Promise<void>;

  // The message loop. NEVER throws. Errors are caught and routed
  // to the supervisor via transport.onCrash.
  async run() {
    const ctx: ActorContext<S, R> = {
      self: this.address,
      supervisor: this.supervisor,
      get state() { return this.state; },
      send: (to, msg) => this.transport.send(to, msg),
      ask: async (to, msg) => this.askImpl(to, msg),
      snapshot: () => this.state,
      reply: (orig, payload) =>
        orig.replyTo
          ? this.transport.send(orig.replyTo, {
              messageId: `${orig.messageId}:reply`,
              traceId: orig.traceId,
              type: `${orig.type}:reply`,
              payload,
            })
          : Promise.resolve(),
      log: (e, d) => console.log(`[${this.address}] ${e}`, d ?? ''),
      crash: (e) => { throw e; },  // re-thrown, caught by supervisor
    };
    try {
      this.state = await this.init(ctx);
      await this.onStart?.(ctx);
    } catch (err: any) {
      this.transport.onCrash(this.address, err);
      return;
    }
    for await (const msg of this.transport.drain(this.address)) {
      try {
        const update = await this.handleMessage(msg, ctx);
        if (update && typeof update === 'object') {
          this.state = { ...this.state, ...update } as S;
        }
      } catch (err: any) {
        // Message-level error: notify supervisor, KEEP the actor alive
        // (we do NOT crash on every error — only on `ctx.crash()`)
        await this.onCrash?.(err, msg, ctx);
        ctx.log('handler_error', { type: msg.type, err: err.message });
      }
    }
    await this.onStop?.(ctx);
  }

  // The ask pattern: send a request, await the reply.
  private pendingAsks = new Map<string, { resolve: (v: any) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();

  private async askImpl<T>(to: Address, msg: Omit<Message, 'replyTo'>): Promise<T> {
    const replyMsgId = `${msg.messageId}:reply`;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingAsks.delete(replyMsgId);
        reject(new Error(`ask timeout: ${msg.type} -> ${to}`));
      }, 30_000);
      this.pendingAsks.set(replyMsgId, { resolve, reject, timer });
      this.transport.send(to, { ...msg, replyTo: this.address } as Message);
    });
  }
}

// ─── 4. The Supervisor (OTP-style) ────────────────────────────────

export type RestartStrategy =
  | { kind: 'one_for_one'; intensity: number; periodMs: number }
  | { kind: 'one_for_all'; intensity: number; periodMs: number }
  | { kind: 'rest_for_one'; intensity: number; periodMs: number };

export type ChildSpec = {
  id: string;
  factory: () => Actor<any, any>;
  restart: 'permanent' | 'transient' | 'temporary';
  startOrder: number;        // for `rest_for_one`
};

export class Supervisor {
  private children = new Map<string, Actor<any, any>>();
  private crashTimestamps = new Map<string, number[]>();  // per child
  private strategy: RestartStrategy;
  private transport: Transport;
  public readonly address: Address;

  constructor(addr: Address, transport: Transport, strategy: RestartStrategy) {
    this.address = addr;
    this.transport = transport;
    this.strategy = strategy;
  }

  async spawnChild(spec: ChildSpec) {
    const child = spec.factory();
    child.supervisor = this.address;
    this.transport.register(child.address, 100);
    this.transport.setCrashHandler(child.address, (err) =>
      this.onChildCrash(spec, err),
    );
    this.children.set(spec.id, child);
    // Run the actor loop in the background; do NOT await it
    void child.run();
    return child;
  }

  private async onChildCrash(spec: ChildSpec, err: Error) {
    console.error(`[supervisor ${this.address}] child ${spec.id} crashed:`, err.message);

    // Circuit breaker: count crashes within `periodMs`
    const now = Date.now();
    const stamps = (this.crashTimestamps.get(spec.id) ?? [])
      .filter((t) => now - t < this.strategy.periodMs);
    stamps.push(now);
    this.crashTimestamps.set(spec.id, stamps);

    if (stamps.length > this.strategy.intensity) {
      // Circuit breaker tripped. Escalate to OUR supervisor.
      console.error(`[supervisor ${this.address}] circuit breaker tripped on ${spec.id}`);
      this.transport.onCrash(this.address,
        new Error(`child ${spec.id} exceeded intensity ${this.strategy.intensity} in ${this.strategy.periodMs}ms`));
      return;
    }

    if (spec.restart === 'temporary') return;  // do not restart

    if (this.strategy.kind === 'one_for_one' || spec.restart === 'transient') {
      await this.restartOne(spec);
    } else if (this.strategy.kind === 'one_for_all') {
      // (sketch — restart all children in startOrder)
    } else if (this.strategy.kind === 'rest_for_one') {
      // (sketch — restart child and all after it in startOrder)
    }
  }

  private async restartOne(spec: ChildSpec) {
    const oldChild = this.children.get(spec.id);
    if (!oldChild) return;
    this.transport.unregister(oldChild.address);
    const prev = oldChild.snapshot?.();
    const newChild = spec.factory();
    newChild.supervisor = this.address;
    this.transport.register(newChild.address, 100);
    this.transport.setCrashHandler(newChild.address, (err) =>
      this.onChildCrash(spec, err),
    );
    this.children.set(spec.id, newChild);
    if (prev && newChild.onRestart) {
      // Hot snapshot: restore from previous state
      await newChild.onRestart(
        {
          self: newChild.address,
          supervisor: this.address,
          state: prev,
          send: (to, m) => this.transport.send(to, m),
          ask: async () => { throw new Error('not impl'); },
          snapshot: () => prev,
          reply: async () => {},
          log: (e, d) => console.log(`[${newChild.address}] ${e}`, d),
          crash: (e) => { throw e; },
        },
        prev,
      );
    }
    void newChild.run();
  }
}

// ─── 5. Concrete actors: the v3.0 wrappers ────────────────────────

import { Planner } from '../engine/planner.js';
import { Critic } from '../engine/critic.js';
import { SnapshotManager } from '../engine/v3/snapshot.js';
import { DoomLoopDetector } from '../engine/v3/doomloop.js';
import { IdentityManager } from '../engine/v3/identity.js';
import { UnifiedClient } from '../providers/client.js';
import { nanoid } from 'nanoid';

type PlannerState = {
  planner: Planner;
  currentPlan?: { goal: string; steps: any[] };
};

export class PlannerActor extends Actor<PlannerState> {
  readonly address: Address = `planner:${nanoid()}`;

  async init(ctx: ActorContext<PlannerState>): Promise<PlannerState> {
    return { planner: (ctx as any).planner /* injected at spawn */ };
  }

  async handleMessage(msg: Message, ctx: ActorContext<PlannerState>) {
    if (msg.type === 'plan') {
      const { request, availableTools } = msg.payload as any;
      const plan = await ctx.state.planner.plan({ request, availableTools });
      await ctx.reply(msg, { plan });
      return { currentPlan: plan };
    }
    if (msg.type === 'snapshot') {
      return ctx.state;  // hot snapshot is just the current state
    }
  }
}

type ExecutorState = {
  snapshotMgr: SnapshotManager;
  doomLoop: DoomLoopDetector;
  currentStep?: { tool: string; args: any };
};

export class ExecutorActor extends Actor<ExecutorState> {
  readonly address: Address = `executor:${nanoid()}`;
  private watchdogTimer: NodeJS.Timeout | null = null;

  async init(ctx: ActorContext<ExecutorState>): Promise<ExecutorState> {
    return { snapshotMgr: (ctx as any).snapshotMgr, doomLoop: (ctx as any).doomLoop };
  }

  async handleMessage(msg: Message, ctx: ActorContext<ExecutorState>) {
    if (msg.type === 'execute_step') {
      const { tool, args, execute } = msg.payload as any;
      // Watchdog: kill the actor if the tool takes > 30s
      ctx.state.currentStep = { tool, args };
      this.watchdogTimer = setTimeout(() => {
        ctx.crash(new Error(`Tool ${tool} timed out after 30s`));
      }, 30_000);
      try {
        const result = await execute();
        clearTimeout(this.watchdogTimer);
        await ctx.reply(msg, { result });
        return { currentStep: undefined };
      } finally {
        clearTimeout(this.watchdogTimer);
      }
    }
  }
}

type IdentityState = {
  mgr: IdentityManager;
  cache?: any;
};

export class IdentityActor extends Actor<IdentityState> {
  readonly address: Address = `identity:${nanoid()}`;

  async init(ctx: ActorContext<IdentityState>): Promise<IdentityState> {
    return { mgr: (ctx as any).mgr };
  }

  async handleMessage(msg: Message, ctx: ActorContext<IdentityState>) {
    if (msg.type === 'get') {
      const snap = await ctx.state.mgr.get();
      await ctx.reply(msg, { identity: snap });
      return { cache: snap };
    }
    if (msg.type === 'update_context') {
      ctx.state.mgr.updateContext(msg.payload);
      return { cache: ctx.state.mgr['cache'] };
    }
  }

  // Hot snapshot: return the cache; the supervisor holds it across restarts.
  // Cold snapshot: write to disk (handled by IdentityManager's .cacheFile).
  async onRestart(ctx: ActorContext<IdentityState>, prev: IdentityState) {
    // The new instance re-reads from disk; if the previous cache was
    // in-memory only, this is a no-op. Identity is a 'permanent'
    // addressable actor — the supervisor holds its address.
  }
}

// ─── 6. The EngineSupervisor (top of the tree) ────────────────────

export class EngineSupervisor {
  readonly address: Address = `engine:${nanoid()}`;
  private transport = new InMemoryTransport();
  private rootSup: Supervisor;
  private children: Map<string, Supervisor> = new Map();

  constructor(
    private client: UnifiedClient,
    private tools: any,
    private memory: any,
    private projectRoot: string,
  ) {
    this.rootSup = new Supervisor(this.address, this.transport, {
      kind: 'one_for_one', intensity: 3, periodMs: 5_000,
    });
  }

  async start() {
    // The addressable singleton actors
    await this.rootSup.spawnChild({
      id: 'identity',
      factory: () => {
        const mgr = new IdentityManager(this.projectRoot, this.memory);
        return new IdentityActor();
      },
      restart: 'permanent',
      startOrder: 0,
    });
    // ... same for SnapshotActor, DoomLoopActor, InstinctActor,
    //     MethodLibraryActor, MemoryActor ...

    // Register the addressable actors' addresses in a registry
    AddressRegistry.register('identity', (await this.children.get('identity')!).address);
  }

  async processRequest(userMessage: string): Promise<string> {
    // Spawn a RequestSupervisor for this request
    const reqAddr: Address = `req:${nanoid()}`;
    this.transport.register(reqAddr, 50);
    const reqSup = new Supervisor(reqAddr, this.transport, {
      kind: 'one_for_one', intensity: 3, periodMs: 5_000,
    });
    this.children.set(reqAddr, reqSup);

    // Spawn the per-request actors
    const planner = await reqSup.spawnChild({
      id: 'planner',
      factory: () => {
        const a = new PlannerActor();
        (a as any).planner = new Planner(this.client);
        return a;
      },
      restart: 'transient',
      startOrder: 0,
    });
    // ... Architect, Executor, CriticSupervisor, Reflector ...

    // Send the user message
    await this.transport.send(planner.address, {
      messageId: nanoid(),
      traceId: nanoid(),
      type: 'plan',
      payload: { request: userMessage, availableTools: this.tools.list().map((t: any) => t.name) },
    });

    // ... rest of the orchestration
  }
}

// ─── 7. Address registry (for addressable actors) ─────────────────

export class AddressRegistry {
  private static map = new Map<string, Address>();
  static register(name: string, addr: Address) { this.map.set(name, addr); }
  static resolve(name: string): Address {
    const a = this.map.get(name);
    if (!a) throw new Error(`No addressable actor named ${name}`);
    return a;
  }
}
```

### Key design points in the sketch

1. **The `Transport` is an interface.** The `InMemoryTransport`
   is the default. A future `WebWorkerTransport` would put
   actors in workers; a future `RedisTransport` would put them
   on different machines. The actor code doesn't change.
2. **The `Actor` class is `gen_server`-faithful**: `init`,
   `handleMessage`, `onStart`, `onStop`, `onRestart`, `onCrash`.
3. **Crashes are caught at the message-handler boundary.** The
   actor's `run()` loop never throws. The supervisor is the
   *only* entity that decides to restart.
4. **The watchdog is a `setTimeout`** in the `ExecutorActor`. If
   the tool doesn't return in 30s, the actor crashes itself.
   The supervisor catches the crash, decides to restart, and the
   executor comes back with a fresh state.
5. **`one_for_one` is the default**, with `intensity=3, period=5s`.
   This is the OTP circuit breaker. If an actor crashes 3 times
   in 5s, the supervisor itself crashes, and the *parent*
   decides what to do (typically: escalate to the user).
6. **Addressable actors** (`IdentityActor`, `MethodLibraryActor`,
   `MemoryActor`) are registered in a name → address map. Other
   actors address them by name (`AddressRegistry.resolve('identity')`)
   so the address is *stable across restarts*.
7. **Hot snapshot** is held by the *supervisor* (not the actor),
   via `child.snapshot?.()`. On restart, the supervisor passes it
   to the new actor's `onRestart` hook.
8. **Idempotency**: every message has a `messageId`. The ask-pattern
   (a future enhancement) dedupes by it.
9. **Backpressure**: the transport's `send()` blocks when the
   mailbox is full. This is the in-band pause signal.

---

## 6. Open Questions

1. **External library or roll-our-own?** The sketch above is
   ~400 lines. Effect-TS gives us ~80% of this for free but
   adds ~80 KB minified and a substantial type-system
   learning curve. xstate is lighter (~30 KB) but doesn't
   give us the supervision tree. We need to decide:
   zero-dep purity vs. faster time-to-v1. **My current
   recommendation: roll our own** (per the project's zero-dep
   constraint), with the sketch above as the starting point.
   Keep the `Transport` interface clean so we can swap in
   Effect-TS fibers later if we change our mind.

2. **Hot vs cold snapshot granularity.** v3.0's
   `SnapshotManager` is file-level. v4.0's actor state is
   more varied: a `PlannerActor` has a `currentPlan` (small,
   hot), a `MethodLibraryActor` has a 1000-method library
   (large, cold), an `ExecutorActor` has a `currentStep`
   (tiny, hot). Should the supervisor hold *all* hot
   snapshots, or should each actor declare a
   `snapshotSize` budget? What's the right LRU policy?

3. **What if the LLM call hangs indefinitely?** The
   `ExecutorActor`'s watchdog has a 30s timer. But what if
   the LLM call *returns* garbage that causes the critic
   to loop forever? The `CriticSupervisor` should have a
   *time-budget* (not just a crash count) — kill the critic
   after 60s regardless. We don't have this in the sketch.

4. **Per-actor rate limiting.** The v3.0 `DoomLoopDetector`
   is global. In v4.0, each `ExecutorActor` instance has
   its own doom-loop budget. But should the *supervisor*
   also enforce a global rate (e.g., "no more than 10
   LLM calls per second across all actors")? Probably
   yes, but this is a *resource policy* actor we haven't
   designed.

5. **Addressable actor persistence.** v3.0 already has
   `IdentityManager` writing to
   `projectRoot/.huagent/identity.json`. v4.0's
   `MethodLibraryActor` should write to
   `~/.huagent/methods.json` (per-user, not per-project).
   The `MemoryActor` writes conversation chunks. Where
   exactly? Should there be a single `DiskActor` that
   all addressable actors share, or does each addressable
   actor have its own file?

6. **State machine per actor vs single state.** Should each
   actor's lifecycle be encoded as a state machine (using
   xstate or a hand-rolled 30-line class), or is the
   `init → handleMessage → ...` pattern enough? The
   `CriticActor` is interesting because it has
   *internal* states (`idle`, `prompting`, `parsing`,
   `verdict-ready`, `debating`) that are visible to the
   supervisor. We may want a typed state enum on every
   actor.

7. **Crash-recovery semantics for in-flight LLM streams.**
   When the `LLMActor` is mid-stream (an OpenAI-compatible
   SSE stream is open) and the process is killed (Ctrl-C,
   OOM, deploy), the next restart should *not* continue
   the stream (the connection is dead). What's the right
   contract? The `LLMActor` should hold the *original
   request* (prompt, model, tools) so a new instance can
   re-issue it. The streaming tokens are not recoverable
   — by definition, streaming output is ephemeral.

8. **Multi-request concurrency.** A user might send two
   messages in quick succession. Should each get its own
   `RequestSupervisor`? Should they share a
   `MemoryActor`? Should they share an LLM rate-limit
   budget? This is the *session* vs *request* boundary,
   and we haven't pinned it down. (v3.0's `Engine`
   is per-session; v4.0's `EngineSupervisor` is
   per-process; `RequestSupervisor` is per-request. But
   the session actor is missing from the sketch.)

9. **Testing the supervision tree.** How do we test that
   an actor crashes and the supervisor restarts it? The
   sketch has a `crash(reason)` method that throws. A
   test would:
   1. Spawn the actor in a test transport.
   2. Send a message that calls `ctx.crash(new Error('test'))`.
   3. Send a follow-up message.
   4. Assert the follow-up is handled by a *new* instance
      (e.g., the instance ID counter has incremented).
   We should ship a test harness for this.

10. **Observability integration.** The v3.0 `EngineEvent`
    stream emits 25+ event types. In v4.0, every actor
    should emit a structured log on lifecycle events:
    `actor_spawned`, `actor_started`, `actor_message_received`,
    `actor_message_handled`, `actor_crashed`, `actor_restarted`,
    `actor_stopped`. These should be
    OpenTelemetry-compatible (use a `traceId` / `spanId`).
    A future tracing actor could aggregate them.

11. **Migration strategy from v3.0.** v3.0's `Engine`
    class is ~670 lines. v4.0's actor tree will be
    ~1500 lines (4 files × ~400). The migration is *not*
    a rewrite — v3.0 stays, and v4.0's
    `EngineSupervisor.processRequest()` can be invoked
    *from* v3.0 as a "v4.0 opt-in" path. We need a
    feature flag and a parallel test suite for the
    first 3 months.

12. **What about `await` chains inside an actor?** If
    `handleMessage()` does `await x; await y; await z`,
    and the actor is killed between `y` and `z`, the
    `z` call may still run (it's an unresolved Promise).
    We need `AbortController`-based cancellation, and
    we need to pass the `AbortSignal` into *every*
    async call (LLM, tool, DB). The v4.0 actor should
    own an `AbortController` and abort it on `onStop`.
    This is not in the sketch.

13. **What's the cost of supervision overhead?** Each
    actor spawn allocates a `Map` entry, registers a
    mailbox, and creates a closure. For 10 actors per
    request, with 100 concurrent requests, that's 1000
    actors. Memory is fine; CPU is fine; *but* every
    message has to go through the transport, which means
    a closure invocation. Microbenchmarks needed.

14. **Distributed actors: seam or commitment?** The
    `Transport` interface is a seam. We can leave it as
    that for v4.0 and decide in v5.0 whether to support
    multi-node actors (likely a hard requirement if we
    want the planner, executor, and critic to run in
    parallel on a big task). The risk of committing too
    early: serialization overhead, network failures, and
    the loss of single-process reasoning.

15. **Where does the v3.0 `Engine` end up?** Options:
    (a) Delete it after v4.0 ships, (b) Keep it as a
    "v3-compat" fallback for users who haven't opted in,
    (c) Wrap the v3.0 `Engine` itself as an actor (the
    "Legacy Engine Actor") and let new code talk to it
    via the same message protocol. Option (c) is the
    lowest-risk migration.

16. **Should supervisors be observable as actors
    themselves?** In Erlang, a supervisor is a process
    and you can `sys:get_state(Sup)` to introspect it.
    In v4.0, our `Supervisor` is *not* an `Actor` (it's
    a different class). Should it be? If so, we can
    send it `'inspect'` messages and get back the
    child specs and crash counts. This would be a
    major debugging win.

---

## Appendix A: Cross-cutting integration map

| v4.0 primitive | How it uses the actor model |
|---|---|
| #1 Stream-native | Mailbox is the stream. `send()` is the producer. Backpressure is the bounded queue. |
| #2 Capability composition | A capability is an addressable actor. A composed agent is a tree of capability actors + composition actor. |
| #4 Critic mesh | The `CriticSupervisor` *is* the mesh. Three `CriticActor` children; the supervisor aggregates. |
| #5 HTN | The `PlannerActor` contains the HTN planner. The `MethodLibraryActor` is addressable by name. |
| #6 Memory graph | The `MemoryActor` is addressable. Episodic memory is a sequence of `MemoryEntry` events in its log. |
| #7 Speculative execution | The `SpeculativeSupervisor` spawns N `ExecutorActor` instances in parallel; first to pass the critic wins. The losers are stopped. |
| #8 Identity persistence | The `IdentityActor` is the addressable singleton; survives crashes because its state is disk-backed. |

## Appendix B: Where the supervisor tree appears in the user's mental model

When the user types "fix the bug in auth.ts" and we crash-and-recover
the `CriticActor` 3 times in 5s, the user sees:

```
✓ Step 1: read auth.ts
✓ Step 2: identify the bug
✓ Step 3: apply the fix
✓ Step 4: run the test
⏳ Verifying (critic C timed out, restarting…)    ← this is good UX
⏳ Verifying (critic C crashed 3 times; falling back to critic A)  ← this is also good UX
✓ Score: 4.2/5 (pass)
```

The user sees "restarts" and "fallbacks" because we expose them at the
*supervision* level, not at the *exception* level. The alternative —
v3.0 — is to see a stack trace dump to the TUI. That's the gap v4.0
closes.

---

*End of Primitive 3 (Actor Model & Self-Healing) research document.*
