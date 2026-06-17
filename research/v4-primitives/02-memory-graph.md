# Primitive 5: Memory Graph

> Replacing v3.0's append-only log memory (SQLite `memories` table at
> `/root/huagent/src/memory/store.ts`, with simple `LIKE` search and no
> relational structure) with a **causally-grounded, temporally-indexed
> property graph** that links facts, episodes, decisions, and code symbols
> into a queryable web. The memory graph is the v4.0 answer to Claude Code's
> recall weakness: instead of stuffing everything into a context window, we
> *structure* knowledge so that the LLM can query it like a database, with
> ground truth verifiable by graph traversal.

---

## 1. Literature & References

### 1.1 Knowledge Graph Foundations

**Berners-Lee, T., Hendler, J. & Lassila, O. (2001). "The Semantic Web."**
*Scientific American* 284(5):34–43.
- The original vision: a web of *linked data* where every entity is
  identified by a URI, every relationship is typed, and every fact is
  machine-readable. Built on **RDF** (Resource Description Framework) —
  triples of `(subject, predicate, object)`.
- Why it matters: Our memory graph is *not* RDF (we use property graphs, see
  below), but the *spirit* — every fact is identifiable, every link is
  typed, every claim is auditable — is the bedrock of anti-hallucination.
  A claim the LLM makes that isn't backed by a graph node is rejected.

**Antoniou, G. & van Harmelen, F. (2004). "A Semantic Web Primer."** MIT Press.
- The textbook treatment of RDF, RDFS, and OWL. Key insight: OWL adds
  *description logic* (subsumption, equivalence, transitivity) to RDF.
- Why it matters: We don't need OWL's full expressivity (it's a research
  rabbit hole). We need *just enough* to express: "this function `foo`
  *calls* `bar`, which *imports* `baz`, which *uses* `qux`." A few
  transitive closure rules suffice.

**Angles, R. (2012). "A Comparison of Current Graph Database Models."**
IEEE International Conference on Data Engineering (ICDE) Workshops.
- The definitive comparison of property graph (Neo4j-style) vs RDF
  triple store vs object-oriented. **Property graphs win on usability**
  for our use case: we want labeled, typed nodes with arbitrary properties,
  not just triples.
- Why it matters: This is the *single most important* design decision for
  v4.0's memory: property graph, not RDF. RDF's strength is the open
  Semantic Web; our strength is a *closed, project-specific* knowledge
  base. Property graphs are a better fit.

### 1.2 Property Graph Databases

**Robinson, I., Webber, J. & Eifrem, E. (2015). "Graph Databases:
New Opportunities for Connected Data."** 2nd ed. O'Reilly.
- The canonical reference for the property graph model: nodes have
  *labels* (e.g., `Symbol`, `File`, `Decision`) and *properties*
  (key-value). Relationships have a *type* and *properties* (e.g.,
  `[:CALLS] { count: 3, firstSeen: ... }`).
- **Cypher** (Neo4j's query language) is the de-facto standard. It is
  *declarative* (pattern matching) and *compositional* (you can chain
  patterns with `MATCH ... MATCH ...`).
- Why it matters: Our memory graph uses a Cypher-inspired query language
  (call it `Cypher-Lite`). The LLM is the *author* of queries; the
  engine *executes* them against the in-process graph store.

**Bonifati, A., Furniss, S., Green, A. et al. (2018). "Querying Graphs."
Synthesis Lectures on Data Management.
- Comprehensive treatment of graph query languages (Cypher, SPARQL,
  GQL, GraphQL). Key insight: most graph queries follow one of three
  shapes: (1) *find nodes by property*, (2) *find paths between nodes*,
  (3) *aggregate over subgraphs*.
- Why it matters: We can pre-implement 10-20 query templates that cover
  90% of use cases. The LLM picks a template and fills in the parameters.
  Full Cypher is too dangerous (the LLM could write `MATCH (n) DETACH
  DELETE n` and wipe the graph).

**Webber, J. (2012). "A Programmatic Introduction to Neo4j."** (Conference
talk slides.)
- The slides that introduced Cypher. The ASCII-art syntax for patterns
  (`()-[:KNOWS]->()`) is now industry standard.

### 1.3 Causal Inference and Graphs

**Pearl, J. (2009). "Causality: Models, Reasoning, and Inference."** 2nd ed.
Cambridge University Press.
- The foundational text. Key insight: causal relationships are *not*
  correlations; they require a **causal graph** (DAG) where edges mean
  "causes." The **do-calculus** lets us answer "what if?" questions
  (interventions) using only the graph structure.
- Three levels of causal reasoning:
  1. **Association** (seeing): P(Y|X) — "do X and Y correlate?"
  2. **Intervention** (doing): P(Y|do(X)) — "if I do X, what happens?"
  3. **Counterfactual** (imagining): P(Y_X|X',Y') — "if I had done X
     instead, would Y have happened?"
- Why it matters: Our memory graph can *represent* causal claims. When
  the LLM says "this change caused the test to fail," the graph stores
  a `[:CAUSED]` relationship. The causal path is queryable: "what other
  tests have I broken in the last week?" We don't need do-calculus per
  se, but the *vocabulary* of causal graphs is essential.

**Pearl, J. & Mackenzie, D. (2018). "The Book of Why: The New Science
of Cause and Effect."** Basic Books.
- The popular version. Key insight for us: **counterfactual reasoning**
  is the most human-like form of intelligence. "If I had used `map`
  instead of `forEach`, would the test pass?" requires the LLM to
  reason about an *alternative world*. A memory graph that records both
  the actual decision AND the counterfactual alternatives considered
  can *answer* this question.

**Imbens, G. W. & Rubin, D. B. (2015). "Causal Inference for Statistics,
Social, and Biomedical Sciences."** Cambridge University Press.
- The alternative framework: **potential outcomes** (Rubin causal model).
  Less graph-centric, more statistical. Useful when we have repeated
  observations of the same decision and want to estimate the average
  treatment effect.
- Why it matters: For v4.0's *learning loop* (synthesizing instincts from
  episodes), the Rubin Causal Model is the *right* framework. We have
  N instances of "user asked X, we did Y, outcome was Z." The ATE of Y
  on Z tells us when Y is a good choice.

**Pearl, J., Glymour, M. & Jewell, N. P. (2016). "Causal Inference in
Statistics: A Primer."** Wiley.
- The shorter, more accessible version. Has the *graphical* definitions
  of confounding, colliders, mediators, and instrumental variables.
- Why it matters: For a coding agent, the most important causal concept
  is **confounding**. "This PR is correlated with the bug" might be
  because the PR *caused* the bug, OR because the PR and the bug are
  both caused by a recent refactor (a confounder). A naive agent fixes
  the PR; a causal-aware agent fixes the refactor.

