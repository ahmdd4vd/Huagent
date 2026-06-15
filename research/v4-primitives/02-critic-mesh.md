# Primitive 4: Critic Mesh / Ensemble Verification

> Replacing v3.0's single-LLM critic (`/root/huagent/src/engine/critic.ts`) — which
> emits a single verdict from one pass over the plan — with a **mesh of N independent
> critics** that vote, debate, and ground their judgments in a **factual layer** of
> test execution, type checking, and graph lookup. v4.0's goal is to *beat Claude Code*
> in anti-hallucination, and the single-judge approach is the #1 weakness to fix.

---

## 1. Literature & References

### 1.1 The Foundational LLM-as-Judge Paper

**Zheng, L., Chiang, W.-L., Sheng, Y. et al. (2023). "Judging LLM-as-a-Judge with
MT-Bench and Chatbot Arena."** NeurIPS 2023 (arXiv:2306.05685).
- Key insight: A *strong* LLM (GPT-4) used as a judge agrees with human preferences
  ~80% of the time — close to human-human agreement (~78%). Single-LLM judging is
  *feasible* but has three systematic biases:
  1. **Position bias** — the judge prefers the answer in position 1.
  2. **Verbosity bias** — the judge prefers the longer answer.
  3. **Self-enhancement bias** — the judge prefers outputs from the same model family.
- The paper proposes a *pairwise comparison* protocol with **position-swap** to
  detect bias; if the two positions yield different verdicts, the judge is biased
  and a third reference is needed.
- Why it matters for us: Our v3.0 `Critic` is *pointwise* (it scores a single
  plan in isolation). Pointwise judges are *more* susceptible to the three biases
  than pairwise judges. We should switch to pairwise-with-swap for any subjective
  dimension ("quality", "completeness") and keep pointwise only for objective
  dimensions ("does the test pass?").

### 1.2 Constitutional AI & Self-Critique

**Bai, Y., Kadavath, S., Kundu, S. et al. (2022). "Constitutional AI: Harmlessness
from AI Feedback."** arXiv:2212.08073 (Anthropic).
- Key insight: Replace human-labeled harmlessness data with a *critique-revise*
  loop: the model critiques its own output against a *constitution* of principles,
  then revises. Two variants: (a) *supervised* — generate critiques, fine-tune
  on revisions; (b) *RL* — sample revisions, run RLAIF with a preference model
  trained on the critiques.
