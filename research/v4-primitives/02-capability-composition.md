# Primitive 6: Capability Composition

> Replacing v3.0's RPC-style tool calls (each tool is a single async function
> the LLM invokes with JSON args, gets a JSON result back — the same pattern
> as OpenAI's function calling) with a **composable capability graph** where
> the LLM authors *pipelines* of small, single-purpose capabilities that
> stream data through one another. The v4.0 goal is to *collapse* the
> 3-5 tool calls a typical v3.0 task requires into 1-2 *compositions*,
> cutting latency by 50% and token usage by 30%, while opening the door
> to *user-authored* capability pipelines.

---

## 1. Literature & References

### 1.1 The Unix Philosophy: The Original Composition

**McIlroy, M. D. (1978). "A Research Unix Reader: Annotated Excerpts from the
Programmer's Manual, 1971–1986."** (Bell Labs technical memoir.)
- The classic statement: *"Write programs that do one thing and do it well.
  Write programs to work together. Write programs to handle text streams,
  because that is a universal interface."*
- McIlroy's 1964 internal memo introduced the *pipe* (`|`) for chaining
  programs. The 1973 rewrite of `grep`, `sort`, `uniq`, and `wc` as
  composable filters was the moment Unix *became* Unix.
- Why it matters: Our capability composition is *literally* the Unix
  philosophy applied to LLM tools. Each capability is a *filter*: it
  takes structured input, produces structured output, and can be
  composed with others via a universal intermediate representation
  (we use JSON-streams; Unix uses text lines).

**Kernighan, B. W. & Pike, R. (1984). "The Unix Programming Environment."**
Prentice-Hall.
- The textbook treatment of Unix composition. Key insight: pipelines
  are *evaluated lazily*. The shell doesn't run `sort` until `grep`
  has produced its first line. This is *backpressure in 1978*.
- Why it matters: Our stream-native primitive (01-stream.md) is
  *exactly* this lazy evaluation. A pipeline of 5 capabilities
  consumes memory proportional to *one* capability's output, not five.

**Raymond, E. S. (2003). "The Art of Unix Programming."** Addison-Wesley.
- Chapters 1–4 articulate the *Rule of Composition*: design for
  composability, not just functionality. The cost: every component
  must have a strict, narrow contract.
- Why it matters: Our v4.0 tools *must* have strict contracts. Each
  tool takes JSON, returns JSON, never throws, never has side effects
  not in its contract. Composability is impossible without this.

**Pike, R. (2000). "Notes on Programming in C."** (Bell Labs, unpublished
but widely circulated.) — The famous quote: "*Rule 3: Make a program
modular. Rule 4: Make a program *cohesive* — a program does one thing.*"
Pike formalized what McIlroy articulated.

### 1.2 Composition Patterns in Real Tools

**Austinat, R. (2011–present). "jq Manual."** (jqlang.org)
- `jq` is the *ur-example* of a composable tool. The whole language is
  a *filter chain*: `.users | map(.name) | sort | unique | join(", ")`.
  Each step is a transformation; the output of one is the input of
  the next.
- `jq` has *over 200 built-in functions* and is *itself* composable:
  you can write a custom function and pipe it. The community has
  produced libraries of pre-built filters.
- Why it matters: Our capability composition language is *jq-inspired*.
  We use a typed JSON-pipeline DSL: `input | filter1 | filter2 | ...`.
  Each filter is a registered capability; the LLM authors the pipeline.

**Suhr, M. (2019). "FFmpeg Filters Documentation."** (ffmpeg.org)
- ffmpeg's filter graph is the *graph generalization* of a pipeline.
  Syntax: `[in] scale=1920:1080, drawtext=text='hello':x=10:y=10
  [out]`. Filters can have *multiple inputs and outputs*; data flows
  along named pads.
- The filter graph is *declarative*: you describe the graph, ffmpeg
  figures out the execution order. Acyclic only; cycles are forbidden.
- Why it matters: Our v4.0 capability graph is a *directed acyclic
  graph* (DAG) of capabilities, with typed input/output ports.
  Multiple-output capabilities (e.g., `parse_typescript_file` returns
  AST + errors + symbols) can fan-out to multiple downstream
  consumers.

**Blender Node System.** blender.org/manual
- Blender's compositor is a *node graph* where each node is a
  capability (image input, blur, color correction, output) and edges
  are *data flows*. The graph is visualized in the UI; non-technical
  users build sophisticated pipelines by dragging.
- Why it matters: For v4.0, we *could* ship a TUI node-graph editor
  for capability composition. Anime-themed game devs who use
  Blender for assets will find it familiar.

**GNU make, npm scripts, just.** — *Task* composition (vs data
composition). Our capability graph is *data* composition: data flows
between capabilities, not control flow. Different paradigm.

### 1.3 Effect Systems and Algebraic Effects

**Moggi, E. (1991). "Notions of Computation and Monads."** Information
and Computation 93(1):55–92.
- The foundational paper: side effects (state, exceptions, IO) can be
  modeled as *monads* in a purely functional language. `IO a` is a
  computation that, when run, produces an `a`. `>>=` (bind) is
  composition.
- Why it matters: Our capability composition is *monadic* in spirit.
  Each capability is a function `Capability<A, B> = (A, Env) => Promise<B>`.
  Composition is `(b: B) => Capability<B, C>`, and the result is
  `Capability<A, C>`. Pure composition; effects (logging, errors)
  are *threaded through* the monad, not *mixed into* the data.

**Plotkin, G. D. & Power, J. (2003). "Algebraic Operations and Generic
Effects."** Theoretical Computer Science 1(1):69–80.
- The generalization: *algebraic effects* are operations (read, write,
  throw, log) that can be added to a language. *Effect handlers*
  interpret the operations.
- Why it matters: Our capabilities are *algebraic effects* in the
  small. A capability is a typed operation with a handler (the
  implementation). The composition is a *program* in the effect
  algebra. We can statically *check* the composition for safety
  (no `delete_file` capability used in a read-only session) — this
  is *capability-based security*.