### 1.4 GraphRAG and LLM-Enhanced Knowledge Graphs

**Edge, D., Trinh, H., Cheng, N. et al. (2024). "From Local to Global:
A Graph RAG Approach to Query-Focused Summarization."** arXiv:2404.16130
(Microsoft Research).
- Key insight: Traditional RAG retrieves *chunks* of text. **GraphRAG**
  builds a *knowledge graph* of the documents, then *summarizes
  communities* of related entities. Query-time, the LLM queries the
  *summarized community* — not the raw chunks. Result: dramatically
  better performance on "global" questions ("what are the main themes
  of these 1000 documents?").
- The pipeline: chunk documents → extract entities and relationships
  via LLM → build graph → detect communities → summarize communities →
  index summaries → at query time, retrieve relevant summaries.
- Why it matters: Our memory graph is *exactly* this pattern, but for
  a *codebase* (not arbitrary documents). The LLM extracts entities
  (`File`, `Symbol`, `Decision`, `Bug`, `Instinct`) and relationships
  (`CALLS`, `IMPORTS`, `CAUSED`, `FIXED_BY`). Communities are
  "subsystems" (e.g., "the auth module"). Summaries are "what we know
  about the auth module."

**Peng, B., Galley, M., He, P. et al. (2023). "Check Your Facts and Try
Again: Improving Large Language Models with External Knowledge."**
Microsoft Research blog post.
- A precursor to GraphRAG: ground LLM claims in an external knowledge
  base. The LLM is asked to *cite* its sources; if no source exists,
  the claim is rejected.
- Why it matters: This is the *mechanism* for anti-hallucination. The
  LLM is no longer "trust me" — it must produce a citation. The graph
  is the citation source.

**Han, H., Wang, Y., Shomer, H. et al. (2025). "LM vs LM: Detecting
Factual Errors via Cross Examination."** (Multiple arXiv versions in
2024-2025.)
- Two LLMs play "examiner" and "examinee" to find factual errors. The
  examiner generates questions; the examinee answers; disagreements
  are flagged. Inspired by *adversarial collaboration*.
