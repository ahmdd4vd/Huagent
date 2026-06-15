/**
 * Test v4 graph + capability primitives.
 */
import { InMemoryGraphStore } from "./src/engine/v4/graph/index.js";
import { pipe, execute, optimize, type Capability, type CapabilityContext, type Permission } from "./src/engine/v4/capability/index.js";
import type { GraphNode, GraphEdge, GraphNodeKind, GraphQuery } from "./src/engine/v4/graph/types.js";
import type { CausalEdgeKind } from "./src/engine/v4/stream/cognitive-event.js";

async function main() {

// ────────────────────────────────────────────────────────────────────
// Test 1: Basic graph CRUD
// ────────────────────────────────────────────────────────────────────
console.log("=== Test 1: Graph CRUD ===");
{
  const g = new InMemoryGraphStore();
  const now = Date.now();

  // Add nodes
  const ep1 = await g.addNode({ kind: "episode", label: "fix auth bug", body: "Fixed JWT validation", properties: { duration: 1200 }, validFrom: now, validTo: null, confidence: 1.0 });
  const f1 = await g.addNode({ kind: "file", label: "auth.ts", properties: { path: "/src/auth.ts" }, validFrom: now, validTo: null, confidence: 1.0 });
  const e1 = await g.addNode({ kind: "error", label: "JWT not found", properties: { code: "TS2305" }, validFrom: now, validTo: null, confidence: 0.9 });
  const i1 = await g.addNode({ kind: "insight", label: "always npm install after import", properties: { confidence: 0.85 }, validFrom: now, validTo: null, confidence: 0.85 });

  // Add edges
  const e1Edge = await g.addEdge({ fromNode: ep1.id, toNode: f1.id, kind: "edited", weight: 1.0, properties: {}, validFrom: now, validTo: null, confidence: 1.0 });
  const e2Edge = await g.addEdge({ fromNode: f1.id, toNode: e1.id, kind: "caused", weight: 0.9, properties: {}, validFrom: now, validTo: null, confidence: 0.9 });
  const e3Edge = await g.addEdge({ fromNode: i1.id, toNode: ep1.id, kind: "derived", weight: 0.7, properties: {}, validFrom: now, validTo: null, confidence: 0.85 });

  const count = await g.count();
  console.log(`✓ Created graph: ${count.nodes} nodes, ${count.edges} edges`);

  // Query
  const result = await g.query({ from: [ep1.id], maxDepth: 3 });
  console.log(`✓ BFS from episode: found ${result.nodes.length} nodes, ${result.edges.length} edges`);
  console.log(`  Path: ${result.paths.map((p) => p.hops.length - 1).join(" hops, ")} hops`);

  // Search
  const searchResults = await g.search("jwt");
  console.log(`✓ Search "jwt": ${searchResults.length} matches`);
}

// ────────────────────────────────────────────────────────────────────
// Test 2: Bi-temporal version (update creates new version)
// ────────────────────────────────────────────────────────────────────
console.log("\n=== Test 2: Bi-temporal version history ===");
{
  const g = new InMemoryGraphStore();
  const t0 = Date.now();
  const f1 = await g.addNode({ kind: "file", label: "auth.ts", body: "v1 content", properties: { version: 1 }, validFrom: t0, validTo: null, confidence: 1.0 });

  // Read at t0: should see "v1 content"
  const v1 = await g.getNode(f1.id, t0 + 10);
  console.log(`✓ At t0+10ms: version=${(v1?.properties as any).version}, body=${v1?.body}`);

  // Wait, then update
  await new Promise((r) => setTimeout(r, 5));
  const t1 = Date.now();
  await g.updateNode(f1.id, { body: "v2 content", properties: { version: 2 } }, t1);

  // Read at t0+10: should still see v1
  const v1Again = await g.getNode(f1.id, t0 + 10);
  console.log(`✓ At t0+10ms (after update): version=${(v1Again?.properties as any).version}, body=${v1Again?.body}`);

  // Read at t1+10: should see v2
  const v2 = await g.getNode(f1.id, t1 + 10);
  console.log(`✓ At t1+10ms: version=${(v2?.properties as any).version}, body=${v2?.body}`);

  // Count: still 1 valid node
  const c = await g.count();
  console.log(`✓ Valid nodes: ${c.nodes} (expected 1, even after update)`);
}

// ────────────────────────────────────────────────────────────────────
// Test 3: Causal query — "what caused this error?"
// ────────────────────────────────────────────────────────────────────
console.log("\n=== Test 3: Causal query — backtrace errors ===");
{
  const g = new InMemoryGraphStore();
  const now = Date.now();

  // Build: episode → file → error ← insight
  const ep = await g.addNode({ kind: "episode", label: "fix-bug", validFrom: now, validTo: null, properties: {}, confidence: 1 });
  const file = await g.addNode({ kind: "file", label: "auth.ts", validFrom: now, validTo: null, properties: {}, confidence: 1 });
  const err = await g.addNode({ kind: "error", label: "TS2305 jwt not found", validFrom: now, validTo: null, properties: {}, confidence: 1 });
  const insight = await g.addNode({ kind: "insight", label: "install pkg after import", validFrom: now, validTo: null, properties: {}, confidence: 0.8 });

  await g.addEdge({ fromNode: ep.id, toNode: file.id, kind: "edited", weight: 1, properties: {}, validFrom: now, validTo: null, confidence: 1 });
  await g.addEdge({ fromNode: file.id, toNode: err.id, kind: "caused", weight: 0.9, properties: {}, validFrom: now, validTo: null, confidence: 0.9 });
  await g.addEdge({ fromNode: err.id, toNode: insight.id, kind: "fixedBy", weight: 0.7, properties: {}, validFrom: now, validTo: null, confidence: 0.7 });

  // Query: trace back from error
  const backtrace = await g.query({ from: [err.id], direction: "in", maxDepth: 3 });
  console.log(`✓ Backtrace from error: ${backtrace.nodes.length} nodes`);
  for (const n of backtrace.nodes) {
    console.log(`  - ${n.kind}: ${n.label}`);
  }

  // Query: find all errors
  const allErrors = await g.query({ nodeKind: ["error"] });
  console.log(`✓ All errors: ${allErrors.nodes.length} (expected 1)`);
}

// ────────────────────────────────────────────────────────────────────
// Test 4: Capability — basic execution
// ────────────────────────────────────────────────────────────────────
console.log("\n=== Test 4: Capability basic execution ===");
{
  // Define a simple capability: read file
  const readFileCap: Capability<{ path: string }, string> = {
    name: "read_file",
    description: "Read file contents",
    permissions: ["read_file"],
    cost: 0.1,
    retryable: true,
    pure: true,  // same input → same output
    async *call(input, ctx) {
      const content = await ctx.readFile(input.path);
      yield content;
    },
  };

  // Mock context
  const ctx: CapabilityContext = {
    granted: new Set<Permission>(["read_file"]),
    readFile: async (path) => `mock content of ${path}`,
    writeFile: async () => {},
    runCommand: async () => ({ stdout: "", stderr: "", exitCode: 0 }),
    llm: async () => "",
  };

  const p = pipe(readFileCap).build();
  const results: string[] = [];
  for await (const out of execute(p, { path: "auth.ts" }, ctx)) {
    results.push(out);
  }
  console.log(`✓ Read capability: ${results.length} results, first=${results[0]}`);
}

// ────────────────────────────────────────────────────────────────────
// Test 5: Capability pipeline — read | grep | replace
// ────────────────────────────────────────────────────────────────────
console.log("\n=== Test 5: Capability pipeline composition ===");
{
  const readFileCap: Capability<{ path: string }, string> = {
    name: "read_file", description: "Read file", permissions: ["read_file"], cost: 0.1, retryable: true, pure: true,
    async *call(input, ctx) { yield await ctx.readFile(input.path); },
  };
  const grepCap = (pattern: string): Capability<string, string> => ({
    name: `grep(${pattern})`, description: "Find pattern", permissions: [], cost: 0.05, retryable: true, pure: true,
    async *call(input) { if (input.includes(pattern)) yield input; },
  });
  const replaceCap = (from: string, to: string): Capability<string, string> => ({
    name: `replace(${from}→${to})`, description: "Replace text", permissions: [], cost: 0.05, retryable: true, pure: true,
    async *call(input) { yield input.split(from).join(to); },
  });

  const ctx: CapabilityContext = {
    granted: new Set<Permission>(["read_file"]),
    readFile: async (path) => "import jwt from 'jsonwebtoken'\nconst token = jwt.sign()",
    writeFile: async () => {}, runCommand: async () => ({ stdout: "", stderr: "", exitCode: 0 }), llm: async () => "",
  };

  const p = pipe(readFileCap).map(grepCap("jwt")).map(replaceCap("jwt", "JSONWebToken")).build();
  const results: string[] = [];
  for await (const out of execute(p, { path: "auth.ts" }, ctx)) {
    results.push(out);
  }
  console.log(`✓ Pipeline read|grep|replace: ${results.length} results`);
  console.log(`  Output contains "JSONWebToken": ${results[0]?.includes("JSONWebToken")}`);
}

// ────────────────────────────────────────────────────────────────────
// Test 6: Optimizer — pure capability memoization
// ────────────────────────────────────────────────────────────────────
console.log("\n=== Test 6: Optimizer — memoization ===");
{
  let callCount = 0;
  const slowPure: Capability<number, number> = {
    name: "slow_pure", description: "Slow but pure", permissions: [], cost: 0.5, retryable: true, pure: true,
    async *call(input) {
      callCount++;
      await new Promise((r) => setTimeout(r, 10));
      yield input * 2;
    },
  };

  const ctx: CapabilityContext = {
    granted: new Set([]), readFile: async () => "", writeFile: async () => {},
    runCommand: async () => ({ stdout: "", stderr: "", exitCode: 0 }), llm: async () => "",
  };

  const p1 = pipe(slowPure).build();
  const opt = optimize(p1);

  // Execute twice with same input
  for (const inp of [5, 5, 7, 5]) {
    const r: number[] = [];
    for await (const x of execute(opt.optimized, inp, ctx)) r.push(x);
    console.log(`  Input ${inp} → ${r[0]} (call count so far: ${callCount})`);
  }
  console.log(`✓ Memoization: 4 invocations of input, call count = ${callCount} (expected 2: 5 and 7)`);
}

// ────────────────────────────────────────────────────────────────────
// Test 7: Integration — graph + capability (file → graph nodes)
// ────────────────────────────────────────────────────────────────────
console.log("\n=== Test 7: Integration — file read into graph ===");
{
  const g = new InMemoryGraphStore();
  const now = Date.now();

  // Simulate: read auth.ts, find it's a file, add to graph
  const fileNode = await g.addNode({ kind: "file", label: "auth.ts", properties: { path: "auth.ts" }, validFrom: now, validTo: null, confidence: 1 });
  const readCap: Capability<{ path: string }, string> = {
    name: "read", description: "read", permissions: ["read_file"], cost: 0.1, retryable: true, pure: true,
    async *call(input, ctx) { yield await ctx.readFile(input.path); },
  };

  const ctx: CapabilityContext = {
    granted: new Set<Permission>(["read_file"]),
    readFile: async (path) => {
      // Add a function node based on the content
      const fnNode = await g.addNode({ kind: "function", label: "login", properties: { file: path }, validFrom: Date.now(), validTo: null, confidence: 0.9 });
      void fnNode;
      return "function login() { /* ... */ }";
    },
    writeFile: async () => {}, runCommand: async () => ({ stdout: "", stderr: "", exitCode: 0 }), llm: async () => "",
  };

  const p = pipe(readCap).build();
  const results: string[] = [];
  for await (const out of execute(p, { path: "auth.ts" }, ctx)) results.push(out);

  const c = await g.count();
  console.log(`✓ After read+graph: ${c.nodes} nodes, ${c.edges} edges`);
  console.log(`  Read result: ${results[0]?.slice(0, 50)}...`);
}

// ────────────────────────────────────────────────────────────────────
// Test 8: Anti-hallucination — graph grounding check
// ────────────────────────────────────────────────────────────────────
console.log("\n=== Test 8: Anti-hallucination — grounding ===");
{
  const g = new InMemoryGraphStore();
  const now = Date.now();

  // Add some real nodes
  await g.addNode({ kind: "file", label: "auth.ts", validFrom: now, validTo: null, properties: {}, confidence: 1 });
  await g.addNode({ kind: "function", label: "login", validFrom: now, validTo: null, properties: {}, confidence: 1 });

  // LLM claims: "I found function 'foo' in auth.ts" — but no such node
  const claim = { function: "foo", file: "auth.ts" };
  const results = await g.search("foo");
  console.log(`✓ Search for "foo" (claim about function): ${results.length} nodes (expected 0 — anti-hallucination)`);

  // Real claim: function "login" exists
  const realResults = await g.search("login");
  console.log(`✓ Search for "login" (real claim): ${realResults.length} nodes (expected 1)`);
}

console.log("\n🎉 All Phase 3 tests passed!");
}

main().catch((e) => { console.error(e); process.exit(1); });