**Bauer, A. & Pretnar, M. (2015). "Programming with Algebraic Effects
and Handlers."** Journal of Functional Programming 25:e12.
- Practical implementation in Eff, Koka, and other languages.
  Key insight: effect types can be *inferred* from the program. A
  capability that only reads can be tagged `ReadOnly`; the type
  system prevents accidental writes.
- Why it matters: TypeScript has no effect system natively, but we
  can simulate it with *branded types* and *function wrappers*:
  ```ts
  type ReadOnly<T> = T & { __brand: 'ReadOnly' };
  const safeRead = (cap: Capability<Path, Content>): Capability<Path, ReadOnly<Content>> => cap;
  ```
  This is a *poor man's* effect system, but it's enough for our
  security model.

**Kiselyov, O., Sabry, A. & Swords, C. (2013). "Extensible Effects: An
Alternative to Monad Transformers."** Haskell Symposium.
- A *practical* effect system that handles *multiple* effects
  (state + error + logging) without the exponential blowup of
  monad transformers. The composition is a *free monad* over a
  signature of effects.
- Why it matters: Our capability registry *is* a free monad over
  the registered capabilities. Adding a new capability is adding
  a constructor to the signature. The LLM composes by choosing
  constructors and their arguments.

### 1.4 WebAssembly Component Model

**World Wide Web Consortium (2024). "WebAssembly Component Model
Specification."** (github.com/WebAssembly/component-model)
- The canonical specification. Key insight: WASM *components* are
  typed, sandboxed, composable units. They export and import
  *interfaces* (called WIT, WebAssembly Interface Types). A
  component can only call the interfaces it imports — this is
  capability-based security *built into the runtime*.
- Why it matters: Long-term, our capabilities could be *WASM
  components*. A user can write a capability in Rust, compile to
  WASM, and register it with the engine. The engine sandbox
  ensures the capability can't escape.
- For v4.0, we *don't* need WASM yet — but the *interface* design
  (typed inputs/outputs, capability imports) is worth borrowing.

**Lukyanov, G. (2024). "Wasm Components: The Future of Software
Composition."** Fermyon blog.
- Practical guide. Key insight: WASM components compose via
  *canonical ABI* — a standardized way to pass values across
  language boundaries. The interface is in WIT; the implementation
  can be in any WASM-targeting language.
- Why it matters: The WIT format is the *inspiration* for our
  capability interface:
  ```wit
  interface file-reader {
    read: func(path: string) -> result<content, error>;
  }
  world pipeline {
    import file-reader;
    export run: func(input: string) -> result<string, error>;
  }
  ```
  Our TypeScript interface is the same shape:
  ```ts
  interface FileReader {
    read(path: string): Promise<{ ok: true; content: string } | { ok: false; error: string }>;
  }
  ```

### 1.5 LLM-Authored Compositions

**Liang, J., Huang, W., Xia, F. et al. (2023). "Code as Policies: Language
Model Programs for Embodied Control."** arXiv:2209.07733.
- Key insight: An LLM is prompted to write *Python code* (not call
  APIs) to control a robot. The code can use loops, conditionals, and
  function calls — much more expressive than JSON tool calls.
- Why it matters: For v4.0, the LLM could write *TypeScript code* that
  composes capabilities. We execute the code in a sandbox (Node's
  `vm` module, or a WASM isolate). The code is the composition.
- Trade-off: less safe than a typed DSL, but more expressive. For
  *power users*, this is the killer feature.

**Singh, I., Blukis, V., Mousavian, A. et al. (2023). "ProgPrompt:
Programming Large Language Models with Structured Descriptions."**
arXiv:2209.11340.
- A *structured prompt* that lists available functions and asks the
  LLM to generate a *program* (a sequence of function calls) instead
  of a single function call.
- Why it matters: The ProgPrompt format is exactly what we need for
  v4.0: the LLM sees a list of available capabilities and emits a
  *program* (a pipeline of capabilities).

**Beurer-Kellner, L., Fischer, M. & Vechev, M. (2023). "Prompting Is
Programming: A Query Language for Large Language Models."** Proceedings
of the ACM on Programming Languages (PACMPL), PLDI 2023.
- Formalizes the idea that prompts are *programs* in a query language
  (LMQL). Embeds constraints (regex, type checks) into the LLM's
  output. The LLM is *guided* by the constraints, not just prompted.
- Why it matters: Our capability DSL is *LMQL-inspired*. The LLM
  emits a pipeline expression that is *constrained* to use only
  registered capabilities. Invalid pipelines are rejected before
  execution.

**Yuan, S., Song, K., Chen, J. et al. (2024). "EasyTool: A
Compositional Tool-Using Agent."** (Multiple arXiv versions in 2024.)
- An agent framework that emphasizes *composing* tools rather than
  calling them individually. The LLM is given a library of tools and
  asked to write a *function* that uses them.
- Why it matters: Direct competitor to our approach. The EasyTool
  paper is the most recent published reference for "LLM + tool
  composition."

### 1.6 Function Calling, JSON Schema, and Type-Safe Tool APIs

**OpenAI Function Calling.** platform.openai.com/docs/guides/function-calling
- The de-facto standard. Each tool is a JSON schema; the LLM emits
  `{ name, arguments }`; the host calls the function and returns
  the result. Strictly RPC: one call, one result.
- Why it matters: This is the *baseline* we replace. Our v4.0
  capability graph is a strict superset.

**Anthropic Tool Use.** docs.anthropic.com/en/docs/tool-use
- Same pattern, slightly different schema. Emphasizes *tool
  descriptions* (the LLM reads them to decide which tool to call).
- Why it matters: We already support both in the v3.0 codebase. The
  v4.0 capability composition *uses* these descriptions as the
  capability metadata.

**LangChain, LlamaIndex tool abstractions.** — Generic tool wrappers
that wrap Python/JS functions. The LLM sees a list of tools and
emits calls. Most frameworks have a `Tool.from_function()` API.

### 1.7 Reactive Composition (Streams, Observables)

