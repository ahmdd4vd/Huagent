# HuaEngine v4.0 — Architecture

> The stream-native actor model that powers v4.0

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         HUAENGINE v4.0                              │
│                                                                     │
│  User Request                                                       │
│       │                                                             │
│       ▼                                                             │
│  ┌─────────────┐                                                    │
│  │  Input$     │ (AsyncIterable<CognitiveEvent>)                   │
│  └─────────────┘                                                    │
│       │                                                             │
│       ▼                                                             │
│  ┌──────────────────────────────────────────────────┐              │
│  │  STAGE 1: CLASSIFIER                            │              │
│  │  - intent (code_write | code_fix | question)    │              │
│  │  - complexity (trivial | simple | moderate)     │              │
│  │  - shortcuts? (pattern match → bypass stages)   │              │
│  │  Output: ClassifiedEvent                        │              │
│  └──────────────────────────────────────────────────┘              │
│       │                                                             │
│       ▼                                                             │
│  ┌──────────────────────────────────────────────────┐              │
│  │  STAGE 2: HTN DECOMPOSER                        │              │
│  │  - decompose task → subgoals → atomic steps     │              │
│  │  - identify parallel groups                     │              │
│  │  - identify dependencies                        │              │
│  │  Output: HTNPlan { graph, subgoals, steps }     │              │
│  └──────────────────────────────────────────────────┘              │
│       │                                                             │
│       ▼                                                             │
│  ┌──────────────────────────────────────────────────┐              │
│  │  STAGE 3: SPECULATIVE EXECUTOR                  │              │
│  │  - launch 3 strategy variants (shadow snapshot) │              │
│  │  - race with timeout/budget                     │              │
│  │  - first quality > threshold wins               │              │
│  │  - cancel losers, rollback snapshots            │              │
│  │  Output: ExecutionTrace { winner, candidates }  │              │
│  └──────────────────────────────────────────────────┘              │
│       │                                                             │
│       ▼                                                             │
│  ┌──────────────────────────────────────────────────┐              │
│  │  STAGE 4: CRITIC MESH                           │              │
│  │  - fan out to 3 critics (correctness/style/     │              │
│  │    intent personas)                             │              │
│  │  - vote (Borda count, weighted)                 │              │
│  │  - if disagree → 4th arbiter                    │              │
│  │  - factual layer: tsc, vitest, graph lookup     │              │
│  │  Output: MeshVerdict { score, confidence, ... } │              │
│  └──────────────────────────────────────────────────┘              │
│       │                                                             │
│       ▼                                                             │
│  ┌──────────────────────────────────────────────────┐              │
│  │  STAGE 5: GRAPH REFLECTOR                       │              │
│  │  - record episode node + edges (causal)         │              │
│  │  - extract insights (recipe / anti-pattern)    │              │
│  │  - update bi-temporal validity                 │              │
│  │  Output: ReflectedEvent                         │              │
│  └──────────────────────────────────────────────────┘              │
│       │                                                             │
│       ▼                                                             │
│  ┌─────────────┐                                                    │
│  │  Output$    │ (AsyncIterable<CognitiveEvent>)                   │
│  └─────────────┘                                                    │
│       │                                                             │
│       ▼                                                             │
│  User (constant flow, with stages visualized in TUI)               │
└─────────────────────────────────────────────────────────────────────┘
```

## The 7 Primitives

### Pillar 1: Stream-Native Architecture

**Files:** `src/engine/v4/stream/`

The wire type is `CognitiveEvent`, a discriminated union of 30+ event kinds.
The engine never returns a single result — it emits a continuous stream.

**Why this matters:** Each component is composable. You can pipe a stream
into a critic mesh, into a graph writer, into a TUI. Easy to add
observability (just subscribe to the stream).

**Key abstractions:**
- `Source<T>` — produces events into a queue
- `Transform<TIn, TOut>` — consumes events, emits transformed events
- `Sink<T>` — consumes events
- `BoundedQueue<T>` — backpressure-aware queue (4 strategies: block, drop_old, drop_new, error)
- `tee<T>()` — multicast one stream to N consumers (used for critic mesh)
- `ReplayLog` — bounded ring buffer of events for time-travel debugging
- `EventFactory` — cheap event creation with monotonic `seq` numbers

### Pillar 2: HTN Planning

**Files:** `src/engine/v4/htn/`

Pyhop-style planning with LLM-driven method synthesis.

**Data model:**
```
Task
  └── Subgoal (high-level objective)
        ├── Step (atomic tool call)
        └── Subgoal (recursive)
