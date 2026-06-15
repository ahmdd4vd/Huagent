# HuaEngine v4.0 — Architecture Design

> **Status:** Design Phase
> **Date:** 2026-06-14
> **Author:** Hermes Agent
> **Codename:** HuaEngine v4.0 "Stream-Native Actor Model"

---

## 0. Executive Summary

HuaEngine v4.0 is a **fundamental architectural rewrite** of the huagent engine.
v3.0 is a ReAct loop with 7 helpful features; v4.0 is **a stream-native actor
model with hierarchical planning, speculative execution, ensemble verification,
causal memory graph, and composable capabilities**.

**The five-second pitch:** v4.0 is to v3.0 what Apache Flink is to a Python
script. The architecture doesn't *add* features — it makes new features *cheap*.

### What changes

| Layer | v3.0 | v4.0 |
|---|---|---|
| Control flow | ReAct loop | Continuous event stream |
| Planning | Flat list of steps | HTN tree (hierarchical) |
| Execution | Sequential + parallel groups | Speculative race (3 strategies) |
| Verification | Single LLM judge | 3-critic mesh with voting |
| Memory | SQLite log + cosine recall | Property graph with causal edges |
| Tools | RPC calls | Composable capability pipelines |
| Fault tolerance | Try/catch | Actor model with supervisors |
| Output | Final reply | Continuous event stream to UI |
| Hallucination defense | Spec validation | Critic mesh + graph grounding |
| Latency target | 5-10s per task | 1.5-3s per task |

### What stays

- v3.0's `Engine` class becomes a **fallback** wrapped in an actor; we don't
  rewrite the LLM plumbing.
- v3.0's identity / coldstart / spec / editor / doomloop / instinct / metrics /
  snapshot modules are reused — they become **operators on the stream**.
- The 15 LLM providers, MCP, and the CLI surface are unchanged.
- v3.0 is exported as `huagent --engine=v3` for backward compat.

---

## 1. Architectural Pillars

### Pillar 1: Stream-Native

The engine is **a stream of `CognitiveEvent`s**, not a loop. Every component
reads from a stream, writes to a stream. The user sees output as soon as it's
produced, not when the loop ends.

```
input$ → classify → decompose → plan(HTN) → speculate → verify(critic mesh) → reflect → output$
```

### Pillar 2: Hierarchical Task Network (HTN)

Tasks are decomposed into **subgoals**, subgoals into **steps**. Subgoals with
no dependencies execute in **parallel by default**. Verification happens at
each level, not just at the end.

### Pillar 3: Speculative Execution

For ambiguous tasks, the engine **races 3 strategies** in parallel (shadow
snapshots). The first to satisfy a quality threshold wins; others are
cancelled. This makes **good enough** fast.

### Pillar 4: Critic Mesh

Every output is verified by **3 independent critics** with different
personas/temperatures. Disagreement triggers a 4th arbiter. This is
architectural hallucination defense, not prompt engineering.

### Pillar 5: Causal Memory Graph

Memory is a **property graph** (SQLite + adjacency) with `valid_from` /
`valid_to` bi-temporal edges. Insights must reference graph nodes; the LLM
cannot "remember" things that aren't in the graph.

### Pillar 6: Composable Capabilities

Tools are typed `AsyncIterable` functions with declared permissions. The LLM
authored DSL `read | grep | replace | write` is compiled and **optimized**
(redundant reads elided, parallel fan-out, sandboxed execution).

### Pillar 7: Self-Healing Actors

Every component is an actor with a supervisor. Crashes restart with
preserved state. "Let it crash" replaces "catch every error."

---

## 2. Data Flow