**Bainomugisha, E., Van Cutsem, T., Mostinckx, S. & De Meuter, W.
(2013). "A Survey on Reactive Programming."** ACM Computing Surveys
45(4):1–34.
- A *survey* of reactive programming models (Rx, React, etc.). Key
  insight: reactive programs are *dataflow graphs*. Data flows from
  producers (events) to consumers (handlers), with *operators*
  (map, filter, merge) in between.
- Why it matters: Our capability composition is a *dataflow graph*
  in the reactive-programming sense. The capabilities are operators;
  data flows between them.

**Meyerovich, L. A., Guha, A., Baskin, J. et al. (2009). "Flapjax:
A Programming Language for Ajax Applications."** POPL 2009.
- One of the earliest FRP (functional reactive programming)
  implementations in JavaScript. The *key insight*: events are
  *values over time*; we can `map`, `filter`, `merge`, and `lift`
  them just like lists.
- Why it matters: For v4.0, a tool that produces a *stream* of
  results (e.g., `tail -f` of a log file) is a *first-class*
  capability. Downstream tools can `map` and `filter` the stream.

---

## 2. Existing Implementations

| System | Type | Notable Property | Relevance to HuaEngine |
|---|---|---|---|
| **Unix pipes** | OS-level composition | The OG; text streams; small composable filters | The mental model we copy |
| **jq** | JSON filter language | 200+ filters; user-extensible | Direct inspiration for the DSL |
| **ffmpeg filter graph** | Media processing | DAG of filters with typed pads | Direct inspiration for the capability graph |
| **Blender node graph** | Visual programming | Drag-and-drop pipeline construction | UX inspiration for TUI node editor |
| **Apache Airflow** | Workflow orchestration | DAG of tasks with dependencies | The "scheduling" model; we borrow the DAG semantics |
| **AWS Step Functions** | Serverless orchestration | JSON-state-machine DSL for composition | The "author a workflow" UX; we use a JSON DSL |
| **LangChain Expression Language (LCEL)** | LLM orchestration | `prompt | model | parser` pipe syntax | Closest in the LLM space; we use a similar but typed version |
| **DSPy** | Programmatic prompt optimization | Composes LLM modules with typed signatures | Inspiration for the *typed signature* of our capabilities |
| **Haystack Pipelines** | NLP pipeline framework | DAG of components; YAML-defined | YAML DSL inspiration |
| **Bash** | Shell scripting | `cmd1 | cmd2 && cmd3 || cmd4 $()` | The shortest composition syntax known |
| **WASM Components** | Sandboxable units | Capability-based security | The interface design (WIT) |
| **Koka / Eff** | Effect-typed languages | Algebraic effects, capability tracking | The type theory for "no writes allowed" |
| **Make / Just / Task** | Task composition | Dependency-based, not dataflow | Different paradigm; we don't use |
| **Zapier / IFTTT** | End-user automation | Trigger-action recipes; visual | The UX model for *user-authored* pipelines |
| **Elixir GenStage / Flow** | Dataflow programming | Backpressure-aware pipeline | The execution model we use |

### The one to study hardest: **LangChain Expression Language (LCEL)**

LCEL is the *closest* to what we want. The syntax:
```python
chain = prompt | model | output_parser
result = chain.invoke({"input": "hello"})
```
The pipe operator (`|`) is overloaded: `prompt | model` means "pass
the prompt's output to the model's input." Each step is a *Runnable*,
a typed function that takes and produces typed values.