```

**Key abstractions:**
- `HTNPlan` — full plan with subgoals, steps, execution order
- `HTNMethod` — how to decompose a task (precondition + apply)
- `HTNPlanner` — picks methods, applies them, topologically sorts
- Topological batching — subgoals with no dependencies run in parallel

**Built-in methods:**
- `trivial-question` — pure Q&A
- `shell-command` — run a bash command
- `code-write-feature` — investigate → design → implement → test
- `code-fix-bug` — locate → read context → fix → verify

**LLM synthesis:** If no built-in method matches, ask the LLM to synthesize
one. Failure-tolerant (LLM garbage → fallback to generic "do it" subgoal).

### Pillar 3: Speculative Execution

**Files:** `src/engine/v4/speculative/`

Race N strategies in parallel, take the first to pass quality threshold.

**Strategy diversification:** The same base strategy can be diversified
into fast/balanced/thorough variants with different cost/quality profiles.

**Algorithm (first_wins mode):**
1. Launch all strategies in parallel
2. As each finishes, check if quality >= threshold
3. If yes, declare winner
4. If all finish without a winner, take best of N
5. Cancel losers

**Why this matters:** For ambiguous tasks, 3x coverage of solution space
at 1x cost (losers are cancelled). Better than 1-attempt-with-retry.

### Pillar 4: Critic Mesh

**Files:** `src/engine/v4/critic/`

3 independent critics vote on every output. Disagreement triggers a 4th
arbiter.

**The 3 personas:**
- `correctness` — bugs, types, errors, edge cases
- `style` — readability, maintainability, conventions
- `intent` — does it match the user's request?

**Aggregation:**
- Weighted Borda count (each persona has different weight)
- Pass threshold: 0.7
- Fail threshold: 0.5
- Disagreement threshold: 0.3 (triggers arbiter)

**Why this matters:** Single LLM has known biases (position, self-
enhancement). Three critics with diverse personas catch different issues.
Disagreement is itself a signal of uncertainty.

### Pillar 5: Causal Memory Graph

**Files:** `src/engine/v4/graph/`

Bi-temporal property graph (SQLite + adjacency tables).

**Data model:**
- `GraphNode` — episode, file, function, error, insight, strategy, user, project
- `GraphEdge` — edited, caused, fixedBy, derived, dependsOn, related
- Bi-temporal: every node/edge has `validFrom` and `validTo`

**Query language:** 12 safe templates (Cypher-Lite). LLM cannot write raw
queries (security).

**Why this matters:**
- **Causal reasoning:** "Editing A caused bug B"
- **Time-travel:** "What did the graph look like at 12:34?"
- **Anti-hallucination:** "I claim function X exists" — graph search proves
  it.

### Pillar 6: Composable Capabilities

**Files:** `src/engine/v4/capability/`

Typed, streamable, permission-bound functions. Compose with `pipe`, `map`,
`if`, `fanout`.

**Why this matters:** Replace RPC-style tool calls with composable pipelines.
Type-checked at compile time, optimized at runtime (memoization, parallel
fan-out, redundant-call elision).

**Key abstractions:**
- `Capability<TIn, TOut>` — typed, async-iterable function
- `PipelineBuilder` — fluent DSL
- `pipe()`, `source()`, `execute()`, `optimize()`, `memoize()`

### Pillar 7: Self-Healing Actors

**Files:** `src/engine/v4/actor/`

Erlang/OTP-style actor model. Crashes restart with preserved state.

**Components:**
- `Actor<S>` — gen_server-style contract
- `Transport` — bounded mailbox + addressing
- `Supervisor` — supervision tree with restart strategies
- State preservation — three-tier (cold/warm/hot)

**Restart strategies:**
- `one_for_one` — restart only the failed actor
- `one_for_all` — restart all actors in the supervision tree
- `rest_for_one` — restart failed + all started after it

**Intensity check:** If more than N restarts in `intensityPeriodMs`, escalate
(defaults: 5 restarts / 5s).

**Why this matters:** Partial failure recovery. A buggy actor doesn't take
down the engine. "Let it crash" replaces "catch every error."

## The CognitiveEvent Type

Every component reads and writes `CognitiveEvent`. Discriminated union of
30+ kinds:

```typescript
type CognitiveEvent =
  | { kind: "session_start"; sessionId: string; ts: number; seq: number }
  | { kind: "session_end"; ... }
  | { kind: "classified"; task: string; intent: Intent; complexity: Complexity; ... }
  | { kind: "htn_plan"; planId: string; subgoals: number; steps: number; ... }
  | { kind: "subgoal_started"; subgoalId: string; description: string; ... }
  | { kind: "subgoal_completed"; ... }
  | { kind: "step_started"; stepId: string; tool: string; ... }
  | { kind: "step_completed"; ... }
  | { kind: "speculation_started"; raceId: string; strategies: string[]; ... }
  | { kind: "strategy_progress"; raceId: string; strategyId: string; progress: number; ... }
  | { kind: "strategy_succeeded"; ... }
  | { kind: "strategy_failed"; ... }
  | { kind: "strategy_cancelled"; ... }
  | { kind: "speculation_winner"; ... }
  | { kind: "tool_call"; tool: string; args: unknown; ... }
  | { kind: "tool_result"; tool: string; result: unknown; ... }
  | { kind: "tool_error"; ... }
  | { kind: "critic_verdict"; critic: CriticPersona; score: number; ... }
  | { kind: "mesh_verdict"; ... }
  | { kind: "episode_recorded"; episodeId: string; task: string; ok: boolean; ... }
  | { kind: "insight_extracted"; insightKind: "recipe" | "anti"; text: string; ... }
  | { kind: "graph_node_added"; ... }
  | { kind: "graph_edge_added"; ... }
  | { kind: "capability_pipeline"; ... }
  | { kind: "capability_optimized"; ... }
  | { kind: "actor_started"; ... }
  | { kind: "actor_crashed"; ... }
  | { kind: "actor_restarted"; ... }
  | { kind: "actor_stopped"; ... }
  | { kind: "token_delta"; ... }
  | { kind: "log"; level: LogLevel; msg: string; ... };