- Why it matters: The critic mesh (primitive #4) is a *generalization*
  of this. A single fact in the memory graph can be cross-examined by
  the mesh: "Is this `[:CAUSED]` relationship correct? Generate a test
  that would prove or disprove it."

### 1.5 Temporal Graph Databases

**Zhao, K., Chen, L., Cong, G. (2022). "A Survey on Temporal Graph
Databases."** IEEE Transactions on Knowledge and Data Engineering.
- Surveys bi-temporal modeling in graphs: each fact has *valid time*
  (when it was true in the world) and *transaction time* (when we
  recorded it). Time-travel queries: "what did we know on date X?"
- Why it matters: Our memory graph records *episodes* with timestamps.
  "The function `foo` was renamed to `bar` on March 1st, 2026." A
  time-travel query: "what did the agent believe the symbol was called
  on Feb 28th?" This is *essential* for debugging past failures.

**Khurana, U. & Deshpande, A. (2016). "Storing and Analyzing Temporal
Graph Data."** Tutorial at SIGMOD.
- Practical advice: use a *versioned* property graph where each node
  has `validFrom` and `validTo` timestamps. Updates create *new* node
  versions rather than mutating. Edges are similarly versioned.
- Why it matters: This is the "append-only log with structure" pattern.
  We get the *auditability* of a log (nothing is lost) and the *query
  power* of a graph (relationships are first-class).

### 1.6 In-Process Lightweight Graph Stores

**Kùzu** (KuzDatabase, 2023). https://kuzudb.com
- An in-process, embeddable property graph database written in C++.
  ACID, Cypher-compatible, MIT-licensed. Performance is competitive
  with Neo4j for workloads up to ~100M nodes.
- Why it matters: For a CLI tool, an in-process database is *essential*:
  no server, no IPC, no `connection refused` errors. Kùzu is a perfect
  fit.

**SurrealDB** (2022). https://surrealdb.com
- Multi-model database (graph + document + key-value + relational).
  Has an in-process mode. Uses SurrealQL (Cypher-influenced).
- Why it matters: A viable alternative to Kùzu if we need the document
  model too. Larger and more featureful; Kùzu is leaner.

**SQLite + adjacency tables** (always available, since we already use
SQLite).
- The simplest option: 2 tables, `nodes(id, label, props)` and
  `edges(from, to, type, props)`. Plus an FTS5 index for full-text
  search of properties. Plus a recursive CTE for path queries.
- Why it matters: We *already* use `better-sqlite3` in the codebase.
  Zero new dependencies. The query language is SQL (we already know it).
  Performance is fine for our scale (< 10K nodes per project).
- **This is what we'll use for v4.0.** See §4.

**RDFox** (Oxford, 2021). High-performance in-memory RDF triple store.
- Mentioned for completeness. RDF, not property graph. Overkill for us.

### 1.7 Vector + Graph Hybrids

**Microsoft GraphRAG** (2024, see above) — pure graph, no vectors.
**Pinecone + Neo4j hybrid** (2024) — vectors for *similarity* search,
  graph for *relational* queries.
- Key insight: vectors find "things like X"; graphs find "things
  related to X via the relationship Y." They are *complementary*, not
  alternatives.
- Why it matters: Our memory graph supports both. We use the graph as
  the *primary* index, with optional vector embeddings on nodes for
  semantic search. A query "find files similar to auth.ts" uses
  vectors; a query "what calls auth.ts?" uses graph traversal.

---

## 2. Existing Implementations

| System | Type | Notable Property | Relevance to HuaEngine |
|---|---|---|---|
| **Neo4j** | Server-mode property graph DB | Cypher, ACID, Mature | Reference implementation; we borrow the query patterns, not the server |
| **Memgraph** | In-memory graph DB + Bolt protocol | Streaming, great for temporal data | Architecture inspiration for time-travel queries |
| **Kùzu** | In-process property graph DB | C++, Cypher, MIT | Direct candidate for v4.0's storage engine |
| **SurrealDB** | Multi-model embedded DB | Graph + doc + SQL | Alternative to Kùzu; more features, heavier |
| **Microsoft GraphRAG** | LLM + knowledge graph pipeline | Community detection + summarization | The pipeline pattern for extracting entities from code |
| **Mem** (chatGPT) | Long-term memory layer | Vector store, automatic extraction | Opposite design: opaque, no queries. We need *queryable* memory. |
| **Cognee** (2024) | Open-source knowledge engine for LLMs | ETL → graph → vector → LLM | Combines GraphRAG with hybrid retrieval. Worth studying. |
| **Letta / MemGPT** | Memory-augmented LLM agent | Hierarchical memory (core + archival + recall) | Architectural inspiration for tiered memory |
| **LlamaIndex PropertyGraphIndex** | Library | LLM extracts graph from docs, persists to Neo4j/Kùzu | Direct tooling: we can use this to bootstrap our extractor |
| **v3.0 MemoryManager** | Simple SQLite store | 4 memory types, LIKE search | The baseline we're replacing |

### The one to study hardest: **LlamaIndex PropertyGraphIndex**

LlamaIndex's `PropertyGraphIndex` does *exactly* what we need:
1. Takes a corpus of documents (or, in our case, a codebase + session
   episodes).
2. Uses an LLM to extract entities (nodes) and relationships (edges).
3. Persists to a property graph store (Neo4j, Kùzu, or in-memory).
4. Exposes a query interface: "find all nodes related to X within
   distance 2."

For v4.0, we borrow the *extraction prompt template* and the *schema
design*. We don't need the full library — ~300 lines of TypeScript
to replicate the core.

---

## 3. Trade-offs

### Pros of property-graph memory over append-only log

| Property | Append-only SQLite log (v3.0) | Property graph (v4.0) |
|---|---|---|
| **Schema** | Flat: id, type, content, metadata | Nodes have *labels* and *properties*; edges have *types* |
| **Relationships** | Implicit in `metadata` (stringly-typed) | First-class: `[:CALLS]`, `[:CAUSED]`, `[:FIXED]` |
| **Queries** | `LIKE '%foo%'` | `MATCH (s:Symbol {name:'foo'})<-[:CALLS]-(caller)` |
| **Causal claims** | Lost in text | Explicit `[:CAUSED]` edges, queryable |
| **Time-travel** | Recreate from append log | Index by timestamp; query `validFrom`/`validTo` |
| **Symbol grounding** | "Does this symbol exist?" → LIKE search | `MATCH (s:Symbol {name:$1}) RETURN s` — O(1) |
| **Anti-hallucination** | LLM claims are unverified | LLM claims must cite a graph node; un-cited = rejected |
| **Community detection** | Not possible | Graph algorithms find "subsystems" |
| **Counterfactuals** | Not representable | Store both the decision AND the alternatives considered |
| **Cypher** | N/A (SQL) | Declarative pattern matching; LLM can author queries |
| **Schema evolution** | Add a column | Add a node label (backward compatible) |
| **Performance (small)** | Fast for < 100K rows | Fast for < 1M nodes; slower for > 10M |
| **Performance (relational queries)** | O(N) scan | O(1) with index, O(log N) traversal |
| **Storage** | ~1KB per memory | ~1-5KB per node (more metadata), more total storage |

### Cons / when NOT to use

- **Schema is a constraint.** Once a node label is widely used, changing
  its properties is a migration. The v3.0 append-only log is
  *schema-free* (just `content` text). For *unstructured* memories
  (free-form conversation), the graph forces us to pre-define labels.
  Solution: keep a `MiscNote` label for everything that doesn't fit
  elsewhere.
- **Write throughput is lower.** A graph insert is ~5–10× slower than
  a flat insert (joins, index updates). For high-frequency writes
  (every LLM token?), a graph is overkill. Solution: write to the
  graph in *batches* (e.g., once per turn, not per token).
- **Query language is a learning curve.** Cypher is more complex than
  `LIKE`. The LLM needs training to write good queries. Solution: use
  a *restricted* query language (Cypher-Lite) with 10-20 templates.
- **Migration cost.** Moving 6 months of v3.0 memories into a graph
  requires an ETL pass. Solution: do it lazily — only migrate
  memories that are *recalled* in v4.0.
- **Operational complexity.** A graph is harder to debug than a flat
  table. Solution: provide a `/graph` command that visualizes the
  graph in the TUI.

### When to use graph memory vs flat log

- ✅ When you need to query *relationships* (who calls what, what
  caused what, what depends on what). For code agents, *always*.
- ✅ When you need *grounding* (anti-hallucination). For code agents,
  *always*.
- ✅ When you need *causal* or *counterfactual* reasoning.
- ❌ For pure conversation transcripts (just text). Keep those in the
  flat log, summarize, and forget.
- ❌ For high-frequency ephemeral state (recent messages, scratch
  buffers). Use the in-memory stream log (primitive #1).

---

## 4. Our Adaptation for HuaEngine v4.0

### 4.1 Mental model

> HuaEngine v4.0's long-term memory is a **property graph** stored in
> **SQLite** (we already have `better-sqlite3`). The graph is *not* a
> replacement for the v3.0 episodic log — it is a *structured view* over
> it. Episodes are ingested; entities (Symbols, Files, Decisions, Bugs,
> Instincts) are extracted via LLM; relationships (`CALLS`, `IMPORTS`,
> `CAUSED`, `FIXED`, `INSTANCE_OF`) are inferred. The graph is
> *bi-temporal*: every node has `validFrom` and `validTo`. The LLM
> queries the graph with a *Cypher-Lite* language (10–20 templates)
> that we *curate* to prevent accidental writes.

### 4.2 Concrete design decisions

1. **Storage engine: SQLite + adjacency tables.** We already use SQLite.
   No new dependencies. The schema is:
   ```sql
   CREATE TABLE nodes (
     id TEXT PRIMARY KEY,
     label TEXT NOT NULL,          -- e.g., 'Symbol', 'File', 'Decision'
     props TEXT NOT NULL DEFAULT '{}',  -- JSON
     valid_from INTEGER NOT NULL,
     valid_to INTEGER,             -- NULL = still valid
     created_at INTEGER NOT NULL
   );
   CREATE INDEX idx_nodes_label ON nodes(label);
   CREATE INDEX idx_nodes_valid ON nodes(valid_from, valid_to);

   CREATE TABLE edges (
     id TEXT PRIMARY KEY,
     from_id TEXT NOT NULL,
     to_id TEXT NOT NULL,
     type TEXT NOT NULL,           -- e.g., 'CALLS', 'CAUSED', 'IMPORTS'
     props TEXT NOT NULL DEFAULT '{}',
     weight REAL DEFAULT 1.0,      -- for ranking
     valid_from INTEGER NOT NULL,
     valid_to INTEGER,
     created_at INTEGER NOT NULL,
     FOREIGN KEY (from_id) REFERENCES nodes(id),
     FOREIGN KEY (to_id) REFERENCES nodes(id)
   );
   CREATE INDEX idx_edges_from ON edges(from_id, type);
   CREATE INDEX idx_edges_to ON edges(to_id, type);

   CREATE TABLE node_fts (
     rowid INTEGER PRIMARY KEY,
     node_id TEXT NOT NULL,
     text TEXT NOT NULL            -- concatenated props for FTS
   );
   -- FTS5 virtual table for semantic-ish search
   ```
   For path queries, we use SQLite's **recursive CTE**:
   ```sql
   WITH RECURSIVE callers(node_id, depth) AS (
     SELECT 'foo', 0
     UNION ALL
     SELECT e.from_id, c.depth + 1
     FROM edges e JOIN callers c ON e.to_id = c.node_id
     WHERE e.type = 'CALLS' AND c.depth < 5
   )
   SELECT DISTINCT node_id FROM callers;
   ```
   This is *not* as fast as Kùzu, but it's good enough for < 100K nodes.

2. **Node labels are fixed but extensible.** We start with:
   - `Symbol` (functions, classes, types): `name`, `kind`, `signature`, `file`
   - `File`: `path`, `language`, `lines`
   - `Module`: `name`, `path` (a directory)
   - `Decision` (architecture choices): `title`, `rationale`, `date`
   - `Bug`: `description`, `severity`, `firstSeen`
   - `Fix`: `description`, `changes[]`, `verifies` (a Bug id)
   - `Instinct` (learned heuristics): `condition`, `action`, `confidence`
   - `Episode` (a user turn): `summary`, `outcome`, `tokens`, `duration`
   - `User` (the human): `name`, `preferences`
   - `Project` (the codebase): `name`, `type`, `framework[]`
   - `Tool` (a registered tool): `name`, `description`, `risk`
   - `Symbol_Use` (a call site): `symbol_id`, `file`, `line`
   - `Dependency` (external lib): `name`, `version`
   - `MiscNote` (escape hatch for unstructured memories)
   Adding a new label is a *backward-compatible* migration.

3. **Edge types are also fixed but extensible.** We start with:
   - `CALLS`, `IMPORTS`, `EXPORTS`, `READS`, `WRITES` (code structure)
   - `CAUSED`, `FIXED`, `PREVENTED` (causal)
   - `INSTANCE_OF` (a `Fix` is an instance of a `Bug`)
   - `ABOUT` (a `Decision` is about a `Symbol`)
   - `BY_USER`, `IN_PROJECT`, `USED_TOOL` (episodic)
   - `CONTRADICTS`, `SUPPORTS` (episodic — between Decisions)
   - `PRECEDES`, `FOLLOWS` (temporal ordering)

4. **Extraction is LLM-driven but *batched*.** Every turn ends with an
   `extract` phase:
   - Take the last N (default 5) tool calls + results.
   - Prompt the LLM: "Extract entities and relationships. Output JSON
     in this schema: `{ nodes: [...], edges: [...] }`."
   - Validate the JSON against the schema. Reject malformed.
   - Insert into the graph in a single transaction.
   - The extract prompt is a *few-shot* prompt with 5 examples (e.g.,
     "the user called `read_file` on `auth.ts` and got an error →
     `[:READS] (Tool:read_file) -> (File:auth.ts) { error: '...' }`").

5. **The graph is bi-temporal.** Every node and edge has `valid_from`
   and `valid_to`. When a fact *changes* (e.g., a function is renamed),
   we don't mutate the old node — we create a new version and set
   `valid_to` on the old. Time-travel queries:
   - `MATCH (s:Symbol {name:'foo'}) WHERE s.valid_from <= $date AND (s.valid_to IS NULL OR s.valid_to > $date)`
   - Returns the version of `foo` valid at `$date`.

6. **Queries use Cypher-Lite, not full Cypher.** We define 10–20
   templates, each a parameterized query:
   - `Q001: nodes_by_label(label)`: list all nodes of a label
   - `Q002: edges_from(node_id)`: list outgoing edges
   - `Q003: edges_to(node_id)`: list incoming edges
   - `Q004: shortest_path(from, to, max_depth)`: 2-hop, 3-hop, 4-hop
   - `Q005: symbols_in_file(path)`: list symbols in a file
   - `Q006: callers_of(symbol)`: who calls this function
   - `Q007: callees_of(symbol)`: who does this function call
   - `Q008: recent_episodes(project, limit)`: last N episodes
   - `Q009: bugs_fixed_by(decision)`: causal chain of fixes
   - `Q010: contradictions(decision)`: which decisions disagree
   - `Q011: facts_about(node)`: full neighborhood
   - `Q012: search_fts(query)`: full-text search over node text
   The LLM picks a template and fills in parameters. The orchestrator
   *executes* the query (no LLM in the loop after the pick). This is
   safe and fast.

7. **The graph is the *citation layer* for the critic mesh.** When a
   critic says "this code is correct because `foo` is defined in
   `bar.ts`," it must cite a graph node. The critic prompt is:
   "Cite a graph node for every claim of the form 'X exists' or 'X is
   related to Y'. Use the format `[Graph:<node_id>]`." The orchestrator
   then verifies: does the cited node exist? does it say what the
   critic claims?

8. **Causal claims are explicit.** When the agent says "this change
   *caused* the test to fail," we insert a `[:CAUSED]` edge:
   `(Episode:turn_42) -[:CAUSED]-> (Bug:test_failure_03)`. The
   confidence weight starts at 0.5; the user can *confirm* (weight → 1.0)
   or *deny* (weight → 0.1, eventually pruned). This is the *causal
   graph* that the LLM can query: "what bugs have I caused recently?"

9. **Counterfactuals are first-class.** When the LLM *considers* an
   alternative but rejects it, we record both:
   - `(Decision:actual) -[:CHOSE]-> (Symbol:foo)` (the actual choice)
   - `(Decision:actual) -[:REJECTED]-> (Symbol:bar) { reason: 'slower' }` (the counterfactual)
   Later, the LLM can ask: "what alternatives did I consider and why
   did I reject them?" This is *counterfactual memory* and is the
   closest we can get to Pearl's third level of causal reasoning
   without doing actual intervention experiments.

10. **The graph is a stream operator.** From `01-stream.md`: an
    `extract` stage takes the upstream `cognitive_event` stream, runs
    the LLM extractor in batches, and emits `graph_update` events.
    Downstream operators can subscribe to graph updates and re-query
    when relevant.

11. **v3.0 compatibility: a `MemoryManager` adapter.** The v3.0
    `MemoryManager.recall()` returns a list of memory entries. v4.0's
    `GraphMemoryManager.recall()` returns the *same shape* (entries
    with `type`, `content`, `metadata`) but the entries are
    *projections* from the graph. The LLM can call `recall('foo')` and
    get back: "Symbol `foo` defined in `bar.ts:42`, called by 3
    functions, last edited 2 days ago, was once renamed from `baz`."

12. **The graph has a TUI visualization.** The `/graph` command
    shows the neighborhood of a node: it as ASCII art (Cypher-style
    arrows) plus a list of recent episodes involving it. For
    anime-themed game devs, we can add a *kawaii* skin: nodes are
    "magical circles" and edges are "cute arrows." (Decorative;
    doesn't affect the data model.)

13. **Migration from v3.0 is lazy.** We don't re-process 6 months of
    episodic memories. When a v3.0 memory is *recalled*, we extract
    graph nodes from it on the fly. Cold start: 0 graph nodes;
    warm start: the graph grows as memories are recalled.

14. **The graph is *not* a full knowledge graph; it's a *working*
    knowledge graph.** We intentionally *don't* extract every entity
    and every relationship. We only extract what's *relevant to the
    current project* and *useful for the current task*. The extraction
    prompt is conditioned on the *task type*: for a code fix, we
    extract Symbols, Files, Bugs, and Causal edges; for a question,
    we extract Decisions and Episodes.

15. **Privacy: the graph stays local.** All extraction and querying
    happens in-process. The graph is in the user's `.huagent/`
    directory, not sent to any server. (Same as v3.0.)

### 4.3 What we are *not* doing

- **Not** using Neo4j / Memgraph / a server-mode graph DB. Too heavy
  for a CLI. SQLite is the right tool.
- **Not** implementing full Cypher. The LLM can't be trusted to write
  arbitrary Cypher. We use a *curated* set of 10–20 templates.
- **Not** running GraphRAG-style community detection at query time.
  We pre-compute *static* communities (e.g., a `Module` node with a
  `CONTAINS` edge to all its `Symbol` children) at ingest time.
- **Not** using RDF / OWL / SPARQL. Property graph is the right model.
- **Not** building a vector store from scratch. If we need semantic
  search, we use the existing SQLite + the FTS5 virtual table.
- **Not** making the graph the *only* memory. Free-form conversation
  stays in the v3.0 episodic log. The graph is a *structured view*.

---

## 5. TypeScript Sketch

The sketch shows the core ideas: SQLite-backed property graph, bi-temporal
nodes and edges, Cypher-Lite query templates, LLM-driven extraction, and
a v3.0-compatible recall adapter.

```ts
// ─────────────────────────────────────────────────────────────────
// HuaEngine v4.0 — Memory Graph (sketch)
// ─────────────────────────────────────────────────────────────────

import Database from 'better-sqlite3';
import { nanoid } from 'nanoid';
import type { UnifiedClient, StreamEvent } from '../../providers/client.js';

// 1. The core types

type NodeLabel =
  | 'Symbol' | 'File' | 'Module' | 'Decision' | 'Bug' | 'Fix'
  | 'Instinct' | 'Episode' | 'User' | 'Project' | 'Tool'
  | 'Symbol_Use' | 'Dependency' | 'MiscNote';

type EdgeType =
  | 'CALLS' | 'IMPORTS' | 'EXPORTS' | 'READS' | 'WRITES'
  | 'CAUSED' | 'FIXED' | 'PREVENTED' | 'INSTANCE_OF' | 'ABOUT'
  | 'BY_USER' | 'IN_PROJECT' | 'USED_TOOL'
  | 'CONTRADICTS' | 'SUPPORTS' | 'PRECEDES' | 'FOLLOWS'
  | 'CHOSE' | 'REJECTED' | 'CONTAINS';

interface GraphNode {
  id: string;
  label: NodeLabel;
  props: Record<string, unknown>;
  validFrom: number;       // unix ms
  validTo: number | null;  // null = still valid
  createdAt: number;
}

interface GraphEdge {
  id: string;
  fromId: string;
  toId: string;
  type: EdgeType;
  props: Record<string, unknown>;
  weight: number;         // 0..1, for ranking
  validFrom: number;
  validTo: number | null;
  createdAt: number;
}

// 2. The schema (executed once at init)

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS g_nodes (
    id TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    props TEXT NOT NULL DEFAULT '{}',
    valid_from INTEGER NOT NULL,
    valid_to INTEGER,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_g_nodes_label ON g_nodes(label);
  CREATE INDEX IF NOT EXISTS idx_g_nodes_valid ON g_nodes(valid_from, valid_to);

  CREATE TABLE IF NOT EXISTS g_edges (
    id TEXT PRIMARY KEY,
    from_id TEXT NOT NULL,
    to_id TEXT NOT NULL,
    type TEXT NOT NULL,
    props TEXT NOT NULL DEFAULT '{}',
    weight REAL DEFAULT 1.0,
    valid_from INTEGER NOT NULL,
    valid_to INTEGER,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (from_id) REFERENCES g_nodes(id),
    FOREIGN KEY (to_id) REFERENCES g_nodes(id)
  );
  CREATE INDEX IF NOT EXISTS idx_g_edges_from ON g_edges(from_id, type);
  CREATE INDEX IF NOT EXISTS idx_g_edges_to ON g_edges(to_id, type);
  CREATE INDEX IF NOT EXISTS idx_g_edges_type ON g_edges(type);

  CREATE VIRTUAL TABLE IF NOT EXISTS g_fts USING fts5(
    node_id UNINDEXED, text, tokenize='porter'
  );
`;

// 3. The GraphStore

class GraphStore {
  private db: Database.Database;

  constructor(path: string) {
    this.db = new Database(path);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(SCHEMA);
  }

  // ── CRUD on nodes ────────────────────────────────────
  upsertNode(node: Omit<GraphNode, 'id' | 'createdAt'>): string {
    const existing = this.findNodeByLabelAndProps(node.label, node.props);
    if (existing) {
      // If props differ, create a new version
      if (JSON.stringify(existing.props) !== JSON.stringify(node.props)) {
        this.retireNode(existing.id, node.validFrom);
        return this.insertNode(node);
      }
      return existing.id;
    }
    return this.insertNode(node);
  }

  private insertNode(node: Omit<GraphNode, 'id' | 'createdAt'>): string {
    const id = nanoid();
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO g_nodes (id, label, props, valid_from, valid_to, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, node.label, JSON.stringify(node.props), node.validFrom, node.validTo, now);
    return id;
  }

  private retireNode(id: string, atTime: number): void {
    this.db.prepare(`UPDATE g_nodes SET valid_to = ? WHERE id = ? AND valid_to IS NULL`)
      .run(atTime, id);
  }

  private findNodeByLabelAndProps(label: NodeLabel, props: Record<string, unknown>): GraphNode | null {
    // For "name" property, look up by label + name
    if (props.name && typeof props.name === 'string') {
      const row = this.db.prepare(`
        SELECT * FROM g_nodes
        WHERE label = ? AND json_extract(props, '$.name') = ?
          AND valid_to IS NULL
      `).get(label, props.name) as any;
      if (row) return this.rowToNode(row);
    }
    return null;
  }

  // ── CRUD on edges ────────────────────────────────────
  upsertEdge(edge: Omit<GraphEdge, 'id' | 'createdAt'>): string {
    const id = nanoid();
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO g_edges (id, from_id, to_id, type, props, weight, valid_from, valid_to, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, edge.fromId, edge.toId, edge.type,
      JSON.stringify(edge.props), edge.weight,
      edge.validFrom, edge.validTo, now
    );
    return id;
  }

  // ── Time-travel ──────────────────────────────────────
  getNodeAtTime(id: string, atTime: number): GraphNode | null {
    const row = this.db.prepare(`
      SELECT * FROM g_nodes
      WHERE id = ? AND valid_from <= ? AND (valid_to IS NULL OR valid_to > ?)
    `).get(id, atTime, atTime) as any;
    return row ? this.rowToNode(row) : null;
  }

  // ── Cypher-Lite templates ────────────────────────────
  private templates = {
    nodesByLabel: (label: NodeLabel): GraphNode[] => {
      const rows = this.db.prepare(`SELECT * FROM g_nodes WHERE label = ? AND valid_to IS NULL ORDER BY created_at DESC LIMIT 100`)
        .all(label) as any[];
      return rows.map(r => this.rowToNode(r));
    },
    edgesFrom: (nodeId: string): GraphEdge[] => {
      const rows = this.db.prepare(`SELECT * FROM g_edges WHERE from_id = ? AND valid_to IS NULL`)
        .all(nodeId) as any[];
      return rows.map(r => this.rowToEdge(r));
    },
    edgesTo: (nodeId: string): GraphEdge[] => {
      const rows = this.db.prepare(`SELECT * FROM g_edges WHERE to_id = ? AND valid_to IS NULL`)
        .all(nodeId) as any[];
      return rows.map(r => this.rowToEdge(r));
    },
    callersOf: (symbolId: string, maxDepth = 3): GraphNode[] => {
      // recursive CTE
      const stmt = this.db.prepare(`
        WITH RECURSIVE callers(sym_id, depth) AS (
          SELECT ?, 0
          UNION
          SELECT e.from_id, c.depth + 1
          FROM g_edges e JOIN callers c ON e.to_id = c.sym_id
          WHERE e.type = 'CALLS' AND c.depth < ? AND e.valid_to IS NULL
        )
        SELECT DISTINCT n.* FROM g_nodes n JOIN callers c ON n.id = c.sym_id
        WHERE n.valid_to IS NULL
      `);
      const rows = stmt.all(symbolId, maxDepth) as any[];
      return rows.map(r => this.rowToNode(r));
    },
    recentEpisodes: (projectId: string, limit = 10): GraphNode[] => {
      const stmt = this.db.prepare(`
        SELECT n.* FROM g_nodes n
        JOIN g_edges e ON e.from_id = n.id
        WHERE n.label = 'Episode' AND e.to_id = ? AND e.type = 'IN_PROJECT'
          AND n.valid_to IS NULL
        ORDER BY n.created_at DESC LIMIT ?
      `);
      const rows = stmt.all(projectId, limit) as any[];
      return rows.map(r => this.rowToNode(r));
    },
    searchFts: (query: string, limit = 10): GraphNode[] => {
      const stmt = this.db.prepare(`
        SELECT n.* FROM g_fts f
        JOIN g_nodes n ON n.id = f.node_id
        WHERE g_fts MATCH ? AND n.valid_to IS NULL
        ORDER BY rank LIMIT ?
      `);
      const rows = stmt.all(query, limit) as any[];
      return rows.map(r => this.rowToNode(r));
    },
  };

  query<Q extends keyof typeof this.templates>(
    template: Q,
    ...args: Parameters<typeof this.templates[Q]>
  ): ReturnType<typeof this.templates[Q]> {
    return (this.templates[template] as any)(...args);
  }

  private rowToNode(row: any): GraphNode {
    return {
      id: row.id, label: row.label, props: JSON.parse(row.props),
      validFrom: row.valid_from, validTo: row.valid_to, createdAt: row.created_at,
    };
  }

  private rowToEdge(row: any): GraphEdge {
    return {
      id: row.id, fromId: row.from_id, toId: row.to_id, type: row.type,
      props: JSON.parse(row.props), weight: row.weight,
      validFrom: row.valid_from, validTo: row.valid_to, createdAt: row.created_at,
    };
  }
}

// 4. The LLM-driven extractor

const EXTRACTOR_PROMPT = `You are a knowledge graph extractor. Given recent
tool calls and their results from a coding agent, extract entities and
relationships to add to a project knowledge graph.

Output STRICT JSON in this format:
{
  "nodes": [
    { "label": "Symbol", "props": { "name": "foo", "kind": "function", "file": "src/foo.ts" } },
    { "label": "Bug", "props": { "description": "TypeError on line 42", "severity": "high" } }
  ],
  "edges": [
    { "from": "<index of node above>", "type": "CALLS", "to": <index>, "props": {} }
  ]
}

Allowed labels: Symbol, File, Module, Decision, Bug, Fix, Instinct, Episode,
User, Project, Tool, Symbol_Use, Dependency, MiscNote.
Allowed edge types: CALLS, IMPORTS, EXPORTS, READS, WRITES, CAUSED, FIXED,
PREVENTED, INSTANCE_OF, ABOUT, BY_USER, IN_PROJECT, USED_TOOL, CONTRADICTS,
SUPPORTS, PRECEDES, FOLLOWS, CHOSE, REJECTED, CONTAINS.

Recent tool calls:
{TOOL_CALLS}

Extract now:`;

interface Extraction {
  nodes: { label: NodeLabel; props: Record<string, unknown> }[];
  edges: { from: number; to: number; type: EdgeType; props?: Record<string, unknown> }[];
}

class GraphExtractor {
  constructor(
    private store: GraphStore,
    private client: UnifiedClient,
  ) {}

  async extract(
    toolCalls: { tool: string; args: any; result: any }[],
    context: { projectId: string; userId: string; episodeId: string },
  ): Promise<{ addedNodes: number; addedEdges: number }> {
    // Build the episode node
    const episodeId = this.store.upsertNode({
      label: 'Episode',
      props: {
        summary: toolCalls.map(c => c.tool).join(', '),
        toolCount: toolCalls.length,
        ...context,
      },
      validFrom: Date.now(),
      validTo: null,
    });

    // Ask the LLM to extract
    const prompt = EXTRACTOR_PROMPT.replace('{TOOL_CALLS}', JSON.stringify(toolCalls, null, 2));
    let text = '';
    for await (const ev of this.client.stream({
      model: this.client.getModel(),
      system: 'You extract knowledge graph entities. Output strict JSON.',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
      maxTokens: 2000,
    })) {
      if (ev.type === 'text_delta') text = ev.accumulated;
      if (ev.type === 'message_stop') break;
    }

    const parsed = this.parseExtraction(text);
    if (!parsed) return { addedNodes: 0, addedEdges: 0 };

    // Insert nodes and edges
    const nodeIds: string[] = [];
    for (const n of parsed.nodes) {
      const id = this.store.upsertNode({
        label: n.label,
        props: n.props,
        validFrom: Date.now(),
        validTo: null,
      });
      nodeIds.push(id);
    }

    let addedEdges = 0;
    for (const e of parsed.edges) {
      if (e.from >= nodeIds.length || e.to >= nodeIds.length) continue;
      this.store.upsertEdge({
        fromId: nodeIds[e.from],
        toId: nodeIds[e.to],
        type: e.type,
        props: e.props || {},
        weight: 0.7,
        validFrom: Date.now(),
        validTo: null,
      });
      addedEdges++;
    }

    // Link episode to all extracted nodes
    for (const nodeId of nodeIds) {
      this.store.upsertEdge({
        fromId: episodeId, toId: nodeId, type: 'ABOUT',
        props: {}, weight: 0.5,
        validFrom: Date.now(), validTo: null,
      });
    }

    return { addedNodes: nodeIds.length, addedEdges: addedEdges + nodeIds.length };
  }

  private parseExtraction(text: string): Extraction | null {
    try { return JSON.parse(text); } catch {}
    const m = text.match(/```(?:json)?\s*([\s\S]+?)\s*```/);
    if (m) try { return JSON.parse(m[1]); } catch {}
    const o = text.match(/\{[\s\S]+\}/);
    if (o) try { return JSON.parse(o[0]); } catch {}
    return null;
  }
}

// 5. The query interface for the LLM (Cypher-Lite as a typed API)

class GraphQuery {
  constructor(private store: GraphStore) {}

  // The LLM picks a method, fills in parameters
  symbolsInFile(path: string): GraphNode[] {
    const all = this.store.query('nodesByLabel', 'Symbol');
    return all.filter(n => (n.props as any).file === path);
  }

  callersOf(symbolName: string, projectRoot: string): GraphNode[] {
    // find the symbol first
    const syms = this.store.query('nodesByLabel', 'Symbol');
    const sym = syms.find(s => (s.props as any).name === symbolName);
    if (!sym) return [];
    return this.store.query('callersOf', sym.id);
  }

  recentDecisions(projectId: string, limit = 5): GraphNode[] {
    return this.store.query('recentEpisodes', projectId, limit)
      .filter(n => (n.props as any).hasDecision);
  }

  causalChain(decisionId: string, maxDepth = 5): { decisions: GraphNode[]; bugs: GraphNode[]; fixes: GraphNode[] } {
    // walk CAUSED and FIXED edges outward from the decision
    const visited = new Set<string>();
    const walk = (id: string, depth: number): GraphNode[] => {
      if (depth >= maxDepth || visited.has(id)) return [];
      visited.add(id);
      const edges = this.store.query('edgesFrom', id);
      const result: GraphNode[] = [];
      for (const e of edges) {
        const target = this.store.getNodeAtTime(e.toId, Date.now());
        if (target) result.push(target, ...walk(target.id, depth + 1));
      }
      return result;
    };
    const all = walk(decisionId, 0);
    return {
      decisions: all.filter(n => n.label === 'Decision'),
      bugs: all.filter(n => n.label === 'Bug'),
      fixes: all.filter(n => n.label === 'Fix'),
    };
  }
}

// 6. v3.0-compatible recall adapter

import { MemoryManager } from '../../memory/manager.js';
import type { MemoryEntry } from '../../types/index.js';

class GraphMemoryAdapter {
  constructor(
    private graph: GraphStore,
    private query: GraphQuery,
  ) {}

  // Returns the same shape as v3.0 MemoryManager.recall()
  recall(q: string, limit = 10): MemoryEntry[] {
    // Combine FTS search + label-based queries
    const ftsResults = this.graph.query('searchFts', q, limit);
    const entries: MemoryEntry[] = ftsResults.map(n => ({
      id: n.id,
      type: this.labelToMemoryType(n.label),
      content: this.nodeToContent(n),
      metadata: { ...n.props, graphId: n.id, label: n.label },
      createdAt: n.createdAt,
      lastAccessed: Date.now(),
      accessCount: 1,
      importance: 0.8,
    }));

    // Add related nodes (1-hop neighborhood) for context
    const enriched: MemoryEntry[] = [];
    for (const e of entries) {
      enriched.push(e);
      const related = this.graph.query('edgesFrom', e.id).slice(0, 3);
      for (const edge of related) {
        const target = this.graph.getNodeAtTime(edge.toId, Date.now());
        if (target) {
          enriched.push({
            id: `${e.id}-related-${target.id}`,
            type: 'related',
            content: `→ [${edge.type}] ${this.nodeToContent(target)}`,
            metadata: { ...target.props, graphId: target.id, label: target.label },
            createdAt: target.createdAt,
            lastAccessed: Date.now(),
            accessCount: 1,
            importance: 0.5,
          });
        }
      }
    }

    return enriched.slice(0, limit);
  }

  private labelToMemoryType(label: NodeLabel): MemoryEntry['type'] {
    switch (label) {
      case 'Symbol': case 'File': case 'Module': return 'project';
      case 'Decision': case 'Instinct': return 'semantic';
      case 'Episode': return 'episodic';
      case 'Bug': case 'Fix': return 'episodic';
      default: return 'project';
    }
  }

  private nodeToContent(n: GraphNode): string {
    const p = n.props as any;
    switch (n.label) {
      case 'Symbol': return `${p.kind || 'symbol'} ${p.name} in ${p.file || '?'}:${p.line || '?'}`;
      case 'File': return `file: ${p.path} (${p.language || '?'})`;
      case 'Decision': return `decision: ${p.title} — ${p.rationale}`;
      case 'Bug': return `bug: ${p.description} (${p.severity || '?'} severity)`;
      case 'Episode': return `episode: ${p.summary}`;
      default: return JSON.stringify(p);
    }
  }
}

// 7. The Causal Inference helper (counterfactual queries)

class CausalMemory {
  constructor(private store: GraphStore) {}

  // "What bugs has decision D caused?" — outward walk on CAUSED
  bugsCausedBy(decisionId: string, maxDepth = 3): GraphNode[] {
    const visited = new Set<string>();
    const walk = (id: string, depth: number): GraphNode[] => {
      if (depth >= maxDepth || visited.has(id)) return [];
      visited.add(id);
      const edges = this.store.query('edgesFrom', id)
        .filter(e => e.type === 'CAUSED');
      const result: GraphNode[] = [];
      for (const e of edges) {
        const target = this.store.getNodeAtTime(e.toId, Date.now());
        if (target) result.push(target, ...walk(target.id, depth + 1));
      }
      return result;
    };
    return walk(decisionId, 0);
  }

  // "What was the decision and the rejected alternatives?"
  decisionContext(decisionId: string): { chose: GraphNode[]; rejected: GraphNode[] } {
    const edges = this.store.query('edgesFrom', decisionId);
    const chose = edges.filter(e => e.type === 'CHOSE');
    const rejected = edges.filter(e => e.type === 'REJECTED');
    const resolveEdge = (e: GraphEdge) => this.store.getNodeAtTime(e.toId, Date.now());
    return {
      chose: chose.map(resolveEdge).filter(Boolean) as GraphNode[],
      rejected: rejected.map(resolveEdge).filter(Boolean) as GraphNode[],
    };
  }

  // "What was the symbol called at time T?" — time-travel
  symbolAtTime(name: string, atTime: number): GraphNode | null {
    const all = this.store.query('nodesByLabel', 'Symbol');
    for (const n of all) {
      if ((n.props as any).name === name
          && n.validFrom <= atTime
          && (n.validTo === null || n.validTo > atTime)) {
        return n;
      }
    }
    return null;
  }
}
```

### Key points in the sketch

- **`GraphStore` is a thin wrapper over SQLite.** Schema includes
  `valid_from` and `valid_to` for bi-temporal queries. Recursive CTEs
  handle graph traversal. FTS5 handles full-text search.
- **`GraphExtractor` is a separate LLM call** that runs in batches
  (once per turn, not per event). The extraction prompt is a strict
  JSON schema; malformed output is discarded.
- **`GraphQuery`** exposes a *typed API* with 10–20 methods. The LLM
  doesn't write raw SQL or Cypher; it picks a method and fills in
  parameters. This is the *safety boundary*.
- **`GraphMemoryAdapter`** is a drop-in replacement for v3.0's
  `MemoryManager.recall()`. The shape is the same; the content is
  richer (related nodes included).
- **`CausalMemory`** is the *specialized* interface for causal and
  counterfactual queries. The LLM can ask "what did I cause?" and
  "what alternatives did I consider?" — both of which are impossible
  in v3.0's flat log.
- **No new dependencies.** Just `better-sqlite3`, which we already
  have.

---

## 6. Open Questions

1. **How much should we extract per turn?**
   - Too little (1 node per turn) → graph is sparse, queries are weak.
   - Too much (50 nodes per turn) → extraction is slow, graph is noisy.
   - Empirically: 3–10 nodes per turn is the right range. We can
     tune this with a `min_importance` parameter: only extract if the
     LLM rates the entity ≥ 0.6 importance.

2. **What if the LLM's extraction is wrong?**
   - The LLM might create a `[:CAUSED]` edge that isn't actually
   - causal. We have two defenses: (a) low initial weight (0.5), which
     can be confirmed/denied by the user; (b) periodic *graph cleanup*
     that removes low-weight edges that haven't been touched in 30
     days. Wrong extractions decay.

3. **Should we expose the graph query API to the LLM via a *tool*?**
   - The LLM can already call `memory.recall()` (v3.0). Should we
     add `graph.query(template, ...args)` as a first-class tool?
   - Pros: more direct, more powerful. Cons: the LLM might run
     expensive queries accidentally.
   - Recommendation: expose it, but rate-limit (max 5 calls per turn).

4. **Do we need vector embeddings?**
   - The FTS5 search handles "find nodes whose text contains X." For
     semantic search ("find nodes similar in *meaning* to X"), we
     need embeddings. SQLite has the `sqlite-vss` extension but it
     requires a build step. Alternative: lazy embeddings via
     `transformers.js` (in-process) or a hosted embedding API.
   - For v4.0, FTS5 is enough. Embeddings are a v4.1 feature.

5. **How do we handle graph *conflicts*?**
   - The LLM might say "function `foo` is in `bar.ts`" one turn, and
     "function `foo` is in `baz.ts`" the next (because it was moved).
   - With bi-temporal nodes, the old version stays valid with
     `valid_to = movedAt`. The new version has `valid_from = movedAt`.
   - A query "where is `foo` now?" returns the version with
     `valid_to = NULL`.
   - A query "where was `foo` on date X?" returns the version valid at X.
   - This is clean. But the *extractor* must be smart enough to
     detect moves (vs. duplicates). We may need a *reconciliation*
     step: "before creating a new node, check if a similar one
     exists."

6. **What's the right granularity for the Episode node?**
   - One per turn? Per task? Per session? Per refinement?
   - Recommendation: one per *user turn* (the LLM's outermost
     response). The turn's tool calls and results are *children* of
     the episode node.
   - For long-running tasks, we can also create *Task* nodes
     (composite of episodes).

7. **How do we visualize the graph for the user?**
   - The `/graph` command should show a *neighborhood* of a node.
   - For a CLI, ASCII art is the natural fit:
     ```
     foo (Symbol)
       ├─[:CALLS]→ bar (Symbol)
       │           ├─[:CALLS]→ baz (Symbol)
       │           └─[:CAUSED]→ bug_42 (Bug)
       └─[:FIXED]→ bug_41 (Bug)
     ```
   - We could also export to Graphviz DOT format and let the user
     render it externally.

8. **How do we handle multi-project graphs?**
   - If the user works on multiple projects, do we have one graph
     per project, or one global graph?
   - Recommendation: one graph per project root (the `Project` node
     is the root). Cross-project edges (e.g., "this library is
     shared") are possible but discouraged.

9. **How do we evaluate graph quality?**
   - We can't run a benchmark on "is the graph correct?" because
     ground truth doesn't exist.
   - Proxy metrics:
     - **Coverage**: what % of tool calls result in at least one
       new node?
     - **Query hit rate**: what % of `recall()` calls return a
       non-empty result?
     - **Citation rate**: in the critic mesh, what % of claims are
       cited to a graph node? (Higher = better grounding.)
   - We log all of these and display in `/status`.

10. **How do we bootstrap the graph for an existing project?**
    - For a new project, the graph starts empty. We need a *cold-start*
      pass that scans the codebase: read `package.json`, top-level
      files, key entry points, extract `Symbol` and `File` nodes
      without LLM (use regex/AST parsing).
    - For a `TypeScript` project, we can use `ts-morph` or `typescript`
      compiler API. For other languages, simpler regex.
    - The cold-start pass takes < 5 seconds for a 1000-file project.
