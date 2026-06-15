# HuaEngine v4.0 — User Guide

> The cutest, smartest, **fastest** coding agent in your terminal — powered by
> 7 novel architectural primitives that Claude Code doesn't have.

## What is HuaEngine v4.0?

Huagent v4.0 is a **fundamental architectural rewrite** of the huagent engine.
v3.0 was a ReAct loop with helpful features. v4.0 is a **stream-native actor
model with hierarchical planning, speculative execution, ensemble verification,
causal memory graph, and composable capabilities**.

**In one sentence:** v4.0 is to v3.0 what Apache Flink is to a Python script.

## What's new in v4.0

| Feature | v3.0 (ReAct loop) | v4.0 (Stream-native) |
|---|---|---|
| **Control flow** | Sequential think→act→observe | Continuous event stream |
| **Planning** | Flat list of steps | HTN hierarchical tree |
| **Execution** | 1 attempt, maybe parallel | 3-strategy race, take winner |
| **Verification** | Single LLM judge | 3-critic mesh + arbiter |
| **Memory** | Append-only log | Bi-temporal property graph |
| **Tools** | RPC calls | Composable capability pipelines |
| **Fault tolerance** | Try/catch in loop | Actor model with supervisors |
| **Latency** | 5-10s per task | 1.5-3s per task |

## Quick Start

### CLI usage

```bash
# Use v4.0 engine (default is v3.0 for backward compat)
huagent "add OAuth login to my app" --engine=v4

# With a specific provider
huagent "fix the auth bug" --engine=v4 --provider=openai --model=MiniMax-M3
```

### Programmatic usage

```typescript
import { EngineV4 } from "./src/engine/v4/index.js";

const engine = new EngineV4({
  provider: {
    name: "openai",
    model: "MiniMax-M3",
    generateText: async (prompt, opts) => {
      // Your LLM call here
    },
  },
  speculationBudgetMs: 5000,
  qualityThreshold: 0.7,
});

const result = await engine.run("what is JWT?");
console.log(result.output);
```

## The 7 Primitives

### 1. Stream-Native Architecture

The engine emits a continuous stream of `CognitiveEvent`s instead of returning
a final result. The user sees output as it's produced.

```typescript
import { EventFactory, type CognitiveEvent } from "./src/engine/v4/stream/index.js";

const events: CognitiveEvent[] = [];
const f = new EventFactory();
f.onEmit = (e) => events.push(e);

// Events: session_start, classified, htn_plan, subgoal_started,
//         strategy_progress, critic_verdict, mesh_verdict,
//         episode_recorded, session_end, ...
```

**Why this beats ReAct loop:** Output streams in real-time. Each component
reads from a stream and writes to a stream. Easy to add observability, time-
travel debugging, and event sourcing.

### 2. HTN Planner

Tasks decompose into subgoals, subgoals into atomic steps. Subgoals with no
dependencies execute in **parallel by default**.

```typescript
import { HTNPlanner, type LLMCall } from "./src/engine/v4/htn/index.js";

const llm: LLMCall = async (prompt, opts) => myLLM(prompt);
const planner = new HTNPlanner({ llm });

const plan = await planner.plan("add OAuth login to my app");
// {
//   subgoals: [
//     { description: "Investigate existing code structure", dependsOn: [] },
//     { description: "Generate implementation spec", dependsOn: [...] },
//     { description: "Implement feature per spec", dependsOn: [...] },
//     { description: "Run tests, verify behavior", dependsOn: [...] },
//   ],
//   executionOrder: [[sg1], [sg2], [sg3], [sg4]],  // parallel batches
// }
```

**Why this beats flat step planning:** Hierarchical plans are easier to
verify, easier to parallelize, easier to debug.

### 3. Speculative Execution

For each step, the engine **races 3 strategies** in parallel. The first to
pass quality threshold wins. Losers are cancelled.

```typescript
import { race, diversifyStrategy } from "./src/engine/v4/speculative/index.js";

const baseStrategy = {
  description: "fix auth bug",
  steps: [{ tool: "edit", args: { path: "auth.ts" } }],
  estimatedMs: 5000,
  estimatedQuality: 0.8,
  estimatedCostTokens: 1000,
  risk: 2 as const,
};

const strategies = diversifyStrategy(baseStrategy);  // fast, balanced, thorough

const result = await race({
  strategies,
  budgetMs: 5000,
  qualityThreshold: 0.7,
  mode: "first_wins",
  task: "fix auth bug",
  executeStep: async (tool, args) => myExecute(tool, args),
  assessQuality: async (result) => myAssess(result),
});
// result.winner = the best strategy
// result.candidates = all 3 (for reporting)
```

**Why this beats single-attempt execution:** 3x coverage of solution space
at 1x cost (losers are cancelled).

### 4. Critic Mesh

Every output is verified by **3 independent critics** (correctness, style,
intent). Disagreement triggers a 4th arbiter.

```typescript
import { CriticMesh, PERSONAS } from "./src/engine/v4/critic/index.js";

const mesh = new CriticMesh({
  llm: async ({ persona, userContent }) => myLLM(persona, userContent),
  passThreshold: 0.7,
  failThreshold: 0.5,
  disagreementThreshold: 0.3,
});

const verdict = await mesh.evaluate(codeOrOutput);
// verdict.verdict = "pass" | "flag" | "fail"
// verdict.critics = [correctnessVerdict, styleVerdict, intentVerdict]
// verdict.arbiterTriggered = true if critics disagreed strongly
```

