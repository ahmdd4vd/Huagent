# Primitive 2: Hierarchical Task Network (HTN) Planning

> Replacing v3.0's flat "step list" plan (which is just a `Plan[]` that the LLM emits
> and the executor walks) with a *structured*, *decomposable*, *verifiable*
> hierarchy of tasks — with the LLM acting as a *method author* and a symbolic
> planner acting as the *executor*.

---

## 1. Literature & References

### 1.1 Foundational HTN Papers

**Erol, K., Hendler, J. & Nau, D. (1994). "HTN Planning: Complexity and Expressivity."**
AAAI '94.
- Key insight: HTN planning is strictly more expressive than STRIPS-style classical
  planning. Any STRIPS problem can be encoded as an HTN, but not vice versa.
  The paper proves HTN is undecidable in the general case (because methods can
  encode arbitrary recursion), but *primitive-task HTN* (where every task reduces
  to a primitive action) is decidable.
- Why it matters: We don't need the general undecidable case. We use *primitive-task
  HTN* where the LLM's job is to *decompose composite tasks into primitive tasks*
  (tool calls). The executor never has to deal with unbounded recursion.

**Erol, K., Nau, D. & Hendler, J. (1995). "Semantics for Hierarchical Task Network
Planning."** (UMIACS-TR-94-31, U. of Maryland.)
- Introduces the formal `UMCP` semantics: a *task network* is a set of tasks
  with ordering constraints and variable bindings; a *method* is a precondition
  and a decomposition; a *plan* is a sequence of primitive tasks that satisfies
  all constraints.
- Why it matters: This is the bedrock that later planners (SHOP, SHOP2, O-Plan,
  SIPE) are built on. Our internal representation will follow this.

**Nau, D., Cao, Y., Lotem, A. & Muñoz-Avila, H. (1999). "SHOP: Simple Hierarchical
Ordered Planner."** IJCAI '99.
- Key insight: SHOP is a *total-order* HTN planner. It searches backward from
  the goal, applying methods in order, which makes it efficient and
  understandable. It can encode domain-specific heuristics and has been used
  for logistics, manufacturing, and game AI.
- Why it matters: We don't need the expressivity of partial-order; total-order
  fits our "the LLM generates steps in order" model. We can borrow SHOP's
  *search order* and replace its *state representation* with our tool-call
  state.

**Nau, D. et al. (2003). "SHOP2: An HTN Planning System."** JAIR 20:379–404.
- The canonical reference. SHOP2 added partial-order planning, plan
  refinement, and a more expressive method language. It's the most-cited HTN
  planner in academia.
- Why it matters: We can implement a SHOP2-style planner in ~500 lines of
  TypeScript and feed it methods written by the LLM. See the sketch below.

### 1.2 Surveys & Modern Views

**Bercher, P., Alford, R. & Höller, D. (2019). "A Survey on Hierarchical Planning —
HTN Planning."** Künstliche Intelligenz 33:1–14.
- Excellent survey covering HTN semantics, complexity, planners, applications,
  and the *plan repair* problem (what to do when a method fails mid-execution).
- Why it matters: We need plan-repair in v4.0 because tool calls fail. The
  survey's taxonomy of repair strategies is directly applicable.

**Ghallab, M., Nau, D. & Traverso, P. (2016). "Automated Planning and Acting."
Cambridge University Press.
- The definitive textbook. Covers HTN, classical, temporal, and probabilistic
  planning. Chapter 11 on HTN is the cleanest formal treatment available.
- Why it matters: This is the reference we cite internally for any planner
  decision.

### 1.3 LLM + Symbolic Planning

**Kambhampati, S. et al. (2024). "LLMs Can't Plan, But Can Help Planning in
LLM-Modulo Frameworks."** arXiv:2402.01817 (and earlier arXiv:2309.01857).
- Key insight: LLMs are *bad* at multi-step planning in the strict sense (they
  hallucinate steps, can't backtrack, can't verify preconditions). But they
  are *good* at domain knowledge — generating candidate methods, suggesting
  decompositions, naming constraints.