```
┌────────────────────────────────────────────────────────────────────┐
│                         HUAENGINE v4.0                             │
│                                                                    │
│  User Request                                                      │
│       │                                                            │
│       ▼                                                            │
│  ┌─────────────┐                                                   │
│  │  Input$     │ (AsyncIterable<CognitiveEvent>)                   │
│  └─────────────┘                                                   │
│       │                                                            │
│       ▼                                                            │
│  ┌──────────────────────────────────────────────────┐              │
│  │  STAGE 1: CLASSIFIER                            │              │
│  │  - intent (code_write | code_fix | question)    │              │
│  │  - complexity (trivial | simple | moderate)     │              │
│  │  - shortcuts? (pattern match → bypass stages)   │              │
│  │  Output: ClassifiedEvent                        │              │
│  └──────────────────────────────────────────────────┘              │
│       │                                                            │
│       ▼                                                            │
│  ┌──────────────────────────────────────────────────┐              │
│  │  STAGE 2: HTN DECOMPOSER                        │              │
│  │  - decompose task → subgoals → atomic steps     │              │
│  │  - identify parallel groups                     │              │
│  │  - identify dependencies                        │              │
│  │  Output: HTNPlan { graph, subgoals, steps }     │              │
│  └──────────────────────────────────────────────────┘              │
│       │                                                            │
│       ▼                                                            │
│  ┌──────────────────────────────────────────────────┐              │
│  │  STAGE 3: SPECULATIVE EXECUTOR                  │              │
│  │  - launch 3 strategy variants (shadow snapshot) │              │
│  │  - race with timeout/budget                     │              │
│  │  - first quality > threshold wins               │              │
│  │  - cancel losers, rollback snapshots            │              │
│  │  Output: ExecutionTrace { winner, candidates }  │              │
│  └──────────────────────────────────────────────────┘              │
│       │                                                            │
│       ▼                                                            │
│  ┌──────────────────────────────────────────────────┐              │
│  │  STAGE 4: CRITIC MESH                           │              │
│  │  - fan out to 3 critics (correctness/style/     │              │
│  │    intent personas)                             │              │
│  │  - vote (Borda count, weighted)                 │              │
│  │  - if disagree → 4th arbiter                    │              │
│  │  - factual layer: tsc, vitest, graph lookup     │              │
│  │  Output: MeshVerdict { score, confidence, ... } │              │
│  └──────────────────────────────────────────────────┘              │
│       │                                                            │
│       ▼                                                            │
│  ┌──────────────────────────────────────────────────┐              │
│  │  STAGE 5: GRAPH REFLECTOR                       │              │
│  │  - record episode node + edges (causal)         │              │
│  │  - extract insights (recipe / anti-pattern)    │              │
│  │  - update bi-temporal validity                 │              │
│  │  Output: ReflectedEvent                         │              │
│  └──────────────────────────────────────────────────┘              │
│       │                                                            │
│       ▼                                                            │
│  ┌─────────────┐                                                   │
│  │  Output$    │ (AsyncIterable<CognitiveEvent>)                   │
│  └─────────────┘                                                   │
│       │                                                            │
│       ▼                                                            │
│  User (constant flow, with stages visualized in TUI)              │
└────────────────────────────────────────────────────────────────────┘
```

### Backpressure & Cancellation

- Every stage has a bounded queue (highWaterMark = 64).
- Slow consumer backpressures upstream via pull-demand (Reactive Streams).
- `AbortController` propagates: user Ctrl-C, budget timeout, critic fatal
  verdict → all in-flight work cancels cleanly.
- Replay log (last 1024 events) enables `/rewind` and crash recovery.

---

## 3. CognitiveEvent Type

The wire type. Discriminated union of all events the engine produces.