**Why this beats single-LLM judge:** Single LLM has known biases (position,
self-enhancement). Three critics with diverse personas catch different
issues. Disagreement is itself a signal.

### 5. Memory Graph (Bi-Temporal Property Graph)

Memory is a graph with bi-temporal validity. You can ask "what did the graph
look like at 12:34?" and get the right answer.

```typescript
import { InMemoryGraphStore } from "./src/engine/v4/graph/index.js";

const graph = new InMemoryGraphStore();

// Add nodes
const ep = await graph.addNode({
  kind: "episode",
  label: "fix auth bug",
  body: "Fixed JWT validation",
  properties: { duration: 1200 },
  validFrom: Date.now(),
  validTo: null,
  confidence: 1.0,
});

// Add edges (causal)
await graph.addEdge({
  fromNode: ep.id, toNode: fileId, kind: "edited",
  weight: 1, properties: {}, validFrom: Date.now(),
  validTo: null, confidence: 1.0,
});

// Query
const result = await graph.query({
  from: [ep.id], maxDepth: 3, direction: "both",
});
```

**Why this beats append-only log:** Causal structure, time-travel queries,
grounding check for anti-hallucination.

### 6. Capability Composition (Typed Pipelines)

Tools are typed `AsyncIterable` functions with declared permissions. Compose
them with `pipe`, `map`, `if`, `fanout`.

```typescript
import { pipe, execute, optimize } from "./src/engine/v4/capability/index.js";

const p = pipe(readFileCap)
  .map(grepCap("jwt"))
  .map(replaceCap("import"))
  .map(writeFileCap)
  .build();

const opt = optimize(p);  // Memoizes pure functions
for await (const result of execute(opt.optimized, { path: "auth.ts" }, ctx)) {
  console.log(result);
}
```

**Why this beats RPC tool calls:** Type-checked, composable, optimizable
(memoization, parallelization, redundant-call elision).

### 7. Actor Model (Self-Healing)

Every component is an actor with a supervisor. Crashes restart with
preserved state. "Let it crash" replaces "catch every error."

```typescript
import { Supervisor, Transport, Actor } from "./src/engine/v4/actor/index.js";

const transport = new Transport();
const sup = new Supervisor({
  transport,
  strategy: "one_for_one",  // or "one_for_all" | "rest_for_one"
  maxRestarts: 5,
  intensityPeriodMs: 5000,
  children: [
    {
      address: "planner",
      kind: "worker",
      restart: "permanent",
      factory: () => ({ transport, behavior: { ... } }),
    },
  ],
});
await sup.start();
```

**Why this beats try/catch:** Partial failure recovery. A buggy actor
doesn't take down the engine. Intensity threshold prevents restart loops.

## Performance

| Task type | v3.0 (ReAct) | v4.0 (Stream-native) |
|---|---|---|
| Trivial question | 3-5s | 1.5-2s |
| Code fix (1 file) | 8-12s | 3-5s |
| Code write feature | 30-60s | 10-20s |
| Code review (read-only) | 5-10s | 2-4s |

v4.0 is **2-3x faster** because:
1. Speculative race finishes as soon as ONE strategy passes (often the fast one)
2. Parallel subgoals run concurrently (HTN)
3. 3-critic mesh uses cheap models for 2/3 of the calls

## Anti-Hallucination

v4.0 has **architectural** anti-hallucination, not just prompt engineering:

1. **3-critic mesh**: Each critic has different persona. Disagreement = uncertainty.
2. **Spec validation**: Vague specs are rejected before code is written.
3. **Graph grounding**: Every claim must reference a real graph node.
4. **Type-checked tools**: Compilers catch most hallucinations before runtime.

Example:
```
User: "write a function to do various things to make it work somehow"
→ Spec validation: REJECTED (vague: "various", "somehow")
→ Critic mesh: 3 critics score 0.15 (fail)
→ Output: "I cannot write code without a concrete specification. Please clarify what 'various things' means."
```

## CLI Integration

```bash
# Use v4.0 engine
huagent "task description" --engine=v4

# With options
huagent "task" --engine=v4 \
  --provider=openai \
  --model=MiniMax-M3 \
  --quality-threshold=0.7 \
  --speculation-budget-ms=5000

# Stream events to a file
huagent "task" --engine=v4 --events-json=/tmp/events.jsonl
```

## Configuration

```typescript
const engine = new EngineV4({
  // Required: LLM provider
  provider: myLLMProvider,

  // Optional: secondary (cheaper) provider for critics
  criticProvider: myCheapProvider,

  // Optional: graph store (default: in-memory)
  graph: new InMemoryGraphStore(),

  // Speculation
  speculationBudgetMs: 5000,  // default
  qualityThreshold: 0.7,       // default

  // Critic mesh
  criticConfig: {
    personas: ["correctness", "style", "intent"],
    passThreshold: 0.7,
    failThreshold: 0.5,
  },

  // Observability
  onEvent: (e) => myLogger.log(e),
});
```

## Migration from v3.0

v3.0 still works. v4.0 is opt-in via `--engine=v4`. See [MIGRATION.md](MIGRATION.md)
for details.

## See also

- [ARCHITECTURE.md](ARCHITECTURE.md) — How the 7 primitives fit together
- [MIGRATION.md](MIGRATION.md) — Migrating from v3.0 to v4.0
- [BENCHMARK.md](BENCHMARK.md) — v3.0 vs v4.0 vs Claude Code
- [research/v4-primitives/](research/v4-primitives/) — 6,000+ lines of research