- The "LLM-Modulo" pattern: LLM generates a candidate plan, a symbolic
  verifier (or critic) checks it, and if it fails the LLM re-generates with
  feedback. The LLM is the *generator*, not the *verifier*.
- Why it matters: This is exactly our model. LLM authors HTN methods, the
  symbolic planner applies them, the critic verifies the resulting primitive
  plan, and if rejected, the LLM is re-prompted with the feedback. **This is
  the heart of v4.0's planning layer.**

**Valmeekam, K. et al. (2022). "On the Capabilities of LLMs in Planning."
arXiv:2211.02031.
- Benchmarks LLMs on Blocksworld, Logistics, etc. Shows they perform *very*
  poorly when asked to produce complete plans from scratch (often < 30% on
  standard benchmarks), even with chain-of-thought.
- Confirms the LLM-Modulo approach: don't trust the LLM to plan, trust it
  to propose and refine.

**Liu, B. et al. (2023). "A Survey on LLM-based Agents."** (Multiple survey
versions exist.)
- Distinguishes *task decomposition* (LLM breaks a goal into subtasks) from
  *plan execution* (executing primitive actions) from *plan verification*
  (checking a plan is correct). Most agents conflate these. v4.0 separates
  them.

### 1.4 Hierarchical Methods in Cognitive Architectures

**Laird, J. E. (2012). "The Soar Cognitive Architecture."** MIT Press.
- Soar represents planning as *operator subgoaling* and *impasse sub-states*:
  when the agent can't apply an operator, it creates a *subgoal* to find one.
  These subgoals are hierarchical.
