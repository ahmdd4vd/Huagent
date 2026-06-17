# Primitive 3: Speculative Execution

> Racing multiple "strategies" against each other and committing the first good-enough
> result. The inverse of the v3.0 pattern, which picks one strategy, runs it to
> completion, and *then* evaluates. We race, sample, and short-circuit on the
> first acceptable answer.

---

## 1. Literature & References

### 1.1 Speculative Decoding in LLMs (the foundational paper)

**Leviathan, Y., Kalman, M. & Matias, Y. (2023). "Fast Inference from Transformers
via Speculative Decoding."** arXiv:2211.17192, ICML 2023.
- Key insight: Use a *small draft model* to generate K candidate tokens
  autoregressively, then have the *large target model* verify all K in a
  single forward pass. Accept the longest prefix that matches the target's
  distribution, reject the rest, and continue. Result: 2–3× speedup with
  *provably no change in output distribution*.
- Why it matters for us: This is the *token-level* analogue of what we want
  at the *action-level*: a cheap fast strategy proposes, an expensive accurate
  strategy verifies, we keep the first consistent result. The math is the
  same; the granularity is different.

**Chen, C. et al. (2023). "Accelerating Large Language Model Decoding with
Speculative Sampling."** arXiv:2302.01318 (DeepMind).
- Published two months after Leviathan, independently derived the same
  algorithm. Uses rejection-sampling to ensure the output distribution is
  identical to the target model's.
- Why it matters: This paper is what most production systems cite. The
  rejection-sampling formulation is what we'd want to *generalize* to the
  action-level case.

**Cai, T. et al. (2024). "Medusa: Simple LLM Inference Acceleration Framework
with Multiple Decoding Heads."** arXiv:2401.10774.
- Key insight: Skip the draft model. Add multiple *decoding heads* to the
  target model that each predict the next K+1, K+2, … token. Tree-verify
  in one pass. Simpler than draft-model speculative decoding and 2–3× faster
  than vanilla.
- Why it matters: For us, "multiple decoding heads" maps to "multiple
  executor strategies." Each head is a different *approach* to the task;
  the verifier picks the first one that passes the critics.

**Li, Y. et al. (2024). "EAGLE: Extrapolation Algorithm for Greater
LLM-mixup Efficiency."** arXiv:2401.15077.
- Uses the *second-to-top layer* of the target model as the draft (instead
  of a separate small model). Higher acceptance rate than Medusa.
- Why it matters: For us, this is the *use-everything-you-already-have*
  lesson: don't spin up a new LLM; use a cheaper, related process to
  propose and the same critic to verify.

**Miao, X. et al. (2023). "SpecInfer: Accelerating Generative LLM Serving
with Speculative Inference and Token Tree Verification."** arXiv:2303.11627.
- Adds *tree-structured* candidates: a single draft model proposes multiple
  branches, all verified in one pass. Higher throughput.
- Why it matters: This is exactly our action-level speculative execution
  model. The "tree" is our method decomposition space; the "verification" is
  the critic.

### 1.2 CPU Speculative Execution

**Hennessy, J. L. & Patterson, D. A. (2017). "Computer Architecture: A
Quantitative Approach." 6th ed. Morgan Kaufmann.
- Chapter 3 covers branch prediction and speculative execution in depth.
  Speculative execution executes instructions *before* knowing if they're
  needed; on a misprediction, the reorder buffer (ROB) rolls them back.
- Key insight: Speculation is *always* a bet. The CPU bets on the branch
  direction; if wrong, it pays a misprediction penalty. The CPU is *fast*
  because branch prediction accuracy is > 95% on typical code.
- Why it matters: Our "speculation" has the same structure — we bet that
  the first racing strategy is correct, and we have a *rollback* mechanism
  if it's not (the critic fails, the verifier rejects, the test fails).
  The bet is profitable when the *acceptance rate* is high.

**Kocher, P. et al. (2018). "Spectre Attacks: Exploiting Speculative
Execution."** (and "Meltdown" by Lipp et al. 2018).
- Key insight: Speculative execution can leak information through cache
  side channels. The fix is *speculation-aware* software (lfence,
  speculation-safe coding).