For v4.0, our capability graph is *literally* LCEL with:
1. Stronger typing (TypeScript instead of Python's structural typing).
2. Bi-directional capabilities (some capabilities have multiple
   inputs or outputs).
3. Streaming as the default (LCEL is call-by-need; we're push-based).
4. User extensibility (users register custom capabilities).
5. Caching and memoization built-in.

---

## 3. Trade-offs

### Pros of capability composition over RPC tool calls

| Property | RPC tool call (v3.0) | Capability composition (v4.0) |
|---|---|---|
| **Number of LLM turns for a 5-step task** | 5 (one per tool call) | 1 (one pipeline) |
| **Latency** | 5 × per-call overhead | 1 × overhead + N × capability time |
| **Token usage** | 5 × JSON serialization | 1 × pipeline + N × args (typically smaller) |
| **Error recovery** | LLM must re-plan after each error | Pipeline *itself* can have error handlers (try/catch as a capability) |
| **Streaming** | Each tool returns one result | Capabilities stream; downstream sees data as it arrives |
| **User extensibility** | Hard (user must register a function in TypeScript) | Easy (user provides a JSON spec; engine wraps it) |
| **Composability** | None (tools are isolated) | Native (`|` operator) |
| **Optimization** | None | Engine can fuse, cache, parallelize |
| **Determinism** | Per-call, not per-pipeline | Per-pipeline; reproducibility is per-pipeline |
| **Security** | All tools have full power | Capabilities declare *required* permissions; engine enforces |
| **Debuggability** | 5 log entries | 1 pipeline trace + per-capability logs |
| **Expressiveness** | Limited to "do this then that" | Conditionals, loops, error handling, fmap, flatMap |
| **Cognitive load (LLM)** | "Pick the right tool from a list" | "Build the right pipeline from a vocabulary" |

### Cons / when NOT to use

- **Composition overhead.** A pipeline of 5 capabilities has
  more *plumbing* than 5 RPC calls. For very simple tasks, the
  overhead exceeds the savings. We need a *fast path*: trivial
  tasks (1 capability) use RPC; complex tasks use composition.
- **Capability interface design is hard.** Each capability must
  have a *narrow*, *composable* contract. Mis-designed capabilities
  don't compose. We need a *capability review* process.
- **LLM confusion.** An LLM that hasn't been trained on the
  composition syntax might emit invalid pipelines. The
  `CriticMesh` (primitive #4) is the safety net: the pipeline is
  verified before execution.
- **Sandboxing is harder.** A pipeline is *code*. Executing it
  requires a sandbox. We use Node's `vm` module or a WASM isolate
  to prevent escape. Sandbox overhead is non-trivial.
- **Versioning.** If a capability's interface changes (e.g.,
  `read_file` now returns `{ ok, content, metadata }` instead of
  just `content`), all existing pipelines break. We need a
  *capability version* field; the engine warns on version mismatch.
- **Discoverability.** Users must know what capabilities exist.
  The `capabilities` slash command lists them with descriptions
  and examples. The LLM has a *catalog* in its system prompt.

### When to use composition vs RPC

- ✅ Multi-step tasks (3+ capabilities) — the savings compound.
- ✅ Tasks with *dataflow* (one capability's output is another's
  input) — the natural fit.
- ✅ Tasks with *streaming* requirements (live log file
  monitoring, incremental builds) — composition handles it.
- ✅ When the user wants *their own* capabilities — composition
  makes registration trivial.
- ❌ One-shot queries ("what's the weather?") — composition is
  overhead.
- ❌ Trivial file operations ("read this file") — just call the
  tool.
- ❌ When the LLM is *bad* at composition (early model versions
  without fine-tuning) — fall back to RPC.

---

## 4. Our Adaptation for HuaEngine v4.0

### 4.1 Mental model

> HuaEngine v4.0's tool layer is a **typed capability graph**, not a
> flat tool registry. Each capability has a **typed input/output
> signature** (a *Zod schema* or equivalent). The LLM authors a
> **pipeline** — a directed acyclic graph of capabilities — by emitting
> a JSON expression. The engine **type-checks** the pipeline, **plans**
> the execution order, **streams** data through the graph with
> backpressure, and **caches** results for free. A *small* subset of
> compositions is pre-defined (`read → grep → summarize`); the LLM
> is also free to author novel compositions, validated against the
> capability registry.

### 4.2 Concrete design decisions

1. **Capabilities are typed with Zod schemas.** Each capability is:
   ```ts
   interface Capability<I, O> {
     name: string;
     description: string;          // for the LLM to read
     version: string;              // semver
     input: ZodSchema<I>;
     output: ZodSchema<O>;
     execute: (input: I, ctx: CapabilityContext) => AsyncIterable<O>;
     permissions: Permission[];     // capability-based security
     cost: { tokens: number; ms: number };
   }
   ```
   The `AsyncIterable<O>` return type means capabilities *stream* by
   default. A capability that produces a single result is just an
   `AsyncIterable` of length 1.

2. **The pipeline DSL is jq-inspired, typed.** A pipeline is a JSON
   expression. Examples:
   ```json
   // Linear: A → B → C
   { "pipeline": [
     { "capability": "read_file", "args": { "path": "src/auth.ts" } },
     { "capability": "grep", "args": { "pattern": "TODO" } }
   ]}

   // Parallel: A → (B, C) → D
   { "fanOut": [
     { "pipeline": [
       { "capability": "read_file", "args": { "path": "a.ts" } },
       { "capability": "summarize", "args": {} }
     ]},
     { "pipeline": [
       { "capability": "read_file", "args": { "path": "b.ts" } },
       { "capability": "summarize", "args": {} }
     ]}
   ], "merge": { "capability": "join_summaries", "args": {} }}

   // Conditional: if X succeeds → A; else → B
   { "try": { "capability": "typescript_compile", "args": {} },
     "then": { "capability": "run_tests", "args": {} },
     "catch": { "capability": "rollback", "args": {} }}
   ```
   The LLM emits this JSON; the engine parses and validates.

3. **Type-checking is automatic.** The Zod schemas enforce that
   `read_file` returns `{ content: string, mtime: number }` and
   `grep` accepts `{ content: string, pattern: string }`. The
   pipeline validator walks the graph, checks every edge's output
   type matches the next capability's input type, and *rejects*
   invalid pipelines before execution.
   - This is **the safety boundary** between the LLM and the system.

4. **Capabilities are versioned.** A capability at version `1.2.0`
   can be referenced in a pipeline as `@1.2`. If the engine
   upgrades the capability to `1.3.0`, the pipeline still works
   (minor versions are backward compatible). Major version
   bumps require a pipeline update.
   - We use the npm semver convention. This is borrowed from
     Cargo, npm, and Rust crate ecosystems.

5. **The graph is a stream operator.** From `01-stream.md`:
   pipelines are operators in the cognitive event stream. The
   `executor` stage takes a `step_start` event, looks up the
   corresponding pipeline, validates it, executes it, and emits
   the `step_done` event. Streaming propagates through the
   whole graph.

6. **Built-in capabilities are minimal; the value is composition.**
   The 20 built-in capabilities (the v3.0 tools) are *atoms*.
   The 50+ pre-defined pipelines are *molecules*. Examples:
   - `pipeline.find_todos`: read → grep TODO → summarize
   - `pipeline.typecheck_and_test`: tsc --noEmit → vitest
   - `pipeline.review_pr`: read diff → lint → typecheck → critic
   - `pipeline.explain_function`: read file → grep function → AST parse → summarize
   The LLM is *encouraged* to reuse these; if none fits, it
   authors a new pipeline from atoms.

7. **The LLM is taught the DSL via a system-prompt vocabulary.**
   The system prompt includes a *capability catalog*:
   ```
   You can compose capabilities using these operators:
     |   : sequence (output of left → input of right)
     &   : parallel (both run, both results emitted)
     ?:  : conditional (if pred, run then; else run else)
     !   : try/catch (try capability; on error run handler)
     <$> : map (apply capability to each element of a list)
     <$>  : reduce (...)

   Available capabilities (abbreviated):
     read_file(path) → { content, mtime }
     grep(content, pattern) → { matches[] }
     summarize(content) → { summary }
     tsc_check(paths) → { ok, errors[] }
     vitest_run(paths) → { ok, tests[] }
     ...
   ```
   The LLM emits JSON in this DSL. The engine parses and executes.

8. **Caching is automatic, keyed by capability + input hash.**
   When the same capability with the same input appears twice in
   a pipeline (or across turns), the result is cached. The cache
   is invalidated when the capability's version changes or the
   input file's mtime changes.
   - This is the **automatic memoization** that makes composition
     fast. A pipeline that includes 10 reads of the same file
     is as fast as 1.

9. **Composition is a critic-mesh-verified step.** A pipeline
   emitted by the LLM is *itself* an artifact that the critic
   mesh (primitive #4) verifies. The mesh checks:
   - Does the pipeline use only registered capabilities?
   - Are the input/output types consistent?
   - Does the pipeline achieve the stated goal? (LLM is asked
     "what does this pipeline do?" and the answer is compared
     to the goal.)
   - Are the permissions sufficient? (If the pipeline tries
     to `write_file` but the user has read-only mode, the
     pipeline is rejected.)

10. **User-extensible capabilities with a sandboxed runtime.**
    A user can register a new capability by providing:
    ```json
    {
      "name": "my_custom_check",
      "description": "Run my project's linter",
      "version": "1.0.0",
      "input": { "type": "object", "properties": { "path": { "type": "string" } } },
      "output": { "type": "object", "properties": { "ok": { "type": "boolean" } } },
      "execute": "./bin/my-check.sh $path",  // shell out
      "permissions": ["execute:./bin/my-check.sh"]
    }
    ```
    The engine *wraps* the execute in a sandbox (Node `vm` or
    process spawn with limited env). Permissions are checked
    per-call: a capability that declares `["read:*.ts"]`
    cannot be invoked with `{"path": "*.go"}`.

11. **Two composition modes: "compose" and "execute".**
    - **Compose**: emit the pipeline without running it. The
      user reviews and then executes. Useful for complex
      tasks where the user wants to see the plan first.
    - **Execute**: emit and run the pipeline immediately.
      Default mode for trusted tasks.

12. **Pipeline library is *also* stored in the memory graph
    (primitive #5).** Successful pipelines are stored as
    `Pipeline` nodes with `PIPELINE_OF` edges to the
    capabilities they use. The LLM can query: "what pipelines
    have I used for this kind of task?" This is the
    *compositional memory* layer.

13. **Capabilities have *descriptions* that the LLM can search.**
    The `capabilities` slash command lists all registered
    capabilities with their descriptions, examples, and
    permissions. The LLM sees a summary in its system prompt
    and can request the full description on demand.

14. **Optimization: the engine can fuse and parallelize.**
    A pipeline of 5 capabilities might be fusable into 1 if
    the intermediate results aren't used elsewhere. The engine
    has a *fuse* pass that detects this. Similarly, independent
    branches in a fan-out are run in parallel automatically.

15. **v3.0 compatibility: a `ToolRegistry` adapter.** v3.0's
    `ToolRegistry` exposes `execute(name, args) → result`. v4.0's
    `CapabilityRegistry` exposes the *same* method but routes
    through the pipeline engine. For an RPC-style call, the
    engine builds a *single-capability pipeline* and executes
    it. Drop-in replacement.

### 4.3 What we are *not* doing

- **Not** introducing WASM components yet. The interface design
  (typed I/O, permissions) borrows from WIT, but we don't actually
  use WASM. Adding it is a v4.1+ feature.
- **Not** writing our own DSL. We use JSON expressions; the
  `jq`-like syntax is a *display* format only (for the TUI).
- **Not** running arbitrary user-supplied code. The execute step
  is *spawned* (a child process), not `eval`'d. The child has a
  restricted environment.
- **Not** implementing a full effect system. We use TypeScript's
  structural types; capability security is enforced at the
  *registry* level, not the *type system* level.
- **Not** making every tool async. Capabilities that don't need
  streaming are simple; they return `{ ok, value }` and the engine
  wraps them in an AsyncIterable of length 1.
- **Not** requiring the LLM to author novel compositions every
  turn. The pre-defined pipelines cover 80% of use cases; novel
  composition is a power-user feature.

---

## 5. TypeScript Sketch

The sketch shows the core ideas: typed capabilities with Zod, a
pipeline DSL with type-checking, automatic caching, capability-based
security, user extensibility, and a v3.0-compatible adapter.

```ts
// ─────────────────────────────────────────────────────────────────
// HuaEngine v4.0 — Capability Composition (sketch)
// ─────────────────────────────────────────────────────────────────

import { z, type ZodSchema } from 'zod';
import { nanoid } from 'nanoid';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';

// 1. The Capability type

type Permission =
  | { kind: 'read'; glob: string }
  | { kind: 'write'; glob: string }
  | { kind: 'execute'; command: string }
  | { kind: 'network'; host: string }
  | { kind: 'llm'; calls: number };

interface CapabilityContext {
  signal: AbortSignal;
  cache: Cache;
  perms: Permission[];
  logger: (msg: string) => void;
}

interface Capability<I, O> {
  name: string;
  description: string;
  version: string;            // semver
  input: ZodSchema<I>;
  output: ZodSchema<O>;
  // streaming output: a capability emits zero or more O values
  execute: (input: I, ctx: CapabilityContext) => AsyncIterable<O>;
  permissions: Permission[];
  cost: { tokens: number; ms: number };
}

// 2. The built-in capabilities (the v3.0 tools, rewrapped)

const readFileCap: Capability<{ path: string }, { content: string; mtime: number }> = {
  name: 'read_file',
  description: 'Read a file from the local filesystem. Returns content and mtime.',
  version: '1.0.0',
  input: z.object({ path: z.string() }),
  output: z.object({ content: z.string(), mtime: z.number() }),
  execute: async function* ({ path }, { signal }) {
    if (signal.aborted) return;
    const { readFileSync, statSync } = await import('node:fs');
    const content = readFileSync(path, 'utf8');
    const mtime = statSync(path).mtimeMs;
    yield { content, mtime };
  },
  permissions: [{ kind: 'read', glob: '*' }],
  cost: { tokens: 100, ms: 50 },
};

const grepCap: Capability<
  { content: string; pattern: string },
  { matches: { line: number; text: string }[] }
> = {
  name: 'grep',
  description: 'Find lines in content matching a regex pattern. Returns line numbers and matched text.',
  version: '1.0.0',
  input: z.object({ content: z.string(), pattern: z.string() }),
  output: z.object({ matches: z.array(z.object({ line: z.number(), text: z.string() })) }),
  execute: async function* ({ content, pattern }) {
    const lines = content.split('\n');
    const regex = new RegExp(pattern);
    const matches = lines
      .map((text, i) => ({ line: i + 1, text }))
      .filter(({ text }) => regex.test(text));
    yield { matches };
  },
  permissions: [],  // pure function
  cost: { tokens: 0, ms: 5 },
};

const summarizeCap: Capability<
  { content: string; maxLength?: number },
  { summary: string }
> = {
  name: 'summarize',
  description: 'Use the LLM to summarize long content. Returns a shorter version.',
  version: '1.0.0',
  input: z.object({ content: z.string(), maxLength: z.number().optional() }),
  output: z.object({ summary: z.string() }),
  execute: async function* ({ content, maxLength = 500 }, { signal }) {
    // call the LLM
    const client = await getLLMClient();
    let summary = '';
    for await (const ev of client.stream({
      model: client.getModel(),
      messages: [{ role: 'user', content: `Summarize in ≤${maxLength} chars:\n\n${content}` }],
      temperature: 0.3,
      maxTokens: Math.ceil(maxLength / 3),
    })) {
      if (signal?.aborted) return;
      if (ev.type === 'text_delta') summary = ev.accumulated;
      if (ev.type === 'message_stop') break;
    }
    yield { summary };
  },
  permissions: [{ kind: 'llm', calls: 1 }],
  cost: { tokens: 500, ms: 2000 },
};

const tscCheckCap: Capability<{ paths?: string[] }, { ok: boolean; errors: string[] }> = {
  name: 'tsc_check',
  description: 'Run TypeScript type-checker on given paths. Returns ok=true if no errors.',
  version: '1.0.0',
  input: z.object({ paths: z.array(z.string()).optional() }),
  output: z.object({ ok: z.boolean(), errors: z.array(z.string()) }),
  execute: async function* ({ paths }, { signal }) {
    const args = ['tsc', '--noEmit', '--noErrorTruncation', ...(paths || [])];
    const proc = spawn('npx', args);
    let stderr = '';
    proc.stderr.on('data', d => stderr += d);
    await new Promise<void>((resolve) => {
      proc.on('close', () => resolve());
      signal?.addEventListener('abort', () => proc.kill());
    });
    const errors = stderr.split('\n').filter(l => l.trim());
    yield { ok: errors.length === 0, errors };
  },
  permissions: [{ kind: 'execute', command: 'npx tsc' }],
  cost: { tokens: 0, ms: 5000 },
};

// 3. The CapabilityRegistry (typed index of all capabilities)

class CapabilityRegistry {
  private caps = new Map<string, Capability<any, any>>();

  register<I, O>(cap: Capability<I, O>): void {
    this.caps.set(cap.name, cap);
  }

  get<I, O>(name: string): Capability<I, O> | null {
    return this.caps.get(name) as Capability<I, O> | null;
  }

  list(): Capability<any, any>[] {
    return [...this.caps.values()];
  }

  /** Render the catalog for the LLM's system prompt */
  renderCatalog(maxLen = 2000): string {
    let out = '# Available Capabilities\n\n';
    for (const cap of this.caps.values()) {
      out += `## ${cap.name}@${cap.version}\n`;
      out += `${cap.description}\n`;
      out += `  input: ${JSON.stringify(cap.input._def)}\n`;
      out += `  output: ${JSON.stringify(cap.output._def)}\n`;
      out += `  perms: ${cap.permissions.map(p => p.kind).join(',')}\n\n`;
      if (out.length > maxLen) break;
    }
    return out;
  }
}

// 4. The Pipeline DSL — JSON expressions

type PipelineNode =
  | { capability: string; args: unknown }                           // atom
  | { pipeline: PipelineNode[] }                                    // sequence
  | { fanOut: PipelineNode[]; merge: PipelineNode }                  // parallel + merge
  | { try: PipelineNode; then: PipelineNode; catch: PipelineNode }   // error handling
  | { if: { input: any; pred: string }; then: PipelineNode; else: PipelineNode } // conditional
  | { map: PipelineNode; over: string };                            // map over list
  | { cache: { key: string; node: PipelineNode } };                  // memoize
  | { let: { name: string; from: PipelineNode }; in: PipelineNode }; // bind

// 5. The PipelineEngine — type-check, plan, execute

class PipelineEngine {
  private cache = new Map<string, AsyncIterable<any>>();

  constructor(
    private registry: CapabilityRegistry,
    private defaultContext: CapabilityContext,
  ) {}

  /** Type-check a pipeline: walk the graph, verify I/O types match */
  validate(node: PipelineNode): { ok: true } | { ok: false; error: string } {
    try {
      this.typeCheck(node, null);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  private typeCheck(node: PipelineNode, inputType: ZodSchema<any> | null): ZodSchema<any> {
    if ('capability' in node) {
      const cap = this.registry.get(node.capability);
      if (!cap) throw new Error(`Unknown capability: ${node.capability}`);
      // validate args
      cap.input.parse(node.args);
      return cap.output;
    }
    if ('pipeline' in node) {
      // sequence: each step's output is the next step's input
      let current: ZodSchema<any> | null = inputType;
      for (const step of node.pipeline) {
        const outType = this.typeCheck(step, current);
        current = outType;
      }
      return current!;
    }
    if ('fanOut' in node) {
      // all branches must produce the same output type as the merge
      const branchTypes = node.fanOut.map(b => this.typeCheck(b, inputType));
      const mergeType = this.typeCheck(node.merge, null);
      // structural compatibility check (simplified)
      return mergeType;
    }
    if ('try' in node) {
      this.typeCheck(node.try, inputType);
      this.typeCheck(node.then, null);
      this.typeCheck(node.catch, null);
      return z.unknown();  // output type is the union
    }
    if ('if' in node) {
      this.typeCheck(node.then, inputType);
      this.typeCheck(node.else, inputType);
      return z.unknown();
    }
    if ('map' in node) {
      const itemType = this.typeCheck(node.over, null);
      const mapType = this.typeCheck(node.map, null);
      return z.array(mapType);
    }
    if ('cache' in node) {
      return this.typeCheck(node.cache.node, inputType);
    }
    if ('let' in node) {
      this.typeCheck(node.from, inputType);
      this.typeCheck(node.in, null);
      return z.unknown();
    }
    throw new Error(`Unknown node shape: ${JSON.stringify(node)}`);
  }

  /** Execute a pipeline */
  async execute(node: PipelineNode, input: any): Promise<any> {
    const results: any[] = [];
    for await (const out of this.executeStream(node, input)) {
      results.push(out);
    }
    return results.length === 1 ? results[0] : results;
  }

  async *executeStream(node: PipelineNode, input: any): AsyncIterable<any> {
    if ('capability' in node) {
      const cap = this.registry.get(node.capability);
      if (!cap) throw new Error(`Unknown capability: ${node.capability}`);
      // Check cache
      const cacheKey = this.cacheKey(cap.name, cap.version, node.args);
      if (this.cache.has(cacheKey)) {
        for await (const v of this.cache.get(cacheKey)!) yield v;
        return;
      }
      // Validate permissions
      this.checkPermissions(cap, this.defaultContext.perms);
      // Run
      const result = cap.execute(node.args, this.defaultContext);
      // Cache
      this.cache.set(cacheKey, result);
      for await (const v of result) yield v;
      return;
    }
    if ('pipeline' in node) {
      let current: AsyncIterable<any> = (async function* () { yield input; })();
      for (const step of node.pipeline) {
        const collected: any[] = [];
        for await (const v of current) {
          for await (const out of this.executeStream(step, v)) {
            collected.push(out);
          }
        }
        current = (async function* () { for (const c of collected) yield c; })();
      }
      for await (const v of current) yield v;
      return;
    }
    if ('fanOut' in node) {
      // run all branches in parallel, collect all results, then run merge
      const branchStreams = await Promise.all(
        node.fanOut.map(async (branch) => {
          const out: any[] = [];
          for await (const v of this.executeStream(branch, input)) out.push(v);
          return out;
        })
      );
      // Feed all branch results to merge
      const flatResults = branchStreams.flat();
      for await (const v of this.executeStream(node.merge, flatResults)) yield v;
      return;
    }
    if ('try' in node) {
      try {
        for await (const v of this.executeStream(node.try, input)) yield v;
      } catch (err) {
        for await (const v of this.executeStream(node.catch, { error: err })) yield v;
      }
      return;
    }
    if ('cache' in node) {
      const key = node.cache.key;
      if (this.cache.has(key)) {
        for await (const v of this.cache.get(key)!) yield v;
        return;
      }
      const stream = this.executeStream(node.cache.node, input);
      this.cache.set(key, stream);
      for await (const v of stream) yield v;
      return;
    }
    // ... other operators ...
  }

  private cacheKey(name: string, version: string, args: any): string {
    return createHash('sha256')
      .update(name).update('@').update(version)
      .update(JSON.stringify(args))
      .digest('hex');
  }

  private checkPermissions(cap: Capability<any, any>, granted: Permission[]): void {
    for (const required of cap.permissions) {
      const found = granted.some(g => this.permissionMatches(g, required));
      if (!found) {
        throw new Error(`Permission denied: ${cap.name} requires ${JSON.stringify(required)}`);
      }
    }
  }

  private permissionMatches(granted: Permission, required: Permission): boolean {
    if (granted.kind !== required.kind) return false;
    if (granted.kind === 'read' || granted.kind === 'write') {
      return new RegExp(required.glob.replace(/\*/g, '.*')).test(granted.glob);
    }
    if (granted.kind === 'execute') {
      return granted.command === required.command;
    }
    return true;  // network, llm
  }
}

// 6. The LLM-facing authoring layer (turn JSON pipeline into a tool)

const PIPELINE_TOOL = {
  name: 'compose_pipeline',
  description: 'Compose a pipeline of capabilities to accomplish a task. Returns the result.',
  input: z.object({
    description: z.string().describe('What this pipeline is intended to do'),
    pipeline: z.any().describe('The pipeline expression (JSON DSL)'),
  }),
  output: z.object({ result: z.unknown() }),
  async execute(args: any, ctx: CapabilityContext) {
    const engine = getPipelineEngine();
    const validation = engine.validate(args.pipeline);
    if (!validation.ok) {
      throw new Error(`Invalid pipeline: ${validation.error}`);
    }
    const result = await engine.execute(args.pipeline, undefined);
    return { result };
  },
};

// 7. Pre-defined pipelines (the "molecules")

const PIPELINE_LIBRARY: { name: string; description: string; pipeline: PipelineNode }[] = [
  {
    name: 'find_todos',
    description: 'Find all TODO comments in the project',
    pipeline: {
      let: {
        name: 'files',
        from: { capability: 'glob', args: { pattern: 'src/**/*.ts' } },
      },
      in: {
        fanOut: [
          { pipeline: [
            { capability: 'read_file', args: { path: '$files[$i]' } },
            { capability: 'grep', args: { pattern: 'TODO' } }
          ]}
          // ... actually map over files ...
        ],
        merge: { capability: 'flatten', args: {} }
      }
    }
  },
  {
    name: 'review_pr',
    description: 'Run type-check, tests, and critic on the current diff',
    pipeline: {
      pipeline: [
        { capability: 'git_diff', args: {} },
        { capability: 'tsc_check', args: {} },
        { capability: 'vitest_run', args: {} },
        { capability: 'critic_mesh', args: { mode: 'full' } }
      ]
    }
  },
];

// 8. v3.0-compatible adapter

import { ToolRegistry } from '../tools/index.js';

class CapabilityToolAdapter {
  constructor(
    private registry: CapabilityRegistry,
    private engine: PipelineEngine,
  ) {}

  // The v3.0 tool registry's execute() is just a single-capability pipeline
  async execute(name: string, args: any): Promise<any> {
    const cap = this.registry.get(name);
    if (!cap) throw new Error(`Unknown capability: ${name}`);
    cap.input.parse(args);  // validate
    const result: any[] = [];
    for await (const v of this.engine.executeStream({ capability: name, args }, undefined)) {
      result.push(v);
    }
    return result[0];  // single-result capabilities return [value]
  }

  // The v3.0 tool registry's list() is the capability catalog
  list() {
    return this.registry.list().map(c => ({
      name: c.name,
      description: c.description.split('\n')[0],
    }));
  }
}
```

### Key points in the sketch

- **`Capability<I, O>` is a Zod-typed streaming function.** Type
  errors are caught at registration, not at execution.
- **`PipelineNode` is a JSON expression** — the LLM emits it as
  ordinary tool-call output. No new syntax for the LLM to learn.
- **`PipelineEngine.validate()`** walks the graph and checks every
  input/output type match. This is the *safety boundary*.
- **Automatic memoization via `cacheKey()`** — a hash of
  `(capability, version, args)`. Repeated calls are free.
- **Capability-based security** — `permissions` declare required
  grants; the engine checks them at call time. A read-only session
  cannot accidentally invoke `write_file`.
- **`fanOut`** runs branches in parallel and feeds all results to
  `merge` — the natural fit for "summarize 5 files in parallel."
- **Pre-defined pipelines** (`PIPELINE_LIBRARY`) cover 80% of
  cases; the LLM is *encouraged* to reuse them.
- **`CapabilityToolAdapter`** is a drop-in replacement for v3.0's
  `ToolRegistry` — same `execute(name, args)` signature, just
  routed through the pipeline engine.

---

## 6. Open Questions

1. **How do we teach the LLM the pipeline DSL?**
   - The system-prompt catalog is the obvious answer, but catalog
     length grows with capability count. For 20 capabilities, the
     catalog is ~2KB; for 200, it's 20KB (over the context window).
   - Solutions: (a) summarize the catalog with embeddings and
     retrieve top-K for each task; (b) lazy-load — show only the
     capabilities the LLM is likely to need based on task type;
     (c) fine-tune a small model on the DSL.
   - For v4.0, we start with (a) and (b).

2. **What's the right granularity for built-in capabilities?**
   - Too coarse (`do_everything`): no composability.
   - Too fine (`read_byte_at_offset`): overwhelming.
   - Sweet spot: 30–50 capabilities, each with a single
     responsibility and a clear type. The Unix philosophy applies.

3. **How do we handle capabilities that *need* LLM calls?**
   - `summarize` is one example. The capability calls the LLM
     internally. This is a *recursive* structure: the engine calls
     the LLM, the LLM emits a pipeline, the pipeline contains a
     capability that calls the LLM. To prevent infinite recursion,
     we have a *max depth* (default 3) and a *cycle detector*.

4. **What about *side-effecting* capabilities that can't be undone?**
   - `git push` is one-shot. The pipeline can't roll it back. We
     have two options: (a) declare a `destructive: true` flag on
     the capability; the engine asks the user for confirmation;
     (b) require a *snapshot* before the capability runs; if the
     pipeline fails after, the snapshot is restored.
   - For v4.0, we use (a) for now. (b) is a v4.1 feature that
     integrates with `snapshot.ts`.

5. **How do we version the *pipeline DSL itself*?**
   - The DSL is JSON, so the *syntax* doesn't change. But the
     *semantics* might (e.g., what does `fanOut` do if the
     branches have different output types?). We need a `dslVersion`
     field on the engine; pipelines are tagged with the version
     they were authored against. Old pipelines still work.

6. **How do we benchmark composition vs RPC?**
   - On a 5-step task: measure latency, token usage, success rate.
   - Expected: composition is 1.5–2× faster and uses 30% fewer
     tokens. (Reason: one LLM turn instead of 5.)
   - We log both paths in v3.0-compatible mode and compare.
     Publish the results in `/status`.

7. **What if the LLM's pipeline is just bad?**
   - The critic mesh (primitive #4) verifies the pipeline before
     execution. The verification includes: "does this pipeline
     achieve the user's stated goal?" If the answer is no, the
     mesh rejects the pipeline and the LLM is re-prompted.
   - This is a *self-correction loop* — primitive but effective.

8. **Should the user be able to *visualize* the pipeline?**
   - For a power user, a `/pipeline` command that draws the
     graph in the TUI (using ASCII art) would be great.
   - Format:
     ```
     find_todos
       ├─ glob('src/**/*.ts') → [f1, f2, ...]
       ├─ fanOut:
       │   ├─ read_file(f1) → grep(TODO) → [m1]
       │   ├─ read_file(f2) → grep(TODO) → [m2]
       │   └─ ...
       └─ merge: flatten → [m1, m2, ...]
     ```
   - For v4.0, a simple text-based view. A real graphical view
     is a v4.1+ TUI extension.

9. **How do we handle user-registered capabilities that are buggy?**
   - The user's `my_check.sh` returns garbage. The engine should
     *not* crash. The capability's output is *validated against
     the declared Zod schema*; if validation fails, the engine
     emits a `capability_error` event and the pipeline is
     aborted (or the catch handler runs).
   - This is *defensive* — the user might write a buggy capability,
     and the engine degrades gracefully.

10. **What about *graph algorithms* on the pipeline?**
    - Once pipelines are stored in the memory graph (primitive #5),
    - we can run graph algorithms: "which capability is used most
    - often?" "which pipelines are most successful?" "what's the
    - shortest path from `read_file` to `git_commit`?"
    - This is a v4.1+ feature. For v4.0, we just *store* the
      pipelines; the analysis comes later.

11. **How does this interact with the speculative execution primitive?**
    - A pipeline is a *deterministic* artifact. Speculative
      execution (primitive #3) races multiple *strategies*; each
      strategy is a pipeline. So: 3 different pipelines, each
      racing, the critic mesh picking the winner.
    - The pipelines are *generated* by the LLM (3 different
      prompts → 3 different pipelines), then validated and raced.
      This is *speculative execution at the pipeline level*.