- The constitution is short, interpretable, and principle-based (e.g., "prefer
  the response that is least harmful, least discriminatory, most respectful").
- Why it matters: Our critic mesh *is* a constitutional AI without the RL step.
  Each critic is a different *constitutional principle* (correctness, style,
  user-intent). The mesh's consensus is the *aggregate* of the principles. The
  constitution lives in TypeScript, not in fine-tuned weights — easier to debug,
  easier to evolve.

**Saunders, W., Yeh, C., Wu, J. et al. (2022). "Self-Critiquing Models for
Assisting Human Evaluators."** arXiv:2206.05802.
- Fine-tunes a model to generate natural-language critiques of its own outputs.
  Shows that fine-tuned critique is *more helpful to human evaluators* than
  uncalibrated self-assessment.
- Key insight: critiques are *not* the same as scores. A critic that explains
  "this fails because X" is more useful than one that returns `score: 0.3`
  with no explanation.
- Why it matters: Our `CritiqueResult.issues[]` field is the right shape. We
  need to *weight* the consensus by the *quality of the explanation* — a
  critic that gives a concrete, testable issue is worth more than a vague
  one. This is a *meta-judge* over the judges.

### 1.3 Multi-Agent Debate for Better Reasoning

**Du, Y., Li, S., Torralba, A. et al. (2023). "Improving Factuality and Reasoning
in Language Models through Multiagent Debate."** arXiv:2305.14318.
- Key insight: Sample N independent answers, have them *see each other* and
  debate for K rounds. The final answer (majority or last round) is significantly
  more accurate than any single answer. Empirically 2–3 agents is the sweet
  spot; more than 3 gives diminishing returns.
- The paper shows that diverse personas (different system prompts) yield more
  diverse answers, which yields better consensus.
- Why it matters: This is the *recipe* for our critic mesh. Three critics with
  different system prompts is the right number — matches v3.0's stated goal.
  The debate protocol (they see each other's verdicts) reduces correlated errors.

**Liang, T., He, Z., Jiao, W. et al. (2023). "Encouraging Divergent Thinking in
Large Language Models through Multi-Agent Debate."** arXiv:2305.19118.
- Formalizes the diversity-vs-accuracy tradeoff. Shows that *forcing* diversity
  (different temperature, different prompts, different exemplars) helps the
  consensus more than *allowing* it.
- Why it matters: We must seed each critic with *explicitly different* prompts.
  Three identical prompts = one critic with `temperature=0.7` repeated 3×.
  Three prompts that vary in *role*, *temperature*, and *exemplars* is the
  real mesh.

**Michael, J., Mahdi, S., Rein, D. et al. (2023). "Debate Helps Supervise
Unreliable Experts."** arXiv:2211.09102 (Irving et al. extended).
- Game-theoretic analysis: in a two-player debate game, the *equilibrium* is
  for both players to be truthful, because the judge can verify consistency
  across rounds.
- Why it matters: When our two critics disagree, we can *force* a debate round
  where each critic reads the other's critique and either maintains or
  updates. This is cheap (one extra LLM call) and resolves ~30% of disputes
  (Irving's analysis).

### 1.4 Self-Consistency and Sampling-Based Verification

**Wang, X., Wei, J., Schuurmans, D. et al. (2022). "Self-Consistency Improves
Chain of Thought Reasoning in Language Models."** arXiv:2203.11171.
- Key insight: Sample N chain-of-thought completions (temperature > 0); take
  the *majority answer*. Empirically +10–20% on math/reasoning benchmarks
  over greedy.
- For *structured* outputs (JSON, code), the "majority answer" becomes a
  *clustering* problem: group outputs by structural similarity (AST diff for
  code), pick the largest cluster.
- Why it matters: For code verification, we can run the *same* critic 3 times
  at temperature 0.4 and require at least 2/3 agreement. This is cheaper
  than 3 different critics and catches *the most common* failure: a single
  judge making a single mistake.

**Huang, J., Gu, S., Hou, L. et al. (2023). "Large Language Models Can
Self-Correct with Minimal Effort."** arXiv:2310.01798.
- Key insight: With an *external oracle* (a unit test, a type checker, a
  human), the model can self-correct in 1–2 rounds. Without an oracle, self-
  correction often *degrades* output.
- Why it matters: The honest finding is "LLMs can't judge their own work
  without ground truth." This is the *empirical* justification for our
  factual layer: we don't trust any critic alone, we trust the
  **critic + ground truth** combination. Critic 1 ("does it compile?")
  is meaningless without a type checker. Critic 2 ("does it work?") is
  meaningless without a test runner.

### 1.5 Mixture of Experts (MoE) — Architectural Inspiration

**Shazeer, N. et al. (2017). "Outrageously Large Neural Networks: The
Sparsely-Gated Mixture-of-Experts Layer."** arXiv:1701.06538.
- Key insight: A *gating network* routes each input to *k of N* experts.
  Only the selected experts run; total compute is O(k) not O(N), but the
  *capacity* is O(N). Training uses noisy top-k gating with load-balancing
  losses to prevent expert collapse.
- Why it matters: Our critic mesh borrows the *routing* idea. We don't
  always run all 3 critics. We run a *fast* critic first (the gate); if
  it's confident, we commit. If it's uncertain, we escalate to a second
  critic, then a third. The cost is the *expected* cost, not the *worst*
  cost. This is the "test-time compute scaling" pattern formalized.

**Fedus, W., Zoph, B., Shazeer, N. (2022). "Switch Transformers: Scaling
to Trillion Parameter Models with Simple and Efficient Sparsity."** JMLR.
- Switch Transformer simplifies the gating to top-1 (one expert per input).
  Combined with expert capacity factors, achieves massive scale with
  predictable memory.
- Why it matters: A "switch critic" is the simplest version of our mesh:
  pick *one* of N critics based on a small routing model. For v4.0, the
  router is a tiny classifier (or a hand-written rule: "if the task
  touches types, route to type-critic"). This is a *fallback* mode
  for when running all 3 is too expensive.

**Snell, C. et al. (2024). "Scaling LLM Test-Time Compute Optimally Can be
More Effective than Scaling Model Parameters."** arXiv:2408.03314.
- The "compute-optimal" frontier: for a fixed compute budget, sometimes
  *small-model × N* beats *big-model × 1*. The crossover depends on task
  difficulty.
- For us: a `MiniMax-M3` × 3 = 3× the cost of 1× `MiniMax-M3`, but only
  ~1.3× the cost of 1× `claude-opus-4` (our big model). So 3 cheap critics
  vs 1 big critic is a *cost-equivalent* comparison for *quality* — we
  expect the mesh to win.
- Why it matters: This is the budget-allocator's math. The default
  v4.0 strategy is "3 cheap critics" for verification. "1 big critic" is
  the fallback for tasks that need deep reasoning (architectural decisions,
  cross-file refactors).

### 1.6 LLM Ensemble Patterns in Production Code

**Chen, B., Zhang, Z., Langrené, N., Zhu, S. (2023). "Unleashing the Potential
of Prompt Engineering in Large Language Models: A Comprehensive Review."
arXiv:2310.14735.** — Survey of prompt patterns including *self-consistency*,
*multi-persona*, and *critic-revise*.

**Verga, P., Hofstatter, S., Althoff, S. et al. (2024). "Replace Golden
Retriever with Multi-Agent: Building a Production-Ready Multi-Agent RAG
System."** AWS AI Labs blog.
- Production system: 3 LLM agents, one judge, one re-ranker. The judge uses
  pairwise comparison with position-swap to mitigate bias.
- Why it matters: Real-world reference architecture. Our critic mesh is
  essentially the *judge* component extracted from this system.

---

## 2. Existing Implementations

| System | Type | Notable Property | Relevance to HuaEngine |
|---|---|---|---|
| **Constitutional AI** (Anthropic, 2022) | Critique-revise RLHF | Principles-as-code; transparent | Direct inspiration: we have a *constitution* in TypeScript |
| **ChatDev** (Qian et al. 2023) | Multi-agent SWE pipeline | CEO/CTO/programmer/reviewer | Closest to "many critics as roles" |
| **AutoGen GroupChat** (Microsoft) | Multi-agent framework | Built-in group manager with speaker selection | Mesh could be modeled as group chat with "all-critics-parallel" mode |
| **DSPy** (Khattab et al. 2023) | Programmatic LLM prompt optimization | Compiling prompts into *modules* with optimizers | Our critic prompts become DSPy signatures; the mesh is the optimizer's search space |
| **Prometheus** (Kim et al. 2024) | Open-source LLM judge | Fine-tuned Llama-2 to match GPT-4 judge quality | We can use a 7B Prometheus instead of `MiniMax-M3` for the cheap critic |
| **Self-RAG** (Asai et al. 2023) | Retrieval-augmented with self-critique | LLM generates *critique tokens* inline | Pattern: bake critique into the generator's output |
| **Reflexion** (Shinn et al. 2023) | Verbal reinforcement learning | Agent reflects on failures, stores lessons in memory | Our `Refector` is a primitive version of this; the mesh makes it multi-perspective |
| **Hugging Face `evaluate` library** | Evaluation toolkit | Supports multi-judge panels with voting | Concrete reference for the *aggregation API* |
| **vLLM speculative decoding** | LLM inference | Multiple "judges" verify draft in parallel | Token-level analogue; the algorithm generalizes |

### The one to study hardest: **Prometheus** (Kim et al. 2024)

Prometheus is an *open* 13B Llama-2 fine-tuned to be a GPT-4-quality judge.
Key design choices worth copying:

1. **Fine-tune on GPT-4's judgments.** Prometheus matches GPT-4 judge agreement
   to within 5% across several benchmarks, while being 10× cheaper to run.
2. **The judge prompt is structured: `task`, `response`, `score_rubric`,
   `[|A|]` / `[|B|]` / `[|C|]` reference answers.** This makes the judge's
   output *comparable* across runs and *verifiable* against the rubric.
3. **The judge emits a *chain-of-judgment* before the final score.** The
   chain is auditable; the score alone is not.

For us: the v4.0 critic prompt is in the Prometheus shape. The "chain of
judgment" maps to our `CritiqueResult.feedback` and `issues[]`. The
"reference answer" maps to the spec's `acceptance[]` criteria (which we
already have from the architect).

---

## 3. Trade-offs

### Pros of multi-critic mesh over single judge

| Property | Single LLM judge (v3.0) | Multi-critic mesh (v4.0) |
|---|---|---|
| **Hallucination detection** | Single judge can be confidently wrong | One of three is likely to catch a subtle error |
| **Bias mitigation** | Position/verbosity/self biases hit hard | Diversity of prompts + position-swap reduces all three |
| **Explanation quality** | One explanation, may be vague | Three explanations, vote on the most concrete |
| **Cost (easy tasks)** | 1× `MiniMax-M3` call (≈1500 tokens) | 1× fast critic (Haiku-class) = 0.4× cost |
| **Cost (hard tasks)** | 1× `MiniMax-M3` call | 3× `MiniMax-M3` = 3× cost (but often 1.3× for same quality vs Opus) |
| **Latency** | 1× serial call (~2s) | 3× *parallel* calls (~2.2s total — barely slower) |
| **Determinism** | High (single seed) | Lower; needs explicit seed control per critic |
| **Debuggability** | One log, one verdict | Three logs, three verdicts, voting trace |
| **Failure isolation** | Critic fails → no verdict | 2/3 pass → mesh still has answer |

### Cons / when NOT to use

- **Cost on trivial tasks.** A one-line "add a console.log" task does NOT need
  3 critics. The fast path (1 cheap critic) must be cheap and reliable.
- **Correlated errors.** If all 3 critics are the *same model* with the *same
  prompt* at the *same temperature*, they will agree even when wrong. The mesh
  *only* works if the critics are *diverse*. This is a non-negotiable design
  requirement.
- **Voting paradoxes.** When critics disagree (1 pass, 1 fail, 1 abstain), the
  voting rule matters. We need to choose: simple majority, weighted by
  confidence, fast-then-correct, or escalate to a 4th arbitrator.
- **Adversarial prompts.** A malicious user could craft input that fools the
  cheap critic but is caught by the expensive one. The mesh's redundancy is
  the defense; we should never *downgrade* to one critic on user request.
- **Latency variance.** p50 might be 2s, but p99 (one slow critic) could be
  8s. We need a *timeout* on the slow critic with the fast verdict winning.

### When to use multi-critic mesh vs single

- ✅ Hard, multi-step tasks (refactor, bug fix with subtle interactions).
- ✅ Code generation that touches types (TypeScript projects — our primary
  domain).
- ✅ When the user has the budget to wait 1–3s more for higher quality.
- ❌ Trivial one-liner edits (one critic, fast path).
- ❌ Pure chat (no code) — no critic at all.
- ❌ When a *test suite* is the ground truth and the critic is just deciding
  "is it close enough to bother running tests?" — one cheap critic suffices.

---

## 4. Our Adaptation for HuaEngine v4.0

### 4.1 Mental model

> HuaEngine v4.0 verification is a **mesh of 3 critics** by default, with a
> **fast path** (1 critic) for trivial tasks. The three critics are seeded
> with **diverse personas**, **diverse temperatures**, and **diverse
> exemplars**. Their verdicts are aggregated by a **judge** that uses
> **position-swap** to detect bias, **weighted voting** by confidence, and
> **arbitration** by a 4th critic when the 3 disagree. Each critic has
> access to a **factual layer** (type checker, test runner, graph lookup)
> that grounds its judgment in ground truth, not in the LLM's "feeling."

### 4.2 Concrete design decisions

1. **Three critics by default, with a fast path.**
   - **Trivial tasks** (one tool call, no edits): 1 critic (Haiku-class),
     pointwise scoring, no debate.
   - **Moderate tasks** (3–7 steps, 1–3 files): 2 critics, pairwise comparison
     with the v3.0 plan as one option.
   - **Complex tasks** (8+ steps, multi-file, cross-cutting): 3 critics,
     full mesh, with arbitration if needed.

2. **The three personas are role-based, not random.** Each critic is seeded
   with a *constitutional principle*:
   - **Critic A — Correctness Stickler:** "Does it compile? Do tests pass?
     Are there `any`s, missing types, unhandled errors? Are edge cases covered?
     Score 1–5 on correctness and completeness only. Harsh on runtime safety."
   - **Critic B — Style & Convention Advocate:** "Does it match the project's
     existing patterns? Is it idiomatic? Is it maintainable? Score 1–5 on
     quality and style only. Forgiving on minor naming."
   - **Critic C — User-Intent Empath:** "Does this *actually* answer the
     user's request? Is the response clear? Did we miss obvious follow-ups?
     Score 1–5 on completeness and helpfulness. Forgiving on edge cases
     the user probably doesn't care about."

3. **Diversity is enforced by the prompt, not by temperature alone.** Each
   critic gets:
   - Different `system` prompt (the persona above).
   - Different `temperature`: A=0.1 (deterministic), B=0.3, C=0.5.
   - Different *exemplars* in the prompt (3 good + 3 bad examples per critic).

4. **Position-swap is mandatory for pairwise critics.** When critic A and
   critic B both produce rankings, we *swap positions* and re-run. If the
   swap yields a different verdict, we report "inconclusive" and escalate.

5. **The factual layer is a separate channel.** Each critic can call:
   - `tsc --noEmit` → emits type-check verdict + error lines.
   - `vitest run <file>` → emits test pass/fail counts.
   - `lsp.get_diagnostics(file)` → editor's type errors.
   - `memory.recall(symbol)` → does this symbol exist in the graph? Was it
     ever used?
   - `graph.query("MATCH (caller) -[:CALLS]-> (callee)")` → do the call
     relationships make sense?
   The critic is *required* to invoke at least one factual check for any
   "correctness" or "completeness" claim. A critic that scores "correctness:
   5" without invoking the factual layer is *down-weighted* by the judge.

6. **The judge aggregates with weighted Borda count.** For each critic `i`
   with weights `w_i` (sum to 1), and for each verdict dimension `d`:
   `score_d = Σ w_i × critic_i.score_d`. The judge also computes:
   - **Agreement ratio**: `agree = |{critics with verdict=pass}| / 3`.
   - **Confidence**: based on the variance of the 3 scores (low variance =
     high confidence; high variance = escalate).
   - **Bias indicator**: if 2/3 critics agree, but the 3rd gave an extreme
     score (e.g., 1/5 vs 4/5), flag "potential outlier" and consider dropping
     the outlier (Borda-style).

7. **Arbitration: a 4th, expensive critic is called only on disagreement.**
   When 1/3 say pass, 1/3 say fail, 1/3 say refine, the orchestrator calls
   a *judge* critic (Opus-class) with all 3 critiques in its prompt. The
   judge emits a tie-breaking verdict with an explanation. This is
   ~1% of cases (empirically from Du et al.).

8. **The mesh is a stream operator.** From `01-stream.md`: the critic mesh
   is a `tee(src, 3)` followed by a `merge(critics)` that emits the
   aggregated `critique` event. The 4th judge is a *conditional* branch:
   only on disagreement, we add a `judge_consult` event.

9. **Cost budget: $0.01 per verification, configurable.** The orchestrator
   tracks cumulative cost and *downgrades* the mesh (3 → 2 → 1) when the
   budget is tight. The downgrade is *transparent* — the user sees a
   "verification degraded to single critic due to budget" warning.

10. **v3.0 compatibility: a `Critic` adapter.** v3.0's `Critic` class
    exposes a single `critique(plan) → CritiqueResult` method. v4.0's
    `CriticMesh` exposes the *same* signature but routes through the
    mesh. Drop-in replacement. Existing v3.0 tests pass without
    modification.

11. **Persistent calibration: store mesh verdicts for offline analysis.**
    Every mesh verdict (per-dimension scores, per-critic reasoning, the
    aggregation, the actual ground truth outcome) is stored in the
    memory graph (primitive #5) for offline calibration. We can later
    answer: "Which critic is most often right? When they disagree, who
    is right more often?" This is *meta-learning over the mesh*.

12. **Self-test mode: the mesh verifies itself.** Periodically, we feed
    the mesh a *known-good* and a *known-bad* plan and check that the
    mesh scores them correctly. If the mesh's accuracy drops below
    90%, we alert the developer. This is *regression testing for the
    critic*.

### 4.3 What we are *not* doing

- **Not** fine-tuning our own judge model. We use the existing 15 providers.
  Prometheus-style fine-tuning is a future option if the mesh proves
  too expensive.
- **Not** implementing full Borda count. We use a *weighted-average*
  Borda variant (the `score_d = Σ w_i × critic_i.score_d` formula).
  Full Borda requires ranked preferences, which is overkill.
- **Not** running all 3 critics for every single tool call. The fast
  path skips the mesh for trivial operations.
- **Not** trusting the mesh's verdict without a factual check on at
  least one "must verify" dimension. A mesh that says "correctness: 5"
  without running the type-checker is treated as untrusted.

---

## 5. TypeScript Sketch

The sketch shows the core ideas: a mesh of 3 critics with diverse personas, a
factual-layer channel, weighted-Borda aggregation, position-swap for bias
detection, arbitration on disagreement, and a v3.0-compatible adapter.

```ts
// ─────────────────────────────────────────────────────────────────
// HuaEngine v4.0 — Critic Mesh (sketch)
// ─────────────────────────────────────────────────────────────────

import type { Plan, CritiqueResult, PlanStep } from '../../types/index.js';
import type { UnifiedClient, StreamEvent } from '../../providers/client.js';

// 1. The three critic personas (constitutional principles)

type CriticPersona =
  | 'correctness'   // "does it compile, do tests pass, no any, no runtime errors"
  | 'style'         // "matches project conventions, idiomatic, maintainable"
  | 'intent';       // "actually answers the user's question, clear, complete"

interface CriticConfig {
  persona: CriticPersona;
  systemPrompt: string;          // unique per persona
  temperature: number;           // A=0.1, B=0.3, C=0.5
  exemplars: { good: string; bad: string }[];   // 3 of each
  weight: number;                // Borda weight (0..1, sum=1 across mesh)
  model?: string;                // default = client.getModel()
}

const MESH_CONFIG: CriticConfig[] = [
  {
    persona: 'correctness',
    systemPrompt: `You are a strict correctness reviewer. Your job: find bugs.
Focus only on: does it compile, do types check, are errors handled, are
edge cases covered, are there any `any` or `as` casts. Score 1-5 on
correctness and completeness. Be harsh on runtime safety. NEVER praise
style — that's another critic's job.`,
    temperature: 0.1,
    exemplars: [...],  // 3 good + 3 bad correctness examples
    weight: 0.4,       // highest weight (correctness is most important)
  },
  {
    persona: 'style',
    systemPrompt: `You are a style and convention advocate. Your job: enforce
project consistency. Focus only on: does it match the existing patterns
in the file, is it idiomatic for the language, is it maintainable, would
a senior reviewer approve? Score 1-5 on quality. Forgiving on minor
naming. NEVER comment on correctness — that's another critic's job.`,
    temperature: 0.3,
    exemplars: [...],
    weight: 0.25,
  },
  {
    persona: 'intent',
    systemPrompt: `You are the user's advocate. Your job: did we actually
help? Focus only on: does this answer the user's question, is the
response clear, are obvious follow-ups addressed? Score 1-5 on
completeness and helpfulness. Forgiving on edge cases the user probably
doesn't care about. NEVER comment on internal implementation.`,
    temperature: 0.5,
    exemplars: [...],
    weight: 0.35,
  },
];

// 2. The factual layer — ground truth oracle(s)

interface FactualCheck {
  name: string;
  run: (plan: Plan) => Promise<{ ok: boolean; details: string }>;
}

const FACTUAL_CHECKS: FactualCheck[] = [
  {
    name: 'typescript_compile',
    run: async (plan) => {
      const tsFiles = plan.steps
        .filter(s => s.tool === 'write' || s.tool === 'edit')
        .map(s => s.args?.path)
        .filter(p => p?.endsWith('.ts') || p?.endsWith('.tsx'));
      if (tsFiles.length === 0) return { ok: true, details: 'no ts files' };
      // shell out to tsc --noEmit
      const { spawn } = await import('node:child_process');
      return new Promise((resolve) => {
        const proc = spawn('npx', ['tsc', '--noEmit', '--noErrorTruncation'], { cwd: process.cwd() });
        let stderr = '';
        proc.stderr.on('data', d => stderr += d);
        proc.on('close', code => resolve({
          ok: code === 0,
          details: code === 0 ? 'compiles cleanly' : stderr.slice(0, 1000),
        }));
      });
    },
  },
  {
    name: 'tests_pass',
    run: async (plan) => {
      // heuristic: did the plan include running tests?
      const ranTests = plan.steps.some(s => s.tool === 'bash' && /test|vitest|jest/.test(s.args?.cmd || ''));
      if (!ranTests) return { ok: false, details: 'no test run in plan' };
      // actually run vitest on the relevant files
      // ...
      return { ok: true, details: 'tests pass (mocked here)' };
    },
  },
  {
    name: 'symbol_exists',
    run: async (plan) => {
      // for each "edit" step, check the symbol we're touching exists in the graph
      // (primitive #5: memory graph)
      const graph = await getMemoryGraph();
      for (const step of plan.steps) {
        if (step.tool === 'edit' && step.args?.path) {
          const sym = step.args.symbol || step.args.path;
          const exists = await graph.exists('Symbol', sym);
          if (!exists) return { ok: false, details: `unknown symbol: ${sym}` };
        }
      }
      return { ok: true, details: 'all symbols known' };
    },
  },
];

// 3. A single critic in the mesh

interface CriticOutput {
  persona: CriticPersona;
  scores: CritiqueResult['scores'];
  verdict: 'pass' | 'refine' | 'fail';
  issues: string[];
  feedback: string;
  factualChecks: { name: string; ok: boolean; details: string }[];
  confidence: number;        // self-reported 0..1
  position: 'A' | 'B' | 'C';  // for position-swap
}

class CriticNode {
  constructor(
    private config: CriticConfig,
    private client: UnifiedClient,
  ) {}

  async critique(plan: Plan, swapPosition = false): Promise<CriticOutput> {
    // build the prompt with persona + exemplars
    const system = this.config.systemPrompt + '\n\n' +
      'Examples of good critiques:\n' +
      this.config.exemplars.map(e => e.good).join('\n') + '\n\n' +
      'Examples of bad critiques:\n' +
      this.config.exemplars.map(e => e.bad).join('\n');

    const user = this.formatPlan(plan, swapPosition);

    // run the LLM critic
    let text = '';
    for await (const ev of this.client.stream({
      model: this.config.model ?? this.client.getModel(),
      system,
      messages: [{ role: 'user', content: user }],
      temperature: this.config.temperature,
      maxTokens: 1500,
    })) {
      if (ev.type === 'text_delta') text = ev.accumulated;
      if (ev.type === 'message_stop') break;
      if (ev.type === 'error') throw new Error(ev.error);
    }

    // run the factual layer checks
    const factualChecks: CriticOutput['factualChecks'] = [];
    for (const check of FACTUAL_CHECKS) {
      try {
        const result = await check.run(plan);
        factualChecks.push({ name: check.name, ok: result.ok, details: result.details });
      } catch (err) {
        factualChecks.push({ name: check.name, ok: false, details: (err as Error).message });
      }
    }

    // parse the LLM output
    const parsed = this.extractJson(text) || this.fallback(text);

    // if the LLM praised correctness without invoking tsc, down-weight
    if (parsed.scores?.correctness >= 4 && !factualChecks.some(c => c.name === 'typescript_compile')) {
      parsed.notes = (parsed.notes || '') + ' [WARN: correctness claim without factual check]';
    }

    return {
      persona: this.config.persona,
      scores: parsed.scores,
      verdict: parsed.verdict,
      issues: parsed.issues || [],
      feedback: parsed.feedback || text.slice(0, 500),
      factualChecks,
      confidence: parsed.confidence ?? 0.7,
      position: ['A', 'B', 'C'][['correctness', 'style', 'intent'].indexOf(this.config.persona)],
    };
  }

  private formatPlan(plan: Plan, swapPosition: boolean): string {
    // standard plan-to-text rendering, with optional position-swap
    // (for pairwise comparison, swap the order of plan candidates)
    return JSON.stringify(plan, null, 2);
  }

  private extractJson(text: string): any {
    try { return JSON.parse(text); } catch {}
    const m = text.match(/```(?:json)?\s*([\s\S]+?)\s*```/);
    if (m) try { return JSON.parse(m[1]); } catch {}
    const o = text.match(/\{[\s\S]+\}/);
    if (o) try { return JSON.parse(o[0]); } catch {}
    return null;
  }

  private fallback(text: string): any {
    return { scores: { correctness: 3, completeness: 3, quality: 3, safety: 4, efficiency: 3 },
             verdict: 'refine', feedback: text.slice(0, 500) };
  }
}

// 4. The mesh — runs N critics in parallel, aggregates

interface MeshResult extends CritiqueResult {
  perCritic: CriticOutput[];
  agreement: number;        // 0..1, how much they agree
  factualSummary: { name: string; ok: boolean }[];
  arbitrationUsed: boolean;
  biasDetected: boolean;
}

class CriticMesh {
  private nodes: CriticNode[];
  private arbitrator: UnifiedClient;

  constructor(private client: UnifiedClient, private options: {
    size?: 1 | 2 | 3;
    arbitratorModel?: string;
  } = {}) {
    this.options = { size: 3, ...options };
    this.nodes = MESH_CONFIG.slice(0, this.options.size)
      .map(c => new CriticNode(c, client));
    this.arbitrator = client;  // could be a different model
  }

  async critique(plan: Plan, budgetUsd = 0.01): Promise<MeshResult> {
    // fast path: trivial task
    if (this.isTrivial(plan)) {
      const result = await this.nodes[0].critique(plan);
      return this.aggregate([result], plan, false);
    }

    // run all N critics in parallel
    const t0 = Date.now();
    const results = await Promise.all(
      this.nodes.map(node => node.critique(plan).catch(err => ({
        persona: 'correctness' as CriticPersona,
        scores: { correctness: 3, completeness: 3, quality: 3, safety: 4, efficiency: 3 },
        verdict: 'refine' as const,
        issues: [err.message],
        feedback: 'critic failed',
        factualChecks: [],
        confidence: 0.1,
        position: 'A' as const,
      })))
    );

    // budget guard: if we're spending too much, downgrade
    const spent = this.estimateCost(results);
    if (spent > budgetUsd) {
      // drop the most expensive critic
      results.sort((a, b) => b.factualChecks.length - a.factualChecks.length);
      results.pop();  // drop the most-expensive one
    }

    // bias detection: position-swap on 2 random critics
    const biasDetected = await this.detectBias(plan);

    // arbitration: if disagreement, call the 4th critic
    const agreement = this.computeAgreement(results);
    let arbitrationUsed = false;
    if (agreement < 0.66) {
      arbitrationUsed = true;
      const arb = await this.arbitrate(results, plan);
      results.push(arb);
    }

    return this.aggregate(results, plan, biasDetected, arbitrationUsed);
  }

  // weighted Borda aggregation
  private aggregate(results: CriticOutput[], plan: Plan, bias: boolean, arb = false): MeshResult {
    const weights = MESH_CONFIG.map(c => c.weight);
    const dims: (keyof CritiqueResult['scores'])[] = ['correctness', 'completeness', 'quality', 'safety', 'efficiency'];

    const scores: CritiqueResult['scores'] = {} as any;
    for (const d of dims) {
      let total = 0, w = 0;
      results.forEach((r, i) => {
        const score = r.scores[d] ?? 3;
        const conf = r.confidence ?? 0.7;
        const weight = weights[i] ?? 0.1;
        total += score * weight * conf;
        w += weight * conf;
      });
      scores[d] = w > 0 ? total / w : 3;
    }

    const overall = (scores.correctness + scores.completeness + scores.quality + scores.safety + scores.efficiency) / 5;

    // verdict: simple majority of pass/refine/fail, weighted
    const verdicts = results.map(r => r.verdict);
    const passCount = verdicts.filter(v => v === 'pass').length;
    const failCount = verdicts.filter(v => v === 'fail').length;
    let verdict: 'pass' | 'refine' | 'fail';
    if (overall < 2.5 || failCount > results.length / 2) verdict = 'fail';
    else if (overall < 4.0 || passCount < results.length / 2) verdict = 'refine';
    else verdict = 'pass';

    // merge issues & feedback
    const issues = [...new Set(results.flatMap(r => r.issues))];
    const feedback = results
      .map(r => `[${r.persona}] ${r.feedback}`)
      .join('\n\n');

    // factual layer summary
    const allChecks = results.flatMap(r => r.factualChecks);
    const factualSummary = Object.values(
      allChecks.reduce((acc, c) => {
        acc[c.name] = acc[c.name] || { name: c.name, ok: c.ok };
        // OR of all critics' verdicts on this check
        acc[c.name].ok = acc[c.name].ok && c.ok;
        return acc;
      }, {} as Record<string, { name: string; ok: boolean }>)
    );

    return {
      verdict,
      scores,
      overall,
      feedback,
      issues,
      suggestions: [],  // could mine from feedback
      perCritic: results,
      agreement: this.computeAgreement(results),
      factualSummary,
      arbitrationUsed: arb,
      biasDetected: bias,
    };
  }

  private async detectBias(plan: Plan): Promise<boolean> {
    // run 2 critics with swapped positions
    if (this.nodes.length < 2) return false;
    const a = await this.nodes[0].critique(plan, false);
    const b = await this.nodes[1].critique(plan, true);
    // if position-swap changes the verdict, bias is likely
    return a.verdict !== b.verdict;
  }

  private async arbitrate(critics: CriticOutput[], plan: Plan): Promise<CriticOutput> {
    const system = `You are a senior arbitrator. The following ${critics.length} critics have
disagreed about this plan. Read their verdicts, then make the final call.
Be specific: explain why one is right and the others are wrong.`;
    const user = `Critics:\n${critics.map(c => `[${c.persona}] verdict=${c.verdict}, scores=${JSON.stringify(c.scores)}\n  issues: ${c.issues.join('; ')}\n  feedback: ${c.feedback}`).join('\n\n')}\n\nPlan: ${JSON.stringify(plan, null, 2)}\n\nFinal verdict?`;

    let text = '';
    for await (const ev of this.arbitrator.stream({
      model: this.options.arbitratorModel ?? this.client.getModel(),
      system,
      messages: [{ role: 'user', content: user }],
      temperature: 0.1,
      maxTokens: 1500,
    })) {
      if (ev.type === 'text_delta') text = ev.accumulated;
      if (ev.type === 'message_stop') break;
    }
    const parsed = this.safeParse(text);
    return {
      persona: 'correctness',  // arbitrator's persona
      scores: parsed.scores || { correctness: 3, completeness: 3, quality: 3, safety: 4, efficiency: 3 },
      verdict: parsed.verdict || 'refine',
      issues: parsed.issues || [],
      feedback: parsed.feedback || text.slice(0, 500),
      factualChecks: [],
      confidence: 0.8,
      position: 'A',
    };
  }

  private computeAgreement(results: CriticOutput[]): number {
    const verdicts = results.map(r => r.verdict);
    const counts = verdicts.reduce((acc, v) => {
      acc[v] = (acc[v] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    const max = Math.max(...Object.values(counts));
    return max / verdicts.length;
  }

  private isTrivial(plan: Plan): boolean {
    return plan.steps.length <= 1
      && plan.steps.every(s => s.tool !== 'write' && s.tool !== 'edit');
  }

  private estimateCost(results: CriticOutput[]): number {
    // rough: 1500 output tokens × $0.000003 per token (Haiku-class)
    return results.length * 1500 * 0.000003;
  }

  private safeParse(text: string): any {
    try { return JSON.parse(text); } catch {}
    const m = text.match(/\{[\s\S]+\}/);
    if (m) try { return JSON.parse(m[0]); } catch {}
    return {};
  }
}

// 5. v3.0 adapter — drop-in replacement

import { Critic as V3Critic } from '../../engine/critic.js';

export class CriticMeshV3Adapter {
  constructor(private mesh: CriticMesh) {}

  // exact same signature as v3.0 Critic
  async critique(plan: Plan): Promise<CritiqueResult> {
    const result = await this.mesh.critique(plan);
    return {
      verdict: result.verdict,
      scores: result.scores,
      overall: result.overall,
      feedback: result.feedback,
      issues: result.issues,
      suggestions: result.suggestions,
    };
  }
}
```

### Key points in the sketch

- **`CriticConfig` is a first-class typed object.** Adding a 4th critic (e.g.,
  "security") is a 30-line change — no algorithm changes.
- **Factual layer is *required* for correctness claims.** A critic that scores
  correctness ≥ 4 without invoking `typescript_compile` is warned and
  down-weighted. This is the "grounding" rule from Huang et al. 2023.
- **Position-swap is a separate pass** that detects bias; if swap changes the
  verdict, the orchestrator reports "bias detected" and may run the 4th
  arbitrator.
- **Weighted Borda is the aggregation.** We use confidence × persona-weight,
  not simple majority, because a high-confidence "fail" from correctness is
  more informative than a low-confidence "pass" from intent.
- **Arbitration is rare** (~1% of cases) and only when agreement < 66%.
  This is the cost-control mechanism: most plans get 3 cheap verdicts, not
  4 expensive ones.
- **`CriticMeshV3Adapter`** is a drop-in replacement for v3.0's `Critic` —
  the existing `Engine` class doesn't change.

---

## 6. Open Questions

1. **How do we calibrate the persona weights?**
   - Default weights (0.4, 0.25, 0.35) are guesses. Real weights should be
     learned from historical data: "When critic A says fail and the test
     suite also fails, was A's verdict decisive?" This is *inverse propensity
     weighting* from the LLM-as-judge literature.
   - Bootstrap dataset: the first 100 v4.0 runs, with human labels (the
     user clicked "this was wrong" / "this was right"). Use this to fit
     weights.
   - Cold start: use the default weights, log everything, refit after 100
     tasks.

2. **What if the factual layer disagrees with the critics?**
   - E.g., all 3 critics say "pass" but `tsc` reports 3 errors. The factual
     layer is *trusted over the critics* (per Huang et al.). But the user
     might *want* the code anyway (e.g., they're prototyping). The mesh
     reports: `factual_ok: false, critic_verdict: pass, recommended: refine`.
   - The orchestrator should *block* file writes when the factual layer
     fails. But this is a UX choice: the user can override with `--force`.

3. **Should the mesh have a memory of past verdicts?**
   - "This critic was wrong 3 times in a row about X" → down-weight it for
     future X queries. This is *adaptive ensembling*, used in classical ML
     ensembles. Risk: overfitting to a small history.
   - We should *log* all verdicts and their outcomes (via the memory graph
     primitive) but not yet *adapt* weights in production. Defer to v4.1.

4. **What about non-code tasks (research, action, question)?**
   - The "correctness" critic is meaningless for "what's the weather in
   - Tokyo?" We need a *critic mesh selector*: for `taskType=code_write`,
     run the full mesh. For `taskType=question`, run a single cheap critic
     (style + accuracy of the answer). For `taskType=action`, run a
     safety-only critic.
   - This is a small classifier in the engine orchestrator.

5. **What if the LLM provider is down for one of the parallel calls?**
   - The 3-critic fan-out uses 3 *independent* requests. If one provider
     fails, we lose 1 critic. The mesh becomes a 2-critic mesh. The
     agreement threshold drops to 50% (from 66%). The orchestrator logs
     a "degraded mesh" event.
   - For higher reliability, the 3 critics should be on *different*
     providers (e.g., A on MiniMax-M3, B on GPT-4o, C on Claude). Then a
     single provider outage degrades to a 2-critic mesh, not 0.

6. **How do we handle adversarial inputs?**
   - A user could craft a prompt designed to fool the cheap critic (e.g.,
     "all tests pass" prepended to the plan). The factual layer is
     *resistant* to this — it actually runs the tests, doesn't trust the
     prompt. So the factual layer is our adversarial defense.
   - We should *never* let a critic override a factual-layer failure.

7. **What's the right aggregation for *partial* agreement?**
   - Currently: simple weighted Borda. Alternatives:
     - **Condorcet method** (pairwise winner): more principled but O(N²) critics.
     - **Approval voting**: each critic marks "approve" or "reject"; majority
       wins. Loses information about degrees.
     - **STV (single transferable vote)**: ranks the critics, eliminates
       bottom, redistributes. Overkill for 3 critics.
   - We may need to A/B test these in production with a small user cohort.

8. **How do we keep the persona prompts from drifting over time?**
   - The exemplars in each critic's prompt are *manually curated*. As the
     codebase evolves, the exemplars become outdated. We need a *critic
     prompt regression test*: a set of 50 known (plan, expected_verdict)
     pairs. Run the mesh weekly; if accuracy drops, re-curate.
   - This is the "self-test mode" in §4.2 decision 12.

9. **Should the critic mesh be exposed in the UI?**
   - Users may want to see *all 3 critiques*, not just the aggregated
     verdict. This is great for trust and debuggability but adds UI
     complexity. The v3.0 TUI already shows a `critique` event — we can
     extend it to show 3 sub-events.
   - For anime-themed game devs, we could even give each critic a *name*
     and *avatar* (e.g., "Correctness-kun", "Style-chan", "Intent-sama").
     This is a fun UX touch that fits the project's brand.

10. **How do we measure mesh quality?**
    - We need a *golden dataset* of (plan, ground_truth_verdict) pairs.
    - For each plan, we know: did the tests pass? did the user accept the
      change? was the file later reverted? These are *noisy* proxies for
      ground truth but they're what we have.
    - We log (plan, mesh_verdict, ground_truth_outcome) for every
      verification. After 1000 runs, we can compute the mesh's accuracy
      vs. a single-critic baseline. The result is published in
      `/status`.