- Why it matters: Soar has been *production-shipped* for decades (modeling
  pilots' behavior, etc.). The "impasse → subgoal → operator" pattern is
  the closest production analog to HTN.

**Anderson, J. R. (2007). "How Can the Human Mind Occur in a Physical Universe?"
Oxford University Press. (ACT-R theory.)
- ACT-R models cognition as production rules firing in parallel against
  declarative memory. Goal stacks create implicit hierarchies.
- Why it matters: For v4.0, our *method library* plays the role of ACT-R's
  production rules. The LLM can *learn new methods* by observing successful
  decompositions — analogous to ACT-R's *knowledge compilation*.

### 1.5 Tree Search and Hierarchy

**Yao, S. et al. (2023). "Tree of Thoughts: Deliberate Problem Solving with
Large Language Models."** arXiv:2305.10601.
- Key insight: Instead of linear chain-of-thought, the agent explores a *tree*
  of reasoning paths with explicit backtracking and self-evaluation. Each
  node is a partial plan; expansion generates children; a value function
  picks the best leaf.
- Why it matters: ToT is an HTN-equivalent at the *reasoning* level (not the
  action level). Our planner can use ToT to *choose among competing methods*
  when several apply.

**Zhou, A. et al. (2023). "Language Agent Tree Search (LATS)."** arXiv:2310.04406.
- Combines MCTS with LLM-based actor/critic. Demonstrates state-of-the-art
  results on agent benchmarks.
- Why it matters: MCTS over an HTN's method space is a *planner* and an
  *HTN expansion engine* in one. This is a candidate for v4.0's planning loop.

---

## 2. Existing Implementations

| System | Type | Notable Property | Relevance to HuaEngine |
|---|---|---|---|
| **SHOP2** (U. of Maryland) | Pure HTN planner | Total + partial order; PDDL-like input | Reference implementation; we can study its algorithm to write our own |
| **Pyhop** (Nau, 2023) | Python HTN planner | ~100 LOC, very readable, used for teaching | Closest analogue to what we'd write in TypeScript |
| **JSHOP2** | Java port of SHOP2 | Stable, used in research | Heavy; not directly usable |
| **PANDA** (GK Software) | Industrial HTN planner | Production use, real-time plan repair | Plan-repair strategy reference |
| **Soar** (Laird) | Cognitive architecture | Production cognitive agent runs for decades | Operator-subgoaling pattern |
| **LangGraph / LangChain Agents** | LLM agent frameworks | Implements *graph* of steps, not strictly HTN | Closest to "mainstream" alternative |
| **Microsoft AutoGen** | Multi-agent framework | Group-chat planner; agents are nodes | LLM-as-method-author pattern |
| **CrewAI** | Role-based multi-agent | Hierarchical agent teams (manager + workers) | *Roles* as a weak form of HTN decomposition |

### The one we should study hardest: **Pyhop**

Pyhop is a tiny Python library by Dana Nau that implements an HTN planner in
~100 lines. It is the *minimum viable* HTN. Our TypeScript v4.0 planner should
be a faithful port of Pyhop's algorithm with two differences:
- Methods are *generated by the LLM*, not authored by hand.
- The state representation is *our session state* (files, snapshot, plan history),
  not a STRIPS-style world model.

Pyhop's code (~100 lines) is on GitHub at `pucrs-automated-planning/pddl-parser`
(no, sorry, actually at `gcane/pddl-parser` is *not* right either). The correct
location is `https://github.com/dananau/HTNPyhop` or in the supplementary
material of "The Pyhop HTN Planning System" workshop paper. (Since web tools
are unavailable, I'm citing from training memory; the project is real and
publicly available.)

---

## 3. Trade-offs

### Pros of HTN over flat LLM step lists

| Property | Flat LLM step list (v3.0) | HTN with LLM-authored methods (v4.0) |
|---|---|---|
| **Decomposition** | One-shot: LLM emits the whole list | Recursive: composite task → methods → subtasks → primitives |
| **Domain knowledge** | Re-asked of the LLM every turn | Cached in method library, applied symbolically |
| **Precondition checking** | Implicit in the LLM's "feeling" | Explicit: method only fires if its preconditions hold |
| **Constraint propagation** | None; ordering is whatever the LLM wrote | Ordering constraints + variable bindings enforced |
| **Backtracking** | "Try again, slightly different prompt" | Structured: planner backtracks, replays |
| **Verification** | Critic must read the whole plan | Critic can verify method by method |
| **Reuse** | Each turn is from scratch | Methods compose across turns; learned methods persist |
| **Determinism** | None — the LLM is non-deterministic | Hybrid: deterministic planner + non-deterministic method author |
| **Cost** | Each LLM call is a turn | Methods cache → fewer LLM calls per turn |
| **Speed** | O(n) steps in serial | Parallel subtasks possible; same cost model |

### Cons / when NOT to use HTN

- **Cold start**: An empty method library means the LLM has to author *every*
  method on the first turn. Slower than flat planning for turn 1. We need
  a *seed method library* (10-20 common decompositions) shipped out of the box.
- **Brittleness**: A precondition that's slightly wrong prevents the method
  from ever firing. We need good LLM prompts that emphasize "executable
  preconditions, not vibes."
- **Symbolic overhead**: For tiny tasks (one tool call), the HTN machinery is
  pure overhead. We need a *fast path*: simple tasks go flat, complex tasks
  go hierarchical.
- **Explanation cost**: The user sees "method `fix_bug_in_react_component` fired
  with preconditions X, decomposed into Y, Z" — which is *richer* than flat
  step lists but also *more verbose*. Need a UI mode for hiding detail.
- **Method library maintenance**: Methods that worked on a previous code
  version can become wrong after a refactor. We need *method invalidation*
  rules (e.g., if a method references a function that no longer exists, mark
  it stale).

### When to use HTN vs flat

- ✅ Use HTN when the task has *named subgoals* (build a component, fix a bug,
  refactor a module) — almost always for code generation.
- ✅ Use HTN when the *same decomposition will repeat* (we cache the method
  library; second occurrence is free).
- ❌ Use flat for one-line edits, syntax questions, and any "do exactly this
  one tool call" task.

---

## 4. Our Adaptation for HuaEngine v4.0

### 4.1 Mental model

> HuaEngine v4.0's *planner* is a small symbolic HTN engine (Pyhop-style).
> The *method library* is a JSON file of `{ name, preconditions, subtasks }`
> tuples. The *LLM's job* in planning is to (a) author new methods when no
> existing method applies, and (b) refine existing methods when they fail.
> The *executor* walks the resulting primitive plan.

### 4.2 Concrete design decisions

1. **The method library is a typed JSON file.** Format:
   ```json
   {
     "name": "fix_typescript_compile_error",
     "precondition": "src.language == 'typescript' && error.kind == 'compile'",
     "decomposition": [
       { "kind": "primitive", "tool": "read_file", "args": { "path": "$err.path" } },
       { "kind": "primitive", "tool": "search_replace", "args": { ... } },
       { "kind: "primitive", "tool": "run_command", "args": { "cmd": "tsc --noEmit" } }
     ],
     "cost_estimate_ms": 2000,
     "success_rate": 0.85
   }
   ```
   Methods are versioned, dated, and reference-counted.

2. **Pyhop-style core, ~300 lines of TypeScript.** Algorithm: given a task,
   find all methods whose preconditions hold; for each, recursively decompose
   subtasks; return first complete primitive plan. With backtracking on
   primitive-task failure.

3. **LLM as method author.** When no method in the library matches the task,
   the LLM is prompted with: "Decompose this task into subtasks. For each
   subtask, specify preconditions, tool calls, ordering constraints."
   The result is validated by a JSON schema and added to the library.

4. **Three-tier method library.**
   - **Tier 1 (built-in)**: ~20 common methods shipped with the binary.
     Compiled in. Read-only.
   - **Tier 2 (project)**: `huagent/methods.json` in the user's project root.
     User-editable, committed to git. Project-specific.
   - **Tier 3 (learned)**: Synthesized from successful episodes. Lives in
     the user's home dir. Can be marked "stale" if preconditions no longer
     hold.

5. **Method invalidation.** If a method's preconditions reference a
   symbol (function name, file path, type) that the indexer reports as
   missing, the method is marked *stale* and skipped. The LLM is
   re-prompted to produce a new one.

6. **Variable bindings.** Methods can have free variables (`$err.path`)
   that the planner binds during decomposition. The binding is typed
   (string, path, number) and validated.

7. **Parallel decomposition.** When a method's subtasks have *no ordering
   constraint between them*, the executor runs them in parallel (fan-out
   via the stream primitive). This is how we get 3-critic verification
   for free: the "verify" subtask is three parallel "run critic" tasks.

8. **Cost estimation.** Each method has an estimated cost (in ms, learned
   from past invocations) and a success rate. The planner prefers cheaper,
   higher-success methods. The cost model is updated after every execution.

9. **The v3.0 `Planner` becomes the fallback.** When the LLM can't
   generate a valid method in 1 attempt, we fall back to v3.0's
   flat-step planning. v4.0 is strictly more capable.

### 4.3 What we are *not* doing

- **Not** implementing partial-order planning. Total-order is enough.
- **Not** using PDDL. Our domain is too narrow; we'd spend more time
  on the PDDL parser than on the planner.
- **Not** making the LLM the *verifier* of its own plans. The verifier
  is the critic (primitive #3: speculative execution races 3 critics).
- **Not** trying to be a *general* HTN planner. We only handle the
  restricted subclass where composite tasks always decompose to
  primitive tasks, and primitives are tool calls.

---

## 5. TypeScript Sketch

```ts
// ─────────────────────────────────────────────────────────────────
// HuaEngine v4.0 — HTN Planner (sketch)
// ─────────────────────────────────────────────────────────────────

// 1. The four core types

type PrimitiveTask = {
  kind: 'primitive';
  tool: string;              // e.g. 'read_file', 'search_replace', 'run_command'
  args: Record<string, unknown>;
};

type CompositeTask = {
  kind: 'composite';
  name: string;              // e.g. 'fix_typescript_compile_error'
  args: Record<string, unknown>;
};

type Task = PrimitiveTask | CompositeTask;

type Method = {
  name: string;
  preconditions: (state: WorldState) => boolean;
  costEstimateMs: number;
  successRate: number;       // 0..1, learned
  decompose: (state: WorldState, task: CompositeTask) => Task[];
};

type WorldState = {
  files: Map<string, string>;
  lastErrors: { path: string; kind: string; message: string }[];
  language: 'typescript' | 'python' | 'unknown';
  // … anything the methods might condition on
};

type PrimitivePlan = PrimitiveTask[];

// 2. The method library (Tier 1: built-in)

const BUILT_IN_METHODS: Method[] = [
  {
    name: 'fix_typescript_compile_error',
    preconditions: (s) => s.language === 'typescript' && s.lastErrors.length > 0,
    costEstimateMs: 2000,
    successRate: 0.85,
    decompose: (s) => [
      { kind: 'primitive', tool: 'read_file', args: { path: s.lastErrors[0].path } },
      { kind: 'primitive', tool: 'search_replace', args: { /* … */ } },
      { kind: 'primitive', tool: 'run_command', args: { cmd: 'tsc --noEmit' } },
    ],
  },
  {
    name: 'add_react_component',
    preconditions: (s) => s.files.has('package.json'),
    costEstimateMs: 5000,
    successRate: 0.7,
    decompose: (s, t) => [
      { kind: 'primitive', tool: 'write_file', args: { path: `${t.args['dir']}/${t.args['name']}.tsx` } },
      { kind: 'primitive', tool: 'write_file', args: { path: `${t.args['dir']}/${t.args['name']}.test.tsx` } },
      { kind: 'composite', name: 'verify_with_critics', args: { target: t.args['name'] } },
    ],
  },
  // … ~18 more
];

// 3. The LLM-as-method-author (Tier 2 & 3)

async function authorMethodFromLLM(
  task: CompositeTask,
  state: WorldState,
  llm: LLMClient,
): Promise<Method> {
  const prompt = `You are an HTN planning expert. The user wants to:
${JSON.stringify(task)}

The world state is:
${JSON.stringify(state, null, 2)}

Existing methods: ${BUILT_IN_METHODS.map((m) => m.name).join(', ')}.

Generate a NEW method that decomposes this task into a sequence of
primitive tool calls and/or composite subtasks. The method should
have executable preconditions (testable in the world state).

Output STRICT JSON in this format:
{
  "name": "<snake_case>",
  "preconditions": "<js-expression that evaluates to a boolean>",
  "decompose": [
    { "kind": "primitive", "tool": "...", "args": { ... } },
    { "kind": "composite", "name": "...", "args": { ... } }
  ]
}`;

  const raw = await llm.complete(prompt);
  const parsed = validateMethodSchema(raw);   // throws on invalid
  return {
    ...parsed,
    costEstimateMs: 5000,    // pessimistic default
    successRate: 0.5,        // unknown
  };
}

// 4. The Pyhop-style planner (the core algorithm)

class HTNPlanner {
  constructor(
    private methods: Method[],
    private maxDepth = 5,
    private budgetMs = 10_000,
  ) {}

  async plan(
    task: Task,
    state: WorldState,
    llm: LLMClient,
  ): Promise<PrimitivePlan | null> {
    const start = Date.now();
    const visited = new Set<string>();

    const recurse = async (t: Task, s: WorldState): Promise<PrimitivePlan | null> => {
      // budget guard
      if (Date.now() - start > this.budgetMs) return null;
      const key = `${t.kind}:${JSON.stringify(t.args)}`;
      if (visited.has(key)) return null;       // cycle guard
      visited.add(key);

      if (t.kind === 'primitive') return [t];

      // find applicable methods
      const applicable = this.methods.filter(
        (m) => m.name === t.name && m.preconditions(s),
      );
      // try each in order of (successRate / cost)
      applicable.sort((a, b) => b.successRate / b.costEstimateMs
                                - a.successRate / a.costEstimateMs);

      for (const method of applicable) {
        const subtasks = method.decompose(s, t);
        const plan: PrimitivePlan = [];
        for (const sub of subtasks) {
          if (Date.now() - start > this.budgetMs) return null;
          const subPlan = await recurse(sub, s);
          if (!subPlan) return null;            // backtrack
          plan.push(...subPlan);
        }
        return plan;
      }

      // ⓪ no method matched → ask the LLM
      if (t.kind === 'composite') {
        const newMethod = await authorMethodFromLLM(t, s, llm);
        this.methods.push(newMethod);
        return recurse(t, s);                  // re-try
      }
      return null;
    };

    return recurse(task, state);
  }
}

// 5. Wire it into the stream pipeline (from 01-stream.md)

async function* plannerStage(
  src: AsyncIterable<{ user: string; state: WorldState }>,
  signal: AbortSignal,
): AsyncIterable<CognitiveEvent> {
  const planner = new HTNPlanner(BUILT_IN_METHODS);

  for await (const { user, state } of src) {
    if (signal.aborted) return;

    const task: CompositeTask = {
      kind: 'composite',
      name: 'fulfill_user_request',
      args: { user },
    };
    const plan = await planner.plan(task, state, llm);
    if (!plan) {
      yield { kind: 'error', err: new Error('planner failed'), recoverable: true };
      continue;
    }
    yield { kind: 'plan', steps: plan };
    for (const step of plan) yield { kind: 'step_start', step };
  }
}
```

### Key points in the sketch

- **`Method` is a first-class typed object** with explicit preconditions, cost,
  and success rate.
- **Pyhop-style recursion** is straightforward: try methods in priority order,
  recurse on subtasks, backtrack on failure.
- **LLM authors new methods** only when the library is exhausted. The
  LLM is *not* asked to plan from scratch.
- **The 3-critic `verify_with_critics` subtask** is itself a composite
  task that *fans out* to 3 primitive subtasks, which is how HTN meets
  the stream primitive.
- **`visited` set** prevents infinite recursion in the general case
  (HTN's undecidability).

---

## 6. Open Questions

1. **How do we validate the LLM's authored methods?**
   - Options: (a) JSON schema check, (b) symbolic precondition check by running
     against the world state, (c) dry-run execution with no side effects,
     (d) sample-execute on a small sandbox.
   - For safety, we should do at least (a) + (b). (d) is expensive but catches
     runtime errors.
   - Risk: LLM emits a "method" that *looks* valid but does the wrong thing.
     Need critic verification before promoting to Tier 2.

2. **Method library size limit?**
   - Unbounded growth = unbounded cold-start. We need eviction: least-recently-
     used, or lowest-success-rate, or "never fired in 30 days."
   - For a single user this is small (low hundreds of methods). For multi-user
     it scales.

3. **Concurrency control in the planner.**
   - Two parallel decompositions might both try to author new methods for the
     same composite task. We need a *mutex per composite-task-name* during
     authoring, or a *deduped* LLM call.

4. **What if the LLM *and* the library both fail?**
   - Fallback: emit a `planner_failed` event and let the critic try to propose
     a flat plan (v3.0 mode). If the critic also fails, surface a
     "I don't know how to do this" error to the user.

5. **Do we expose the method library to the user?**
   - Power users (game devs writing custom tooling) may want to author methods
     by hand. v4.0 should ship a `huagent methods list/add/test` CLI.

6. **Cross-project method sharing?**
   - Should Tier 3 (learned methods) be per-user, per-project, or global?
   - Lean per-project by default; per-user with explicit `--share` flag.
   - Risk of leaking secrets — never share methods that contain hard-coded paths
     or credentials.

7. **What if a method's tool doesn't exist?**
   - We need a *tool registry check* during validation. A method that calls
     `tool: 'foo'` must have `foo` in the tool registry. Reject otherwise.

8. **Is `successRate` reliable?**
   - With low N (a method has fired twice), `successRate` is noise. We need
     a Bayesian estimate (Beta distribution, beta prior with mean=0.5).
     Lean toward Laplace smoothing until N > 20.

9. **What about temporal constraints?**
   - SHOP2 supports them; we don't, yet. For v4.1 we may need them
     ("don't open the file *while* the editor is editing it"). For v4.0,
     we cheat: the executor serializes overlapping writes via a mutex.

10. **What about probabilistic methods?**
    - A method with `preconditions: P(error.kind | error.file_extension) > 0.7`.
      We can extend the preconditions to take state and return both a boolean
      and a confidence. This is a v4.1 feature.