```typescript
type CognitiveEvent =
  // Lifecycle
  | { kind: 'session_start'; sessionId: string; ts: number }
  | { kind: 'session_end'; sessionId: string; ts: number; ok: boolean }
  // Classification
  | { kind: 'classified'; task: string; intent: Intent; complexity: Complexity; ts: number }
  // HTN
  | { kind: 'htn_plan'; plan: HTNPlan; ts: number }
  | { kind: 'subgoal_started'; id: string; ts: number }
  | { kind: 'subgoal_completed'; id: string; ok: boolean; ts: number }
  // Speculative
  | { kind: 'speculation_started'; strategies: string[]; ts: number }
  | { kind: 'strategy_progress'; id: string; progress: number; ts: number }
  | { kind: 'strategy_succeeded'; id: string; quality: number; ts: number }
  | { kind: 'strategy_cancelled'; id: string; reason: string; ts: number }
  | { kind: 'speculation_winner'; id: string; quality: number; ts: number }
  // Tool execution
  | { kind: 'tool_call'; tool: string; args: unknown; ts: number }
  | { kind: 'tool_result'; tool: string; result: unknown; ts: number }
  | { kind: 'tool_error'; tool: string; error: string; ts: number }
  // Critic mesh
  | { kind: 'critic_verdict'; critic: string; score: number; ts: number }
  | { kind: 'mesh_verdict'; verdict: MeshVerdict; ts: number }
  // Reflection
  | { kind: 'episode_recorded'; id: string; ts: number }
  | { kind: 'insight_extracted'; kind: 'recipe' | 'anti'; text: string; ts: number }
  // Memory
  | { kind: 'graph_node_added'; id: string; kind: string; ts: number }
  | { kind: 'graph_edge_added'; from: string; to: string; kind: string; ts: number }
  // Errors / supervision
  | { kind: 'actor_crashed'; actor: string; reason: string; ts: number }
  | { kind: 'actor_restarted'; actor: string; attempt: number; ts: number }
  // User
  | { kind: 'token_delta'; text: string; ts: number }
  | { kind: 'log'; level: LogLevel; msg: string; ts: number }
  // Capability
  | { kind: 'capability_pipeline'; pipeline: Pipeline; ts: number }
  | { kind: 'capability_optimized'; before: number; after: number; ts: number };
```

Every event has a `ts` so we can build a time-travel UI.

---

## 4. Module Structure

```
src/engine/v4/
├── stream/
│   ├── cognitive-event.ts       # CognitiveEvent union + codecs
│   ├── pipeline.ts              # Pipeline, Transform, Source, Sink
│   ├── subjects.ts              # Subject (multicast) + tee()
│   ├── replay-log.ts            # bounded ring buffer for /rewind
│   └── backpressure.ts          # bounded queue + pull-demand
├── htn/
│   ├── types.ts                 # HTNPlan, Subgoal, Step, Method
│   ├── decomposer.ts            # LLM-driven task → HTN
│   ├── planner.ts               # Pyhop-style algorithm
│   ├── methods/                 # method library (built-in, project, learned)
│   │   ├── built-in.ts
│   │   └── learned-store.ts
│   └── htn-v3-adapter.ts        # fallback: v3.0 flat planner
├── speculative/
│   ├── race.ts                  # race N strategies with budget
│   ├── shadow-snapshot.ts       # per-strategy snapshot for isolation
│   ├── strategy-diversifier.ts  # prompt-diverse strategy generation
│   └── hedging.ts               # first-pass wins, hedge as fallback
├── critic/
│   ├── mesh.ts                  # 3-critic voting
│   ├── personas.ts              # correctness/style/intent personas
│   ├── aggregator.ts            # Borda count, weighted voting
│   ├── arbiter.ts               # 4th critic on disagreement
│   ├── factual-layer.ts         # tsc, vitest, graph lookup
│   └── critic-v3-adapter.ts     # fallback: v3.0 single critic
├── graph/
│   ├── schema.ts                # Node, Edge types (bi-temporal)
│   ├── store.ts                 # SQLite + adjacency tables
│   ├── fts.ts                   # FTS5 full-text search
│   ├── cypher-lite.ts           # 12 safe query templates
│   ├── extractor.ts             # LLM-driven node/edge extraction
│   └── memory-v3-adapter.ts     # fallback: v3.0 MemoryManager
├── capability/
│   ├── types.ts                 # Capability<TIn, TOut, TPerm>
│   ├── pipeline-dsl.ts          # |, &, ?:, !, <$> operators
│   ├── validator.ts             # type-check every edge
│   ├── optimizer.ts             # elide redundant, parallelize
│   ├── library.ts               # pre-defined pipelines
│   └── capability-tool-adapter.ts # v3.0 ToolRegistry compat
├── actor/
│   ├── actor.ts                 # gen_server-style base class
│   ├── transport.ts             # bounded mailbox + addressing
│   ├── supervisor.ts            # supervision tree + restart strategy
│   ├── state-snapshot.ts        # three-tier (cold/warm/hot)
│   ├── crash-recovery.ts        # 6-step recovery protocol
│   └── actors/                  # concrete actors
│       ├── planner-actor.ts
│       ├── executor-actor.ts
│       ├── critic-actor.ts
│       ├── reflector-actor.ts
│       └── identity-actor.ts
├── core.ts                      # EngineV4 orchestrator
├── engine-v4.ts                 # public Engine class
├── tui-bridge.ts                # v3 EngineEvent adapter for TUI
└── README.md
```