- Why it matters: A reminder that *speculative* systems can have *adversarial*
  failure modes. For us: what happens if a racing strategy *almost* wins
  but the side effects are partially committed? We need *atomic* commit
  semantics: either the whole strategy's effects apply, or none of them.

### 1.3 Multi-Strategy Agent Systems

**Wang, X. et al. (2022). "Self-Consistency Improves Chain of Thought
Reasoning in Language Models."** arXiv:2203.11171.
- Key insight: Sample *N* chain-of-thought completions; take the *majority
  answer*. The result is dramatically more accurate on math/reasoning
  benchmarks than greedy decoding.
- Why it matters: This is the *post-hoc* version of what we want: don't
  race for speed, *sample for accuracy*. Our critic-merge can use
  self-consistency as a tie-breaker.

**Du, Y. et al. (2023). "Improving Factuality and Reasoning in Language
Models through Multiagent Debate."** arXiv:2305.14318.
- Key insight: Have multiple LLM "agents" debate a question. The
  consensus answer is more accurate. Empirically 2–3 agents is the
  sweet spot (diminishing returns past 3).
- Why it matters: This is the *recipe* for our 3-critic system. Three
  independent critics (with different personas/prompts) is the right
  number — matches our v3.0 verification design.

**Qian, C. et al. (2023). "ChatDev: Communicative Agents for Software
Development."** arXiv:2307.07924.
- A multi-agent pipeline where a CEO agent, CTO agent, programmer agent,
  and reviewer agent collaborate through structured chat. Each agent
  sees only its own responsibilities.
- Why it matters: The "many agents, each with a role" pattern is a soft
  form of speculative execution — multiple perspectives race, the
  human-equivalent reviewer is the tie-breaker.

**Li, G. et al. (2023). "CAMEL: Communicative Agents for 'Mind'
Exploration of Large Language Model Society."** arXiv:2303.17760.
- Two-agent role-play (user + assistant) with explicit role prompts.
  Shows that *role conditioning* + *competition* improves quality.
- Why it matters: Our 3 critics should have *different* system prompts
  (strict-pragmatist, type-safety-stickler, user-experience-advocate)
  to maximize diversity.

### 1.4 Racing and Timeout Patterns

**Dean, J. & Barroso, L. A. (2013). "The Tail at Scale."** Communications
of the ACM 56(2):74–80.
- Key insight: User-facing latency is dominated by the *tail* (p99) of
  individual request latencies. To reduce tail, send each request to
  *two* servers, take whichever responds first ("hedged requests").
- Why it matters: Hedged requests are *exactly* our model. We send the
  same task to *two* (or three) critic processes; the first good-enough
  result wins. The user sees the *minimum* of the two latencies.

**Nightingale, E. B., Chen, P. M. & Flinn, J. (2005). "Speculative
Execution in a Distributed File System."** ACM TOCS 23(4):385–428.
- Speculative execution in the *file system*: read a file from the
  primary, but also start a read from the backup in case the primary
  is slow. Discard the backup read when the primary returns.
- Why it matters: Same pattern, different layer. Our 3 critics are
  *speculative reads* against a slow ground-truth (the test suite,
  the type-checker, the user).

### 1.5 Cost-Quality Tradeoffs

**Snell, C. et al. (2024). "Scaling LLM Test-Time Compute Optimally Can
be More Effective than Scaling Model Parameters."** arXiv:2408.03314.
- Key insight: For a fixed compute budget, you can sometimes get better
  results by *running a small model many times and aggregating* than
  by running a big model once. The optimal strategy depends on the
  difficulty of the prompt.
- Why it matters: This is the *theory* of our budget allocator. For easy
  prompts, use a single cheap strategy. For hard prompts, use multiple
  expensive strategies in parallel and pick the best.

**Wu, S. et al. (2024). "Closer Look at Efficient Reasoning with Small
Language Models."** arXiv:2403.04747.
- Quantifies when small-model + many attempts beats big-model + one attempt.
  The crossover depends on the task.
