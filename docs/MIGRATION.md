# Huagent v4.0 — Migration Guide

> How to migrate from v3.0 (ReAct loop) to v4.0 (Stream-native actor model)

## TL;DR

v3.0 still works. v4.0 is opt-in via `--engine=v4`. Your existing scripts,
config, and code keep working.

## CLI Migration

```bash
# v3.0 (still default, deprecated but working)
huagent "fix auth bug"

# v4.0 (new, opt-in)
huagent "fix auth bug" --engine=v4

# v4.0 with custom config
huagent "fix auth bug" --engine=v4 \
  --provider=openai \
  --model=MiniMax-M3 \
  --quality-threshold=0.7 \
  --speculation-budget-ms=5000
```

## Programmatic Migration

### v3.0 usage

```typescript
import { Engine } from "./src/engine/index.js";

const engine = new Engine({
  provider: myProvider,
  // ... v3.0 config
});

const result = await engine.run("fix auth bug");
```

### v4.0 usage

```typescript
import { EngineV4 } from "./src/engine/v4/index.js";

const engine = new EngineV4({
  provider: myProvider,  // same interface as v3.0
  speculationBudgetMs: 5000,  // new
  qualityThreshold: 0.7,       // new
  // ... v4.0 config
});

const result = await engine.run("fix auth bug");
```

## API Differences

### Method names

| v3.0 | v4.0 | Notes |
|---|---|---|
| `Engine` | `EngineV4` | New class to avoid name clash |
| `engine.run()` | `engine.run()` | Same signature |
| `engine.result.output` | `engine.result.output` | Same |
| `engine.result.events` | `engine.result.events` | Same (now structured as CognitiveEvent) |
| n/a | `engine.getGraph()` | New: access memory graph |
| n/a | `engine.getReplayLog()` | New: time-travel debugging |
| n/a | `engine.stop()` | New: clean shutdown |

### Result structure

**v3.0:**
```typescript
{
  ok: boolean,
  output: string,
  events: EngineEvent[],
  // ... v3.0-specific fields
}
```

**v4.0:**
```typescript
{
  ok: boolean,
  plan: HTNPlan,                        // NEW: full plan visible
  raceResults: Map<string, RaceResult>,  // NEW: per-subgoal race
  verdicts: Map<string, MeshVerdict>,   // NEW: per-subgoal verdict
  output: string,
  totalMs: number,                      // NEW: total wall time
  totalTokens: number,                  // NEW: total tokens used
  episodeId: string,                    // NEW: graph node id
  events: CognitiveEvent[],             // NEW: structured events
}
```

### Events

**v3.0 events:**
- `engine_event` (generic, with type field)
- `token_delta`
- `log`

**v4.0 events (CognitiveEvent discriminated union):**
- 30+ kinds, including:
  - `session_start`, `session_end` (lifecycle)
  - `classified` (intent + complexity)
  - `htn_plan` (full plan summary)
  - `subgoal_started`, `subgoal_completed`
  - `speculation_started`, `speculation_winner`
  - `critic_verdict`, `mesh_verdict`
  - `episode_recorded`, `insight_extracted`
  - `graph_node_added`, `graph_edge_added`
  - `actor_started`, `actor_crashed`, `actor_restarted`
  - `token_delta`, `log`

**Migration:** If you were pattern-matching on event types, you now pattern-
match on `event.kind`. TypeScript narrows automatically.

## Performance Differences

| Metric | v3.0 | v4.0 | Why |
|---|---|---|---|
| Latency (typical task) | 5-10s | 1.5-3s | Speculative race + parallel subgoals |
| Latency (cached task) | n/a | <500ms | Instinct synthesis + graph recall |
| Hallucination rate | Medium | Low | 3-critic mesh + graph grounding |
| Memory cost | O(events) | O(graph) | Graph is compact, bi-temporal |
| Token cost | High | Lower | Cheaper critic models, no retry loops |

## When to Use v3.0 vs v4.0

| Use case | Recommended |
|---|---|
| Quick scripts, one-off tasks | v3.0 (simpler) |
| Production agent, multi-file tasks | v4.0 (faster, safer) |
| Existing v3.0 users | v3.0 (no migration needed) |
| New projects | v4.0 (better defaults) |
| Tasks requiring verification | v4.0 (3-critic mesh) |
| Long-running agents | v4.0 (self-healing) |

## Breaking Changes

**None.** v3.0 is fully supported. v4.0 is purely additive.

## Common Pitfalls

### 1. Forgetting to set speculationBudgetMs

```typescript
// ❌ Will time out quickly
const engine = new EngineV4({ provider });

// ✅ Set budget for your use case
const engine = new EngineV4({
  provider,
  speculationBudgetMs: 5000,  // adjust based on LLM latency
});
```

### 2. Not handling CognitiveEvent properly

```typescript
// ❌ Generic event handling
result.events.forEach((e) => console.log(e));

// ✅ Type-narrowed handling
result.events.forEach((e) => {
  if (e.kind === "speculation_winner") {
    console.log(`Winner: ${e.strategyId} in ${e.durationMs}ms`);
  } else if (e.kind === "mesh_verdict") {
    console.log(`Verdict: ${e.verdict} score=${e.score}`);
  }
});
```

### 3. Ignoring the graph

```typescript
// ❌ Miss out on cross-session memory
const result = await engine.run("task");

// ✅ Use the graph for richer memory
const result = await engine.run("task");
const graph = engine.getGraph();
const similar = await graph.query({ nodeKind: ["episode"], limit: 5 });
```

## Side-by-Side Example

### v3.0:
```typescript
import { Engine } from "./src/engine/index.js";

const engine = new Engine({ provider: myProvider });
const result = await engine.run("add OAuth to my app");
console.log(result.output);

// That's it. No plan visibility, no race, no critic, no graph.
```

### v4.0:
```typescript
import { EngineV4 } from "./src/engine/v4/index.js";

const engine = new EngineV4({
  provider: myProvider,
  speculationBudgetMs: 5000,
  qualityThreshold: 0.7,
  onEvent: (e) => myLogger.info(e),  // real-time observability
});

const result = await engine.run("add OAuth to my app");

// Plan visibility
console.log(`Plan: ${result.plan.subgoals.length} subgoals`);
console.log(`Methods: ${result.plan.methodsUsed.join(", ")}`);

// Race results
for (const [sgId, race] of result.raceResults) {
  console.log(`Race ${sgId}: winner=${race.winner?.strategyName}, candidates=${race.candidates.length}`);
}

// Critic verdicts
for (const [sgId, verdict] of result.verdicts) {
  console.log(`Verdict ${sgId}: ${verdict.verdict} score=${verdict.score.toFixed(2)}`);
}

// Graph access
const graph = engine.getGraph();
const recent = await graph.query({ nodeKind: ["episode"] });
console.log(`Total episodes: ${recent.nodes.length}`);

// Replay log (time-travel)
const replay = engine.getReplayLog();
const cp = replay.checkpoint("after run 1");
```

## Testing Your Migration

Run the E2E tests to verify both engines work:

```bash
# v3.0 tests
npx tsx test-v3-e2e.ts

# v4.0 tests
npx tsx scripts/v4-exploration/test-v4-e2e-final.ts
```

## Need Help?

- [ENGINE_V4.md](ENGINE_V4.md) — User guide
- [ARCHITECTURE.md](ARCHITECTURE.md) — How the 7 primitives fit together
- [BENCHMARK.md](BENCHMARK.md) — v3.0 vs v4.0 vs Claude Code
- [research/v4-primitives/](research/v4-primitives/) — 6,000+ lines of research
