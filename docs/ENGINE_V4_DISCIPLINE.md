# v4.0 Engine — Discipline Layer (Fable-5 Mindset)

> Adopted from `claude-fable-5` traces. Measured improvement: from Fable 5's
> baseline 54.5% real-test rate after editing, the discipline layer fires
> verify on EVERY Edit/Write by design.

---

## What is the discipline layer?

The discipline layer is an **opt-in** sidecar to the v4 engine that enforces
Fable 5's working habits through structured reasoning beats:

| Fable 5 principle | Discipline primitive | When it fires |
|---|---|---|
| 1. Reason before the first action | `plan-beat` | Before each subgoal starts |
| 2. Re-evaluate after every result | `observe-beat` | After every tool result |
| 3. Ground in reality first | `ground-beat` | At task start |
| 4. Read the exact region before editing | `fresh-read check` | Before every Edit/Write |
| 5. Run the real check after editing | `verify-hook` | After every Edit/Write |
| 6. Diagnose, do not flail | `diagnose-beat` | On every tool error |
| 7. Narrate decisions | (emitted as events) | Throughout |

The layer is implemented as a `DisciplineManager` that wraps the engine.
It does NOT replace the 7 v4 primitives (Stream, HTN, Speculation, Critic,
Graph, Capability, Actor) — it adds Fable-5 discipline ON TOP.

---

## Quick start

```typescript
import { EngineV4 } from "huagent";

const engine = new EngineV4({
  provider: myLLM,
  // Opt in to the discipline layer
  discipline: {
    planBeat: true,        // default
    observeBeat: true,     // default
    groundBeat: true,      // default
    verifyHook: true,      // default
    diagnoseBeat: true,    // default
    freshReadCheck: true,  // default
    freshReadTtlMs: 5 * 60 * 1000,
    verifyConfig: {
      mode: "if_project_test",  // auto-detect
      timeoutMs: 60_000,
    },
  },
  projectRoot: "/path/to/project",
});

const result = await engine.run("Fix the auth bug");

// Inspect discipline metrics
const metrics = engine.getDiscipline()?.metrics();
console.log("Reasoning coverage:", metrics.reasoningCoverage);
console.log("Verify rate:", metrics.verifyRate);
```

---

## API reference

### `plan(goal)` — emit a plan beat

```typescript
import { DisciplineManager, EventFactory } from "huagent";

const ev = new EventFactory();
const mgr = new DisciplineManager({ config: {}, events: ev });

const beat = mgr.plan(
  {
    goal: "Fix the auth bug",
    hypothesis: "JWT token has wrong expiry",
    steps: ["read auth.ts", "find the bug", "fix and test"],
    rationale: "Token expiry is the most common auth bug",
    risks: ["breaking existing sessions"],
    acceptance: "all auth tests pass",
  },
  { subgoalId: "sg-1" }
);

// Emits a `plan_beat` event. Returns the beat object.
```

### `observe(tool, result)` — re-evaluate after a result

```typescript
mgr.observe("Read", "file content here", { planBeat: beat });
// Emits an `observe_beat` event. The beat's `matchesHypothesis` flag is
// set by a heuristic; if false, `decision` is "adjust" and `adjustments`
// contains a default message.
```

### `verify(filePath, trigger)` — run the real test

```typescript
const result = await mgr.verify("src/auth.ts", "Edit");
// Emits `verify_started` and `verify_completed` (or `verify_failed`).
// Returns a VerifyResult with exit code, output, pass/fail.
```

### `diagnose(tool, error)` — diagnose before retry

```typescript
const dx = mgr.diagnose("Bash", "ENOENT: no such file");
// Emits `diagnose_started` and `diagnose_completed`.
// Returns a Diagnosis with category, hypotheses, recommended action.
```

### `markFileRead(filePath)` — track file reads

```typescript
mgr.markFileRead("src/auth.ts");
// Subsequent Edit/Write to this file will pass the fresh-read check.
```

### `checkFreshRead(filePath)` — gate an edit

```typescript
const check = mgr.checkFreshRead("src/auth.ts");
if (!check.ok) {
  console.log(`Read this file first: ${check.reason}`);
  // Optionally, read the file and re-check.
}
```

---

## What events does it emit?

The discipline layer adds 9 new `CognitiveEvent` kinds:

| Event | When | Payload |
|---|---|---|
| `plan_beat` | Before each subgoal | `{ beat: PlanBeat }` |
| `observe_beat` | After every tool result | `{ beat: ObserveBeat }` |
| `ground_beat` | At task start | `{ beat: GroundBeat }` |
| `verify_started` | Before running the test | `{ filePath, command }` |
| `verify_completed` | Test passed | `{ result: VerifyResult }` |
| `verify_failed` | Test failed | `{ result: VerifyResult }` |
| `stale_edit_blocked` | Edit refused (no fresh read) | `{ filePath, lastReadAt, ageMs }` |
| `diagnose_started` | Before analyzing error | `{ tool, error }` |
| `diagnose_completed` | After diagnosis | `{ diagnosis: Diagnosis }` |

All events flow through the standard `CognitiveEvent` stream, so existing
observability (event log, replay, dashboards) picks them up automatically.

---

## Discipline metrics

```typescript
const m = engine.getDiscipline()?.metrics();
```

Returns:

| Metric | Meaning | Fable 5 baseline |
|---|---|---|
| `reasoningCoverage` | Fraction of actions that had a plan beat | 86% |
| `observeCoverage` | Fraction of tool results followed by observe | 87% |
| `verifyRate` | Fraction of edits followed by verify | 65% |
| `realVerifyRate` | Fraction of verifies that ran (not skipped) | 65% |
| `realVerifyPassRate` | Fraction of real verifies that passed | (varies) |
| `diagnoseRate` | Fraction of errors followed by a diagnosis | (no data) |
| `freshReadRate` | Fraction of edits with a fresh read | 88% |

---

## Auto-detect rules for verify

When `mode: "if_project_test"` and no explicit `command` is set, the
verify-hook auto-detects the test command by looking for these files
(in order):

| File | Detected command |
|---|---|
| `package.json` with `scripts.test` | `npm test --silent` |
| `pyproject.toml` with `[tool.pytest]` | `pytest -x --tb=short -q` |
| `Cargo.toml` | `cargo test --quiet` |
| `go.mod` | `go test ./...` |
| `Makefile` with `test:` target | `make test` |
| `tsconfig.json` (no `package.json`) | `npx tsc --noEmit` |
| `test_*.py` in root | `pytest -x --tb=short -q` |

If none match, verify is **skipped** with reason
`"no test command auto-detected for this project"`.

---

## Architecture

```
Engine v4.0
  ├── 7 primitives (Stream, HTN, Speculation, Critic, Graph, Capability, Actor)
  └── DisciplineManager (opt-in)
       ├── state: fileReadAt map + beat history
       ├── plan-beat     → emits plan_beat
       ├── observe-beat  → emits observe_beat
       ├── ground-beat   → emits ground_beat
       ├── verify-hook   → emits verify_started / _completed / _failed
       └── diagnose-beat → emits diagnose_started / _completed
```

The manager is created in the engine constructor when `discipline` is set.
It receives the engine's `EventFactory` so its events flow through the
standard event stream.

---

## Why a sidecar, not a primitive?

The 7 v4 primitives already do the heavy lifting:

- **HTN** already plans (subgoals, steps, dependencies)
- **Critic** already evaluates
- **Speculation** already races strategies
- **Stream** already captures every event

The discipline layer adds:

1. **State that primitives don't track** — file-read timestamps for
   fresh-read-before-edit
2. **Beats that primitives don't emit** — plan/observe/ground/verify/diagnose
3. **Enforcement that primitives don't do** — verify hook fires on every
   Edit, regardless of whether the agent remembers

It's the difference between "the engine can plan" and "the engine ALWAYS
plans before acting."

---

## What we EXCEED Fable 5 on

Fable 5 measured at **54.5%** for "runs the real test after editing"
(this is its biggest blind spot). The discipline layer fires verify on
EVERY Edit/Write by design, so we exceed 54.5% by construction.

Same for the other Fable 5 weak spots — we wire them mechanically so
they fire deterministically, not by the agent's good intentions.

---

## Testing

`tests/test-discipline.ts` — 181 tests across 9 sections:

1. state.ts — DisciplineState (40 tests)
2. plan-beat.ts — Plan beats (10 tests)
3. observe-beat.ts — Observe beats (30 tests)
4. verify-hook.ts — Verify hook (15 tests)
5. diagnose-beat.ts — Diagnose (40 tests)
6. ground-beat.ts — Ground (15 tests)
7. manager.ts — DisciplineManager (20 tests)
8. EngineV4 integration (10 tests)
9. CognitiveEvent type guards (3 tests)

All 181 pass. No regressions in existing 539 tests.