- Why it matters: For v4.0, our "small" strategy is a fast (cheap) LLM
  with a tight prompt; our "big" strategy is `MiniMax-M3` (the default
  for v3.0) with a longer reasoning prompt.

---

## 2. Existing Implementations

| System | Type | Notable Property | Relevance to HuaEngine |
|---|---|---|---|
| **vLLM** (Kwon et al. 2023) | LLM serving engine | PagedAttention; supports speculative decoding plug-ins | Production impl of token-level spec decoding |
| **SGLang** (Zheng et al. 2024) | LLM serving with structured generation | Supports *radix tree* speculative execution | Demonstrates tree-shaped candidate generation |
| **SpecInfer** (Miao et al. 2023) | Tree-based speculative inference | Tree of draft tokens verified in one pass | Algorithm to generalize for action-level |
| **LangChain Multi-Prompt** | LLM orchestration | Run N prompts in parallel, take first / vote | Naive action-level speculation |
| **OpenAI o1 / o3** | Reasoning model | Internal "thinking" can be interpreted as a single long speculation | *Single-strategy* speculation with high confidence |
| **Anthropic Claude "Extended Thinking"** | Reasoning model | Same idea, exposed via API | Same |
| **Cloudflare "Speculation Rules"** | HTTP/web perf | `Speculation-Rules` header to prerender pages | Not LLM, but the *HTTP speculation* API is informative |
| **ParallelGPT / Cambrian** | API wrappers | Send N identical requests to different providers, take first valid | The "race the same task to different providers" pattern |

### The one to study hardest: **SpecInfer**

SpecInfer's algorithm generalizes speculative decoding beyond token-level.
Its key idea: a *speculative pool* of candidate token sequences is
*tree-verified* by the target model in a single forward pass. The
verification uses a *token tree mask* to identify the prefix of each branch
that matches the target's distribution.

The action-level analogue is straightforward:

| Token-level | Action-level |
|---|---|
| Draft model | Multiple executor strategies |
| Target model | Critic pool (3 critics in our case) |
| Token tree mask | Method decomposition tree |
| Acceptance: longest prefix consistent with target | Acceptance: first strategy whose output passes all 3 critics |
| Rejection: resample from target | Rejection: discard the strategy, fall back to v3.0 flat plan |

---

## 3. Trade-offs

### Pros of speculative execution

| Property | One-strategy, run-to-completion (v3.0) | Race-many-then-pick (v4.0) |
|---|---|---|
| **Latency (p50)** | Median of the single strategy | Median of the *minimum* across strategies (hedged) |
| **Latency (p99)** | Tail of the single strategy | Tail of the *minimum*; bounded by the fastest reliable strategy |
| **Quality** | Whatever the one strategy produced | Quality of the *best* of N; 3-critic majority wins |
| **Robustness to strategy failure** | Catastrophic (whole turn fails) | 1/3 strategies can fail with no user-visible impact |
| **Cost** | 1× strategy cost | N× strategy cost; amortized when strategies are cheap |
| **Cancellation** | Easy: stop the strategy | Harder: must signal N strategies, gather partial results |
| **Determinism** | High (given the strategy) | Low (varies by run; reproducibility requires seed) |
| **Debuggability** | Easy: one log | Harder: N logs, N traces, which one "won" |

### Cons / when NOT to use

- **Cost**: 3 strategies = 3× the LLM bill. For simple tasks (one tool call),
  this is pure waste. We need a *fast path* that uses 1 strategy for trivial
  tasks and 3 for hard ones.
- **Cancellation complexity**: When the user hits Ctrl-C, we have 3
  in-flight strategies; all must be cancelled. We need a single
  `AbortController` fanned out to all strategies.
- **Resource contention**: 3 parallel LLM calls compete for the same
  provider rate limits. Need a *token bucket* across all strategies.