---

## 5. Public API

```typescript
import { EngineV4 } from './engine/v4/engine-v4.js';

const engine = new EngineV4({
  // providers
  providers: { openai: { apiKey: process.env.OPENAI_API_KEY } },

  // v4.0 tuning
  v4: {
    enableSpeculation: true,
    strategies: 3,
    speculationBudgetMs: 5000,
    enableCriticMesh: true,
    critics: ['correctness', 'style', 'intent'],
    enableHTN: true,
    maxDecompositionDepth: 4,
    enableGraph: true,
    graphPath: '~/.huagent/graph.db',
    enableActorSupervision: true,
  },

  // optional v3.0 fallback
  fallbackToV3: true,
});

// Stream events to UI / log
engine.output$.subscribe(event => ui.push(event));

// Run a task
const result = await engine.run('add OAuth login to my app');
//   ├─ output$ emits events in real time
//   ├─ result is final CognitiveEvent
//   └─ engine state preserved for follow-ups
```

---

## 6. Migration Path

v3.0 and v4.0 coexist. The CLI gets a new flag:

```bash
huagent "fix auth bug" --engine=v3   # legacy, default
huagent "fix auth bug" --engine=v4   # new
```

The TUI subscribes to a single `EngineEvent` interface that v4.0's
`tui-bridge.ts` produces via the cognitive-event stream. No UI rewrite.