```

Every event carries `ts` (ms since engine start) and `seq` (monotonic
counter) for time-travel queries and replay.

## Data Flow

```
User: "fix auth bug in auth.ts"
       │
       ▼
[Classifier] → intent=code_fix, complexity=simple
       │
       ▼
[HTN Planner] → 4 subgoals, 4 parallel batches
       │
       ▼
[For each batch, in parallel:]
  [For each subgoal in batch:]
    [Speculative Executor] → race 3 strategies → winner
       │
       ▼
    [Critic Mesh] → 3 critics vote → verdict
       │
       ▼
    [If pass: apply winner. If fail: rollback, retry.]
       │
       ▼
[Graph Reflector] → record episode, extract insights
       │
       ▼
[Output stream to user]
```

## Backpressure & Cancellation

- Every stream has a bounded queue (default 64)
- Slow consumer backpressures upstream via pull-demand (Reactive Streams spec)
- `AbortController` propagates: user Ctrl-C, budget timeout, critic fatal
  verdict → all in-flight work cancels cleanly
- Replay log (last 1024 events) enables `/rewind` and crash recovery

## Why 7 Primitives?

Each primitive solves a specific problem that v3.0's ReAct loop couldn't:

1. **Stream** → real-time output, easy observability
2. **HTN** → parallel subgoals, hierarchical verification
3. **Speculative** → 3x coverage, "first quality wins"
4. **Critic Mesh** → architectural anti-hallucination
5. **Memory Graph** → causal reasoning, anti-hallucination grounding
6. **Capability** → composable tools, optimization
7. **Actor** → partial failure recovery, "let it crash"

## Comparison to v3.0

| Aspect | v3.0 | v4.0 |
|---|---|---|
| Architecture | ReAct loop | Stream-native actor model |
| Planning | Flat steps | HTN with parallel subgoals |
| Execution | Single attempt | Speculative race (3 strategies) |
| Verification | 1 LLM judge | 3-critic mesh + arbiter |
| Memory | SQLite log | Bi-temporal property graph |
| Tools | RPC | Composable capabilities |
| Fault tolerance | Try/catch | Actor supervision |
| Hallucination defense | Spec validation | Spec + critics + graph grounding |
| Latency | 5-10s | 1.5-3s |

## Performance Budget

| Stage | Target latency | Notes |
|---|---|---|
| Classifier | <50ms (no LLM, pattern match) | Falls through to LLM only on miss |
| HTN Decomposer | <2s (LLM call) | Can be cached per task type |
| Speculative Executor | <5s budget | First quality > 0.7 wins |
| Critic Mesh | <3s (3 parallel LLM calls) | Use haiku-equivalent for 2/3 |
| Graph Reflector | <1s (SQLite write) | Async by default |
| **End-to-end** | **<8s typical, <3s for cached** | vs v3.0 ~10s baseline |

## Module Structure

```
src/engine/v4/
├── stream/                  # Pillar 1
│   ├── cognitive-event.ts   # CognitiveEvent type
│   ├── pipeline.ts          # Source, Transform, Sink, BoundedQueue, tee
│   ├── replay-log.ts        # bounded ring buffer
│   └── index.ts
├── htn/                     # Pillar 2
│   ├── types.ts
│   ├── planner.ts           # HTNPlanner
│   └── index.ts
├── speculative/             # Pillar 3
│   ├── types.ts
│   ├── race.ts              # race(), diversifyStrategy()
│   └── index.ts
├── critic/                  # Pillar 4
│   ├── personas.ts          # PERSONAS
│   ├── mesh.ts              # CriticMesh
│   └── index.ts
├── graph/                   # Pillar 5
│   ├── types.ts
│   ├── store.ts             # InMemoryGraphStore
│   └── index.ts
├── capability/              # Pillar 6
│   ├── types.ts
│   ├── builder.ts           # PipelineBuilder, pipe, execute
│   ├── optimizer.ts         # optimize(), memoize()
│   └── index.ts
├── actor/                   # Pillar 7
│   ├── transport.ts         # Transport
│   ├── actor.ts             # Actor<S>
│   ├── supervisor.ts        # Supervisor
│   └── index.ts
├── engine-v4.ts             # EngineV4 orchestrator
└── index.ts                 # public API
```

## Testing Strategy

- **Unit tests** for each primitive (`test-v4-phase1.ts` through `test-v4-phase4.ts`)
- **Integration tests** end-to-end (`test-v4-e2e-final.ts`)
- **Real LLM** smoke tests with timeout safeguards
- **Mock provider** for fast deterministic tests

Current status: **51/51 E2E tests passing** in <120 seconds.

## Future Work (v4.1+)

- SQLite-backed graph (instead of in-memory)
- Distributed actor model (multi-process)
- Snip projection (non-destructive compact)
- Web UI for the TUI events
- Marketplace for user-authored methods
- LLM-driven capability synthesis (LLM authors new capabilities at runtime)