- **Result-merge semantics**: When strategy A says "pass" and strategy B
  says "fail," we have a tie-break problem. Options: confidence-weighted
  voting, fast-then-correct (whichever finishes first passes), or ask
  the LLM to adjudicate.
- **Side-effect ordering**: If strategy A and strategy B both write to
  the same file, we have a race. Speculative writes must be
  *isolated* (write to a shadow file) and only the winner's write
  is committed.

### When to use speculation

- ✅ Hard, multi-step tasks where one strategy has high variance.
- ✅ Tasks with cheap-verifiable correctness (type-check, lint, test pass).
- ✅ When the user's *latency budget* is tight (1.5–3s).
- ❌ Trivial one-shot tasks (one tool call, no verification).
- ❌ Tasks with side effects that cannot be rolled back (sending email,
  making an API call to a non-idempotent endpoint).
- ❌ When the cost of the cheap strategy is already > 50% of the budget.

---

## 4. Our Adaptation for HuaEngine v4.0

### 4.1 Mental model

> HuaEngine v4.0 races *multiple* (typically 3) executor strategies against
> the same task. Each strategy proposes a *complete solution* (a sequence of
> tool calls + the final answer). The *critic pool* of 3 verifiers judges
> each strategy. The first strategy to receive all-pass critiques is
> committed; the others are aborted. This is *hedged requests* applied to
> cognitive work.

### 4.2 Concrete design decisions

1. **Three strategies is the default.** Empirically (Du et al. 2023), 2–3
   is the sweet spot. We use 3 by default, 1 for "trivial" tasks, 2 for
   "moderate," 3 for "complex." The classification is done by the LLM
   itself in the spec stage.

2. **Strategies are diverse by construction.** Three identical strategies
   would always agree (boring). We seed them with *different system prompts*:
   - **Strategy A — Minimalist**: "Solve with the fewest possible tool calls.
     Prefer existing patterns. Refactor if it makes the code shorter."
   - **Strategy B — Conservative**: "Make the smallest change to the
     existing code. Preserve all existing behavior. Add tests."
   - **Strategy C — Type-safety-stickler**: "Use strict types. Avoid `any`.
     Validate at boundaries. Add explicit error handling."