`Engine.run()` returns the same `EngineResult` shape. Adapters wrap v3.0
modules so the v4.0 path can be **partially adopted** (e.g., use v4.0
critic mesh with v3.0's flat planner).

---

## 7. Performance Budget

| Stage | Target latency | Notes |
|---|---|---|
| Classifier | <50ms (no LLM, pattern match) | Falls through to LLM only on miss |
| HTN Decomposer | <2s (LLM call) | Can be cached per task type |
| Speculative Executor | <5s budget | First quality > 0.7 wins |
| Critic Mesh | <3s (3 parallel LLM calls) | Use haiku-equivalent for 2/3 |
| Graph Reflector | <1s (SQLite write) | Async by default |
| **End-to-end total** | **<8s typical, <3s for cached patterns** | vs v3.0 ~10s baseline |

---

## 8. Risk Register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Stream API confusion in Node 22 | Medium | Low | Use WHATWG Streams (Node-native, no dep) |
| LLM hang in speculative race | Medium | High | Strict timeout + watchdog actor |
| Graph DB corruption | Low | High | WAL + bi-temporal validity, never delete, only supersede |
| Actor restart loop (thundering herd) | Medium | High | OTP-style intensity threshold (max N restarts / 5s) |
| Critic mesh cost explosion | Medium | Medium | Use 2× haiku + 1× sonnet default, never 3× opus |
| HTN decomposition infinite recursion | Low | Medium | Depth limit (default 4) + visited set |
| Capability sandbox escape | Low | High | Pure-JS sandbox; no `eval`; deny-by-default permissions |
| Backward compat break for v3.0 users | Medium | Medium | v3.0 default; `--engine=v4` opt-in; v3 adapters in v4 |

---

## 9. Testing Strategy

### Unit tests
- Stream: backpressure, cancellation, replay log
- HTN: decomposition, parallel subgoals, dependency resolution
- Speculative: race winner, budget timeout, shadow isolation
- Critic: vote aggregation, disagreement arbiter, factual layer
- Graph: CRUD, causal query, bi-temporal validity
- Capability: pipeline compilation, type checking, optimization
- Actor: state preservation, crash recovery, supervisor restart

### Integration tests
- End-to-end: 5 multi-step tasks, assert event sequence
- Adversarial: vague specs, infinite loops, hallucinated imports
- Performance: 50-task benchmark vs v3.0

### Complex E2E (final gate)
- **Task A:** "Refactor auth.ts to use JWT" — multi-file, multi-step, with rollback
- **Task B:** "Fix all TypeScript errors in /src" — large, parallel
- **Task C:** "Add OAuth with tests" — speculation must converge
- **Task D:** "Investigate why /login returns 500" — needs causal graph recall
- **Task E:** "Write a one-shot CLI tool" — pure code_write, no LLM judge needed

All five must PASS with quality score > 0.8 from critic mesh.

---

## 10. Out of Scope (v4.0)

- Multi-user collaboration
- Web UI (CLI + TUI only)
- Persistent session sync across machines
- Marketplace for user-authored methods / capabilities
- Distributed actor model (single-process only)

These are v4.1+ or v5.0 work.

---

## 11. Open Questions (from research)

Carried over from `research/v4-primitives/`:

1. **Stream serialization:** immutable events vs ref-counted snapshots → **decided: immutable + structural sharing**
2. **Abort signal origin:** Ctrl-C / budget / critic → **decided: AbortController, all three can call .abort()**
3. **Large `tool_result` payloads:** 1MB file events → **decided: 256KB cap + blob channel for overflow**
4. **Reactive Streams full semantics:** → **decided: highWaterMark is enough**
5. **Operator failure semantics:** → **decided: emit `step_failed` event, let planner re-route; actor restart for known-bad operators**
6. **TypeScript: provider types vs ours:** → **decided: TransformStream adapter**
7. **Performance budget per operator:** → **decided: <50µs framework overhead, will measure**
8. **Backward compat with v3.0 `EngineEvent`:** → **decided: tui-bridge.ts adapter**
9. **HTN: how to ground LLM decomposition:** → **decided: validation pass against method library**
10. **Speculation diversity:** → **decided: 3 prompt-diverse strategies (cheap/moderate/expensive)**
11. **Critic mesh 4th arbiter trigger threshold:** → **decided: if any pair disagrees by >0.3**
12. **Graph grounding check:** → **decided: every insight must reference node ID, else rejected**
13. **Capability sandboxing:** → **decided: pure-JS, no eval, deny-by-default permissions**
14. **Actor supervision granularity:** → **decided: per-component actor (planner, executor, critic, reflector, identity)**
15. **Snapshot granularity for actor state:** → **decided: three-tier (cold/warm/hot) per state-snapshot.ts**

All open questions resolved in this design. Implementation begins next.

---

## 12. Implementation Phases (mapped to todos)

| Phase | Module(s) | Deliverable | Test |
|---|---|---|---|
| 0 | research/ | 7 primitive docs | n/a |
| 1 | stream/, htn/ | Pipeline + HTN | unit + integration |
| 2 | speculative/, critic/ | Race + Mesh | unit + integration |
| 3 | graph/, capability/ | Graph + DSL | unit + integration |
| 4 | actor/ | Self-healing | unit + integration |
| 5 | core.ts, engine-v4.ts | Full orchestrator | complex E2E |
| 6 | docs | ENGINE_V4.md etc. | n/a |

---

## 13. Success Criteria

v4.0 is **done** when:
- [ ] All 7 modules compile, lint clean, tests pass
- [ ] Complex E2E (5 tasks) all pass with score > 0.8
- [ ] 50-task benchmark: median latency < 3s (vs v3.0 8s)
- [ ] 50-task benchmark: critic mesh catches > 90% of v3.0's failures
- [ ] No regression on v3.0 tests
- [ ] `huagent --engine=v3` still works
- [ ] Documentation complete

---

*End of design. Implementation begins.*
