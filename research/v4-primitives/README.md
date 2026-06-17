# HuaEngine v4.0 — Architectural Primitives Research

This directory contains deep research on three architectural primitives that will replace
v3.0's ReAct-style linear stage pipeline. v4.0 will be a fundamental departure from
"think-act-observe in a loop" toward a stream-native, hierarchically-planned, speculatively-executed
runtime.

## Documents

1. **[01-stream.md](./01-stream.md)** — Stream-Native Architecture (replacing ReAct loop)
2. **[01-htn.md](./01-htn.md)** — Hierarchical Task Network (HTN) Planning
3. **[01-speculative.md](./01-speculative.md)** — Speculative Execution (racing strategies)
4. **[02-critic-mesh.md](./02-critic-mesh.md)** — Critic Mesh / Ensemble Verification
5. **[02-capability-composition.md](./02-capability-composition.md)** — Capability Composition
6. **[02-memory-graph.md](./02-memory-graph.md)** — Memory Graph
7. **[03-actor-model.md](./03-actor-model.md)** — Actor Model with Self-Healing (Fault Tolerance Layer)

## Goals

- **Speed**: Target 1.5–3s per task (vs Claude Code's typical 5–15s)
- **Quality**: 3-critic verification (vs single-judge self-check)
- **Architecture**: Stream-native, not loop-based
- **Deployment**: TypeScript / Node.js 22, no heavy external runtime deps

## Constraints

- v3.0 (ReAct loop) already ships at `/root/huagent/src/engine/v3/` — we don't rewrite it
- 15 LLM providers already integrated — we keep them
- Primary model: `MiniMax-M3` via TokenRouter (OpenAI-compatible streaming API)
- Target users: anime-themed game devs, web devs, small-to-medium tasks