3. **Strategies can share an HTN method library** (primitive #2). They
   *diverge in the method choice* or in the order of subtasks, not in the
   underlying capabilities.

4. **The critic pool is a separate fan-out.** After the executor returns
   the 3 candidate solutions, the *critic* stage fans out 3 verifications:
   - **Critic 1 — Correctness**: Does the code typecheck? Do the tests
     pass? Are there any `any`s?
   - **Critic 2 — Style**: Does it match the existing project's style?
     Is it idiomatic for the language?
   - **Critic 3 — User intent**: Does this actually solve what the user
     asked for? Is the answer helpful, not just correct?

5. **Hedged timing.** All 3 strategies start at the same time. The
   *first* to finish enters verification immediately. The other two
   continue running; if they finish and pass all critics, they're
   alternative candidates. If the first one *fails* a critic, we
   fall back to the next-fastest that passed.

6. **Budget per strategy.** Each strategy has a hard timeout (e.g., 8
   seconds). The orchestrator kills any strategy that exceeds it. This
   is the *predictable tail* — the user never waits more than 8s + critic
   time.

7. **Side-effect isolation.** Each strategy writes to a *shadow*
   snapshot: `snapshot_A/`, `snapshot_B/`, `snapshot_C/`. Only the
   winning strategy's snapshot is *promoted* to the main workspace.
   Promotion is atomic (a single `git checkout`-like operation).

8. **"Good enough" semantics.** A strategy "wins" when:
   - It completes within the budget.
   - It passes *all 3 critics* (unanimous), OR
   - It passes 2/3 critics and the failing critic is the *lowest-priority*
     one (style), OR
   - The *self-consistency* of its output across 2 samples is high (> 0.9).

9. **Telemetry.** Every race produces a `race_report` event:
   ```json
   {
     "strategies": ["minimalist", "conservative", "typesafe"],
     "winner": "conservative",
     "winner_finish_ms": 2100,
     "strategies_finished_ms": [2100, 3400, 4500],
     "critic_verdicts": [["pass", "pass", "pass"], ["pass", "pass", "fail"], ...],
     "budget_ms": 8000,
     "estimated_cost_usd": 0.04
   }
   ```
   This goes to the replay log and to the metrics collector.

10. **Speculation level** is a session-level setting. Power users can
    set `HUAENGINE_SPECULATION=1|2|3`. Default is `2` (conservative +
    one alternative) for cost reasons; `3` for "I want the best answer
    and don't care about cost."

### 4.3 What we are *not* doing

- **Not** racing the *same* strategy 3 times for self-consistency.
  That's weak (no diversity). We race *diverse* strategies.
- **Not** doing long-lived agent debate. The race is bounded by the
  budget; debate is a research artifact, not a production pattern.
- **Not** running all 3 critics in serial. They run in parallel via
  the stream primitive's `tee()` operator.
- **Not** running strategies on the *real* workspace. Shadow snapshots
  are mandatory for v4.0.

---

## 5. TypeScript Sketch

```ts
// ─────────────────────────────────────────────────────────────────
// HuaEngine v4.0 — Speculative Executor (sketch)
// ─────────────────────────────────────────────────────────────────

// 1. Strategy definition

type Strategy = {
  name: string;
  systemPrompt: string;
  // The strategy gets the same plan but conditions the executor differently
  execute: (plan: PrimitivePlan, state: WorldState, signal: AbortSignal)
    => Promise<ExecutorResult>;
};

type ExecutorResult = {
  filesWritten: Map<string, string>;
  commandsRun: { cmd: string; exit: number; stdout: string }[];
  finalAnswer: string;
  tokensUsed: number;
  finishedAtMs: number;
};

// 2. Critic definition

type Critic = {
  name: string;
  prompt: string;
  // Critics score 0..1 and verdict 'pass' | 'refine' | 'fail'
  judge: (result: ExecutorResult, originalRequest: string, llm: LLMClient)
    => Promise<{ score: number; verdict: 'pass' | 'refine' | 'fail'; feedback: string }>;
};

// 3. The default 3 strategies

const STRATEGIES: Strategy[] = [
  {
    name: 'minimalist',
    systemPrompt: 'Solve with the fewest possible tool calls. Prefer existing patterns.',
    execute: async (plan, state, signal) => {
      const ctx = createShadowSnapshot('minimalist');
      return runPlan(plan, state, ctx, signal);
    },
  },
  {
    name: 'conservative',
    systemPrompt: 'Smallest possible change. Preserve existing behavior. Add tests.',
    execute: async (plan, state, signal) => {
      const ctx = createShadowSnapshot('conservative');
      return runPlan(plan, state, ctx, signal);
    },
  },
  {
    name: 'typesafe',
    systemPrompt: 'Use strict types. No `any`. Validate at boundaries.',
    execute: async (plan, state, signal) => {
      const ctx = createShadowSnapshot('typesafe');
      return runPlan(plan, state, ctx, signal);
    },
  },
];

// 4. The default 3 critics

const CRITICS: Critic[] = [
  {
    name: 'correctness',
    prompt: 'You are a strict type-safety reviewer. Does this code typecheck? Any `any`?',
    judge: async (result, request, llm) => judgeWithLLM(llm, result, request),
  },
  {
    name: 'style',
    prompt: 'You are a style reviewer. Is this idiomatic for the language and project?',
    judge: async (result, request, llm) => judgeWithLLM(llm, result, request),
  },
  {
    name: 'user_intent',
    prompt: 'You are a product reviewer. Does this actually solve what the user asked?',
    judge: async (result, request, llm) => judgeWithLLM(llm, result, request),
  },
];

// 5. The race orchestrator

type RaceOutcome =
  | { kind: 'winner'; strategy: string; result: ExecutorResult; report: RaceReport }
  | { kind: 'all_failed'; reports: RaceReport[] };

async function raceStrategies(
  plan: PrimitivePlan,
  state: WorldState,
  budgetMs: number,
  signal: AbortSignal,
): Promise<RaceOutcome> {
  const deadline = Date.now() + budgetMs;
  const children = STRATEGIES.map((s) => AbortSignal.any([signal, AbortSignal.timeout(budgetMs)]));

  // Fire all strategies in parallel; each writes to its own shadow snapshot
  const inFlight = STRATEGIES.map((s, i) =>
    s.execute(plan, state, children[i]).catch((err): ExecutorResult => ({
      filesWritten: new Map(),
      commandsRun: [{ cmd: '', exit: -1, stdout: String(err) }],
      finalAnswer: '',
      tokensUsed: 0,
      finishedAtMs: Date.now(),
    })),
  );

  // Wait for first to finish; verify it; commit if it wins
  const firstDone = await Promise.race(inFlight.map((p, i) => p.then((r) => ({ i, r }))));
  // ⓪ The full impl also waits for the others and tries them in finish order

  // Verify with all 3 critics in parallel
  const verdicts = await Promise.all(
    CRITICS.map((c) => c.judge(firstDone.r, plan, llm)),
  );

  if (verdicts.every((v) => v.verdict === 'pass')) {
    // commit firstDone's shadow snapshot
    promoteSnapshot(STRATEGIES[firstDone.i].name);
    return { kind: 'winner', strategy: STRATEGIES[firstDone.i].name, result: firstDone.r, report: makeReport(...) };
  }

  // ⓪ otherwise: try the next finished, etc.
  return { kind: 'all_failed', reports: [] };
}

// 6. Hedged timing: short-circuit if a winner is found before all finish

async function raceWithHedging(
  plan: PrimitivePlan,
  state: WorldState,
  budgetMs: number,
  signal: AbortSignal,
): Promise<RaceOutcome> {
  const results: Promise<{ i: number; r: ExecutorResult } | null>[] = STRATEGIES.map((_, i) =>
    (async () => {
      const r = await withTimeout(STRATEGIES[i].execute(plan, state, signal), budgetMs);
      return { i, r };
    })(),
  );

  for (const p of results) {
    const { i, r } = await p;
    if (signal.aborted) break;
    const verdicts = await Promise.all(CRITICS.map((c) => c.judge(r, plan, llm)));
    if (verdicts.every((v) => v.verdict === 'pass')) {
      // cancel the others
      signal.throwIfAborted();
      // ⓪ actually: we need a separate controller for the siblings
      promoteSnapshot(STRATEGIES[i].name);
      return { kind: 'winner', strategy: STRATEGIES[i].name, result: r, report: ... };
    }
  }

  return { kind: 'all_failed', reports: [] };
}

// 7. Wire into the stream pipeline

async function* speculatorStage(
  src: AsyncIterable<{ plan: PrimitivePlan; state: WorldState }>,
  signal: AbortSignal,
): AsyncIterable<CognitiveEvent> {
  for await (const { plan, state } of src) {
    if (signal.aborted) return;

    yield { kind: 'step_start', step: { name: 'speculative_race' } };
    const outcome = await raceWithHedging(plan, state, /* budgetMs */ 8_000, signal);

    if (outcome.kind === 'winner') {
      yield { kind: 'step_done', step: { name: 'speculative_race' },
              result: outcome.result };
      yield { kind: 'done', finalAnswer: outcome.result.finalAnswer };
      // telemetry
      yield { kind: 'metric', name: 'race_winner_strategy', value: outcome.strategy };
    } else {
      yield { kind: 'error', err: new Error('all strategies failed'), recoverable: true };
    }
  }
}
```

### Key points in the sketch

- **Three strategies, three critics, both with diversity-by-prompt.**
- **Shadow snapshots** make side-effect isolation cheap.
- **Hedged timing** means we commit the *first* strategy to pass all
  critics, not the last to finish.
- **Single `AbortSignal`** fans out to all strategies; cancellation
  is cooperative.
- **`raceWithHedging`** is a `for-await` over the resolved results
  in finish order — not a single `Promise.race` (which would throw
  away the others' results).

---

## 6. Open Questions

1. **How do we ensure strategies are *genuinely* diverse?**
   - If two strategies happen to produce the same answer (because the LLM
     is more deterministic than the prompt suggests), we have 3x the cost
     for 1x the diversity.
   - Mitigations: (a) different temperature per strategy, (b) different
     seed for the LLM, (c) different model (cheaper for diversity, more
     expensive for the primary), (d) require N-gram divergence between
     candidates before accepting.
   - We start with (a) + (b) and measure.

2. **What's the right "good enough" threshold?**
   - Currently 3/3 pass = win. But 2/3 pass + 1 with high confidence is
     often correct in practice. We need a *calibrated* confidence model.
   - Option: use the LLM's logprobs (when available) as the confidence.
     - For providers that don't expose logprobs (Anthropic), use a
       secondary LLM call asking "how confident are you?" — a 7B call is
       cheap.

3. **Budget allocation across strategies.**
   - 8s × 3 strategies = 24s of work, but the user sees 8s + critic time.
   - For *expensive* strategies, this could blow the cost. We need a
     per-strategy budget (e.g., 2s each, 2s for critic).
   - For *cheap* strategies, the budget doesn't matter.
   - Default: 2s per strategy, 2s for critic, total 4s. Adjustable.

4. **What if a strategy is "almost done" when we commit?**
   - We cancel it, but the LLM API might still return a partial response.
   - We need to *discount* the partial response (don't use it, don't
     pay for it) — but some providers bill for input tokens even on
     cancellation.
   - Practical: a 200ms grace period before hard-cancel. If the strategy
     finishes in that grace, we get a free second candidate.

5. **Speculation at multiple levels?**
   - We currently speculate at the *turn* level (one plan, 3 strategies).
   - We could also speculate at the *step* level (one primitive task,
     3 strategies). 3x the verification, but lower per-step cost.
   - And at the *method* level (one composite task, 3 candidate methods
     from the HTN library). 3x the planning cost.
   - For v4.0 we start with turn-level. Step-level is v4.1.

6. **Speculation vs. cost-quality slider.**
   - Power users want `HUAENGINE_SPECULATION=0` (no spec, single
     conservative strategy, cheap) or `HUAENGINE_SPECULATION=3`
     (full spec, all 3 strategies, expensive but best).
   - We expose this as a session-level config.

7. **Replay & determinism.**
   - For a given (request, plan, seed, model), a strategy's output should
     be deterministic. We need a *cache*: if the same plan+seed comes in,
     return the cached result.
   - Cache key: `hash(request + plan + strategy_name + model_id + temperature)`.
   - This turns speculation into *just-in-time cache* for repeated tasks.

8. **Spectre-like safety.**
   - What if a "winner" strategy *almost* matches what the user asked
     for but introduces a subtle bug? The critics are not omniscient.
   - Mitigations: (a) require a *test* to pass for the winner to commit;
     (b) snapshot the workspace before the race and roll back if the
     user hits "undo" within 5s of the race completing.
   - v4.0 ships with (b) — a "soft undo" within 5s of any race.

9. **How do we handle LLM provider rate limits under speculation?**
   - 3 strategies × 1 LLM call each = 3x the rate. We need a *token
     bucket* per provider, shared across all in-flight strategies.
   - Implementation: a small `RateLimiter` class in
     `/root/huagent/src/llm/rate-limit.ts` that throttles.

10. **Telemetry budget.**
    - Emitting a `race_report` per turn is fine. Emitting a `race_report`
      *per step* in a long plan could spam the log. We aggregate
      race reports at the session level and emit one summary at the end.

11. **Is the 3-critic *fan-out* still useful if the user has a clear intent?**
    - For "fix this typo" tasks, 3 critics is overkill. The complexity
      classifier (in the spec stage) should downgrade to 1 critic + 1
      strategy for trivial tasks.
    - Implementation: `criticCount(complexity) = trivial ? 1 : moderate ? 2 : 3`.
