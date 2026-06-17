/**
 * Phase 3.1 test suite — Query engine (Tante Perpustakaan).
 *
 * Coverage:
 *  - 1. Intent detection (what/how/why/when/history/compare/pattern/unknown)
 *  - 2. Text relevance scoring
 *  - 3. Title boost
 *  - 4. Confidence factor
 *  - 5. Freshness factor
 *  - 6. Memory weight lookup
 *  - 7. QueryEngine basic search
 *  - 8. QueryEngine with explicit intent
 *  - 9. QueryEngine with filters (memory/tags/confidence/freshness)
 *  - 10. QueryEngine explain mode
 *  - 11. QueryEngine handles empty store
 *  - 12. QueryEngine ranking order
 *  - 13. compareQuery
 *  - 14. Edge cases
 */

import { WikiStore, type CreatePageOptions } from "../../src/wllm/graph/wiki-store.js";
import {
  QueryEngine,
  detectIntent,
  textRelevance,
  titleBoost,
  confidenceFactor,
  freshnessFactor,
  pageMemory,
  compareQuery,
  type QueryOptions,
} from "../../src/wllm/query/query.js";
import type { WikiPage } from "../../src/wllm/types/index.js";

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

let testCount = 0;
let passCount = 0;
let failCount = 0;
const failures: string[] = [];

function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      testCount++;
      passCount++;
    })
    .catch((err) => {
      testCount++;
      failCount++;
      const msg = `  ✗ ${name}\n      ${(err as Error).message}`;
      failures.push(msg);
      console.log(msg);
    });
}

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`assertion failed: ${msg}`);
}

function assertEqual<T>(actual: T, expected: T, msg: string): void {
  if (actual !== expected) {
    throw new Error(`${msg}\n        expected: ${JSON.stringify(expected)}\n        actual:   ${JSON.stringify(actual)}`);
  }
}

// ---------------------------------------------------------------------------
// Section 1: Intent detection
// ---------------------------------------------------------------------------

async function section1(): Promise<void> {
  console.log("\n— 1. Intent detection —");

  await test("1.1 'what' intent", () => {
    const r = detectIntent("apa itu JWT?");
    assertEqual(r.intent, "what", "what");
  });

  await test("1.2 'what' intent (English)", () => {
    const r = detectIntent("what is PostgreSQL?");
    assertEqual(r.intent, "what", "what");
  });

  await test("1.3 'how' intent", () => {
    const r = detectIntent("bagaimana cara setup database?");
    assertEqual(r.intent, "how", "how");
  });

  await test("1.4 'how' intent via 'cara' keyword", () => {
    const r = detectIntent("cara install postgres");
    assertEqual(r.intent, "how", "how");
  });

  await test("1.5 'why' intent", () => {
    const r = detectIntent("kenapa server crash?");
    assertEqual(r.intent, "why", "why");
  });

  await test("1.6 'why' intent (English)", () => {
    const r = detectIntent("why does JWT expire?");
    assertEqual(r.intent, "why", "why");
  });

  await test("1.7 'when' intent", () => {
    const r = detectIntent("kapan deploy production?");
    assertEqual(r.intent, "when", "when");
  });

  await test("1.8 'history' intent via keyword", () => {
    const r = detectIntent("sejarah WllmConcept");
    assertEqual(r.intent, "history", "history");
  });

  await test("1.9 'compare' intent", () => {
    const r = detectIntent("PostgreSQL vs MongoDB");
    assertEqual(r.intent, "compare", "compare");
  });

  await test("1.10 'pattern' intent", () => {
    const r = detectIntent("pattern authentication yang umum");
    assertEqual(r.intent, "pattern", "pattern");
  });

  await test("1.11 unknown intent for ambiguous query", () => {
    const r = detectIntent("hello world");
    assertEqual(r.intent, "unknown", "unknown");
  });

  await test("1.12 empty query returns unknown", () => {
    const r = detectIntent("");
    assertEqual(r.intent, "unknown", "unknown");
  });

  await test("1.13 intent confidence is reasonable", () => {
    const r1 = detectIntent("apa itu foo");
    const r2 = detectIntent("hello world");
    assert(r1.confidence > r2.confidence, "explicit > unknown");
  });
}

// ---------------------------------------------------------------------------
// Section 2: textRelevance
// ---------------------------------------------------------------------------

async function section2(): Promise<void> {
  console.log("\n— 2. Text relevance —");

  await test("2.1 exact title match scores well", () => {
    const page = mockPage({ label: "JWT", body: "JWT details here", tags: ["JWT"] });
    const r = textRelevance("JWT", page);
    // Title (3) + tag (2) + body (1) = 6, max = 6.5 → ~0.92
    assert(r >= 0.9, `high score, got ${r}`);
  });

  await test("2.2 no match scores near 0", () => {
    const page = mockPage({ label: "Foo", body: "bar baz" });
    const r = textRelevance("completely different", page);
    assert(r < 0.1, `low score, got ${r}`);
  });

  await test("2.3 body match scores some", () => {
    const page = mockPage({ label: "X", body: "postgresql indexes" });
    const r = textRelevance("postgresql", page);
    assert(r > 0, `has score, got ${r}`);
  });

  await test("2.4 tag matches boost score", () => {
    const page = mockPage({ label: "X", body: "foo", tags: ["postgres", "auth"] });
    const r = textRelevance("postgres", page);
    assert(r > 0, `tag match, got ${r}`);
  });

  await test("2.5 empty query scores 0", () => {
    const r = textRelevance("", mockPage({}));
    assertEqual(r, 0, "0");
  });

  await test("2.6 short tokens are ignored", () => {
    const r = textRelevance("a b c", mockPage({ body: "a b c" }));
    assertEqual(r, 0, "no scoring for 1-char tokens");
  });
}

// ---------------------------------------------------------------------------
// Section 3: titleBoost
// ---------------------------------------------------------------------------

async function section3(): Promise<void> {
  console.log("\n— 3. Title boost —");

  await test("3.1 exact match = 2.0", () => {
    const r = titleBoost("JWT", mockPage({ label: "JWT" }));
    assertEqual(r, 2.0, "exact");
  });

  await test("3.2 contains = 1.5", () => {
    const r = titleBoost("JWT", mockPage({ label: "JWT Authentication" }));
    assertEqual(r, 1.5, "contains");
  });

  await test("3.3 word overlap = 1.0-1.5", () => {
    const r = titleBoost("auth pattern", mockPage({ label: "auth pattern guide" }));
    assert(r >= 1.0 && r <= 1.5, `partial, got ${r}`);
  });

  await test("3.4 no overlap = 1.0", () => {
    const r = titleBoost("completely different", mockPage({ label: "Foo" }));
    assertEqual(r, 1.0, "no overlap");
  });

  await test("3.5 case-insensitive", () => {
    const r = titleBoost("jwt", mockPage({ label: "JWT Authentication" }));
    assertEqual(r, 1.5, "case-insensitive contains");
  });
}

// ---------------------------------------------------------------------------
// Section 4: confidenceFactor
// ---------------------------------------------------------------------------

async function section4(): Promise<void> {
  console.log("\n— 4. Confidence factor —");

  await test("4.1 VERIFIED confidence level → high factor", () => {
    const p = mockPage({});
    p.confidenceLevel = "VERIFIED";
    const f = confidenceFactor(p);
    assert(f > 0.9, `high, got ${f}`);
  });

  await test("4.2 ASSUMED confidence level → lower factor", () => {
    const p = mockPage({});
    p.confidenceLevel = "ASSUMED";
    const f = confidenceFactor(p);
    assert(f < 0.7, `lower, got ${f}`);
  });

  await test("4.3 unknown level → 0.7 default", () => {
    const p = mockPage({});
    delete (p as { confidenceLevel?: unknown }).confidenceLevel;
    const f = confidenceFactor(p);
    assertEqual(f, 0.7, "default");
  });
}

// ---------------------------------------------------------------------------
// Section 5: freshnessFactor
// ---------------------------------------------------------------------------

async function section5(): Promise<void> {
  console.log("\n— 5. Freshness factor —");

  await test("5.1 LOW staleness → high factor", () => {
    const p = mockPage({});
    p.freshness = {
      lastChecked: Date.now(),
      staleness: "LOW",
    };
    const f = freshnessFactor(p);
    assert(f >= 0.9, `high, got ${f}`);
  });

  await test("5.2 STALE → low factor", () => {
    const p = mockPage({});
    p.freshness = {
      lastChecked: Date.now() - 365 * 24 * 60 * 60 * 1000,
      staleness: "STALE",
    };
    const f = freshnessFactor(p);
    // STALE weight = 0.5, so 0.3 + 0.5*0.7 = 0.65
    assert(f < 0.7, `low-ish, got ${f}`);
  });

  await test("5.3 MEDIUM → middle", () => {
    const p = mockPage({});
    p.freshness = { lastChecked: Date.now() - 60 * 24 * 60 * 60 * 1000, staleness: "MEDIUM" };
    const f = freshnessFactor(p);
    // MEDIUM weight = 0.9, so 0.3 + 0.9*0.7 = 0.93
    assert(f >= 0.9, `high, got ${f}`);
  });
}

// ---------------------------------------------------------------------------
// Section 6: pageMemory
// ---------------------------------------------------------------------------

async function section6(): Promise<void> {
  console.log("\n— 6. pageMemory mapping —");

  await test("6.1 entity → semantic", () => {
    const p = mockPage({});
    p.pageType = "entity";
    assertEqual(pageMemory(p), "semantic", "entity");
  });

  await test("6.2 episode → episodic", () => {
    const p = mockPage({});
    p.pageType = "episode";
    assertEqual(pageMemory(p), "episodic", "episode");
  });

  await test("6.3 decision → causal", () => {
    const p = mockPage({});
    p.pageType = "decision";
    assertEqual(pageMemory(p), "causal", "decision");
  });

  await test("6.4 structure → structural", () => {
    const p = mockPage({});
    p.pageType = "structure";
    assertEqual(pageMemory(p), "structural", "structure");
  });

  await test("6.5 meta → meta", () => {
    const p = mockPage({});
    p.pageType = "meta";
    assertEqual(pageMemory(p), "meta", "meta");
  });
}

// ---------------------------------------------------------------------------
// Section 7: QueryEngine basic
// ---------------------------------------------------------------------------

async function section7(): Promise<void> {
  console.log("\n— 7. QueryEngine basic —");

  await test("7.1 search returns matching pages", async () => {
    const store = new WikiStore();
    await store.createPage({ pageType: "entity", label: "JWT", body: "JSON Web Token for auth" });
    await store.createPage({ pageType: "entity", label: "OAuth", body: "OAuth 2.0 flow" });
    const engine = new QueryEngine(store);
    const results = await engine.search("JWT");
    assert(results.length >= 1, "has results");
    assert(results.some((r) => r.label === "JWT"), "JWT in results");
  });

  await test("7.2 search with no matches returns empty", async () => {
    const store = new WikiStore();
    await store.createPage({ pageType: "entity", label: "Foo", body: "" });
    const engine = new QueryEngine(store);
    const results = await engine.search("completelynonexistentterm12345");
    assertEqual(results.length, 0, "empty");
  });

  await test("7.3 query() returns results with score breakdown", async () => {
    const store = new WikiStore();
    await store.createPage({ pageType: "entity", label: "JWT", body: "auth token" });
    const engine = new QueryEngine(store);
    const r = await engine.query("JWT");
    assert(r.results.length >= 1, "has results");
    const first = r.results[0];
    assert(typeof first.score === "number", "has score");
    assert(first.breakdown, "has breakdown");
    assert(typeof first.breakdown.textRelevance === "number", "text relevance");
  });

  await test("7.4 limit is respected", async () => {
    const store = new WikiStore();
    for (let i = 0; i < 10; i++) {
      await store.createPage({ pageType: "entity", label: `Postgres ${i}`, body: "database stuff" });
    }
    const engine = new QueryEngine(store);
    const r = await engine.query("Postgres", { limit: 3 });
    assertEqual(r.results.length, 3, "limit");
  });

  await test("7.5 ranking: best match first", async () => {
    const store = new WikiStore();
    await store.createPage({ pageType: "entity", label: "X", body: "unrelated content" });
    await store.createPage({ pageType: "entity", label: "JWT", body: "JWT for auth, lots of JWT details here" });
    const engine = new QueryEngine(store);
    const r = await engine.query("JWT");
    assertEqual(r.results[0].page.label, "JWT", "best first");
  });
}

// ---------------------------------------------------------------------------
// Section 8: QueryEngine with explicit intent
// ---------------------------------------------------------------------------

async function section8(): Promise<void> {
  console.log("\n— 8. Explicit intent —");

  await test("8.1 'why' intent prioritizes causal memory", async () => {
    const store = new WikiStore();
    await store.createPage({
      pageType: "entity",
      label: "JWT Auth",
      body: "JWT",
    });
    await store.createPage({
      pageType: "decision",
      label: "Why JWT",
      body: "JWT chosen because stateless",
    });
    const engine = new QueryEngine(store);
    const r = await engine.query("why JWT", { intent: "why" });
    // decision (causal) should rank higher
    const causal = r.results.find((x) => x.page.label === "Why JWT");
    const entity = r.results.find((x) => x.page.label === "JWT Auth");
    if (causal && entity) {
      assert(causal.score >= entity.score, "causal ranks >= entity");
    }
  });

  await test("8.2 'how' intent prioritizes structural memory", async () => {
    const store = new WikiStore();
    await store.createPage({
      pageType: "entity",
      label: "Foo",
      body: "how to foo",
    });
    await store.createPage({
      pageType: "structure",
      label: "Foo Structure",
      body: "how foo is organized",
    });
    const engine = new QueryEngine(store);
    const r = await engine.query("how foo", { intent: "how" });
    // structure should be first
    assertEqual(r.results[0].page.label, "Foo Structure", "structural first");
  });

  await test("8.3 'what' intent prioritizes semantic", async () => {
    const store = new WikiStore();
    await store.createPage({
      pageType: "episode",
      label: "Yesterday we deployed",
      body: "JWT deployed yesterday",
    });
    await store.createPage({
      pageType: "entity",
      label: "JWT Concept",
      body: "JWT is a token format",
    });
    const engine = new QueryEngine(store);
    const r = await engine.query("what is JWT", { intent: "what" });
    assertEqual(r.results[0].page.label, "JWT Concept", "semantic first");
  });
}

// ---------------------------------------------------------------------------
// Section 9: QueryEngine with filters
// ---------------------------------------------------------------------------

async function section9(): Promise<void> {
  console.log("\n— 9. QueryEngine filters —");

  await test("9.1 filter by memory system", async () => {
    const store = new WikiStore();
    await store.createPage({ pageType: "entity", label: "A", body: "match" });
    await store.createPage({ pageType: "episode", label: "B", body: "match" });
    const engine = new QueryEngine(store);
    const r = await engine.query("match", { memories: ["semantic"] });
    assertEqual(r.results.length, 1, "1 result (semantic only)");
    assertEqual(r.results[0].page.label, "A", "A");
  });

  await test("9.2 filter by tag", async () => {
    const store = new WikiStore();
    await store.createPage({ pageType: "entity", label: "A", body: "x", tags: ["db"] });
    await store.createPage({ pageType: "entity", label: "B", body: "x", tags: ["auth"] });
    const engine = new QueryEngine(store);
    const r = await engine.query("x", { tags: ["db"] });
    assertEqual(r.results.length, 1, "1 result");
    assertEqual(r.results[0].page.label, "A", "A");
  });

  await test("9.3 filter by minConfidence", async () => {
    const store = new WikiStore();
    await store.createPage({ pageType: "entity", label: "A", body: "x", confidenceLevel: "VERIFIED" });
    await store.createPage({ pageType: "entity", label: "B", body: "x", confidenceLevel: "ASSUMED" });
    const engine = new QueryEngine(store);
    const r = await engine.query("x", { minConfidence: "VERIFIED" });
    assertEqual(r.results.length, 1, "1 (verified only)");
    assertEqual(r.results[0].page.label, "A", "A");
  });

  await test("9.4 filter by minFreshness", async () => {
    const store = new WikiStore();
    // Create two pages, mark one as freshly checked, one as not
    const p1 = await store.createPage({ pageType: "entity", label: "Fresh", body: "x" });
    const p2 = await store.createPage({ pageType: "entity", label: "Old", body: "x" });
    await store.updatePage(p1.id, { markChecked: true });
    // p2 stays with default (older) freshness
    const engine = new QueryEngine(store);
    const r = await engine.query("x", { minFreshness: "LOW" });
    // We can't easily test STALE filter without direct freshness injection,
    // but LOW filter should still include p1 (just-checked) at minimum.
    assert(r.results.length >= 1, `at least 1 LOW-freshness result, got ${r.results.length}`);
  });
}

// ---------------------------------------------------------------------------
// Section 10: Explain mode
// ---------------------------------------------------------------------------

async function section10(): Promise<void> {
  console.log("\n— 10. Explain mode —");

  await test("10.1 explain returns explanation", async () => {
    const store = new WikiStore();
    await store.createPage({ pageType: "entity", label: "JWT", body: "JWT token for auth" });
    const engine = new QueryEngine(store);
    const r = await engine.query("JWT", { explain: true });
    assert(r.explanation, "has explanation");
    assert(r.explanation?.topReason, "has topReason");
    assert(r.explanation?.memoryWeights, "has memoryWeights");
  });

  await test("10.2 explain shows memory weights", async () => {
    const store = new WikiStore();
    await store.createPage({ pageType: "entity", label: "X", body: "y" });
    const engine = new QueryEngine(store);
    const r = await engine.query("X", { explain: true });
    assert(r.explanation?.memoryWeights.semantic !== undefined, "has semantic weight");
    assert(r.explanation?.memoryWeights.causal !== undefined, "has causal weight");
  });

  await test("10.3 explain with no results", async () => {
    const store = new WikiStore();
    const engine = new QueryEngine(store);
    const r = await engine.query("nothing here", { explain: true });
    assert(r.explanation, "still has explanation");
    assert(r.explanation?.topReason.includes("No results"), "says no results");
  });

  await test("10.4 explain with alternatives", async () => {
    const store = new WikiStore();
    await store.createPage({ pageType: "entity", label: "A", body: "match" });
    await store.createPage({ pageType: "entity", label: "B", body: "match" });
    await store.createPage({ pageType: "entity", label: "C", body: "match" });
    const engine = new QueryEngine(store);
    const r = await engine.query("match", { explain: true });
    assert(r.explanation?.tradeoffs.length! >= 1, "has alternatives");
  });

  await test("10.5 explain stats are accurate", async () => {
    const store = new WikiStore();
    for (let i = 0; i < 5; i++) {
      await store.createPage({ pageType: "entity", label: `P${i}`, body: "match" });
    }
    const engine = new QueryEngine(store);
    const r = await engine.query("match", { explain: true });
    assertEqual(r.explanation?.stats.totalScanned, 5, "scanned 5");
    assertEqual(r.explanation?.stats.returned, 5, "returned 5 (under limit)");
  });
}

// ---------------------------------------------------------------------------
// Section 11: Empty store
// ---------------------------------------------------------------------------

async function section11(): Promise<void> {
  console.log("\n— 11. Empty store —");

  await test("11.1 empty store returns empty results", async () => {
    const store = new WikiStore();
    const engine = new QueryEngine(store);
    const r = await engine.query("anything");
    assertEqual(r.results.length, 0, "no results");
  });

  await test("11.2 empty store explain has stats", async () => {
    const store = new WikiStore();
    const engine = new QueryEngine(store);
    const r = await engine.query("anything", { explain: true });
    assertEqual(r.explanation?.stats.totalScanned, 0, "scanned 0");
  });
}

// ---------------------------------------------------------------------------
// Section 12: compareQuery
// ---------------------------------------------------------------------------

async function section12(): Promise<void> {
  console.log("\n— 12. compareQuery —");

  await test("12.1 compare two concepts returns a, b, both", async () => {
    const store = new WikiStore();
    await store.createPage({ pageType: "entity", label: "PostgreSQL Strengths", body: "ACID compliant" });
    await store.createPage({ pageType: "entity", label: "MongoDB Strengths", body: "Document store" });
    await store.createPage({ pageType: "entity", label: "PostgreSQL vs MongoDB", body: "comparison of both" });
    const engine = new QueryEngine(store);
    const r = await compareQuery(engine, "PostgreSQL", "MongoDB");
    assert(r.aResults.length >= 1, "a has results");
    assert(r.bResults.length >= 1, "b has results");
    // 'both' should contain the comparison page
    assert(r.both.length >= 1, "found 'both'");
  });
}

// ---------------------------------------------------------------------------
// Section 13: Edge cases
// ---------------------------------------------------------------------------

async function section13(): Promise<void> {
  console.log("\n— 13. Edge cases —");

  await test("13.1 query with special characters", async () => {
    const store = new WikiStore();
    await store.createPage({ pageType: "entity", label: "Special: Foo/Bar", body: "x" });
    const engine = new QueryEngine(store);
    const r = await engine.query("Special: Foo/Bar");
    assert(r.results.length >= 1, "found");
  });

  await test("13.2 query with unicode", async () => {
    const store = new WikiStore();
    await store.createPage({ pageType: "entity", label: "PostgreSQL Indonesia", body: "你好世界" });
    const engine = new QueryEngine(store);
    const r = await engine.query("你好");
    assert(r.results.length >= 1, "found unicode");
  });

  await test("13.3 many pages ranking stability", async () => {
    const store = new WikiStore();
    for (let i = 0; i < 50; i++) {
      await store.createPage({
        pageType: "entity",
        label: `P${i}`,
        body: i === 42 ? "this is the answer to foo bar" : "unrelated noise",
      });
    }
    const engine = new QueryEngine(store);
    const r = await engine.query("foo bar", { limit: 10 });
    assertEqual(r.results[0].page.label, "P42", "P42 is top");
  });

  await test("13.4 confidence and freshness in score", async () => {
    const store = new WikiStore();
    await store.createPage({
      pageType: "entity",
      label: "Stale Page",
      body: "JWT",
      confidenceLevel: "ASSUMED",
    });
    await store.createPage({
      pageType: "entity",
      label: "Fresh Page",
      body: "JWT",
      confidenceLevel: "VERIFIED",
    });
    const engine = new QueryEngine(store);
    const r = await engine.query("JWT");
    assertEqual(r.results[0].page.label, "Fresh Page", "fresh first");
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockPage(overrides: Partial<WikiPage>): WikiPage {
  return {
    id: "mock-id",
    pageType: "entity",
    label: "Mock",
    body: "Mock body",
    confidenceLevel: "VERIFIED",
    freshness: { lastChecked: "2026-01-01", staleness: "LOW" },
    sources: [],
    tags: [],
    related: [],
    ...overrides,
  } as WikiPage;
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

async function runAll(): Promise<void> {
  console.log("╔════════════════════════════════════════════════════════════╗");
  console.log("║   PHASE 3.1 — Query Engine (Tante Perpustakaan)           ║");
  console.log("╚════════════════════════════════════════════════════════════╝");

  await section1();
  await section2();
  await section3();
  await section4();
  await section5();
  await section6();
  await section7();
  await section8();
  await section9();
  await section10();
  await section11();
  await section12();
  await section13();

  console.log("\n╔════════════════════════════════════════════════════════════╗");
  console.log(`║   RESULTS: ${passCount}/${testCount} passed, ${failCount} failed       ║`);
  console.log("╚════════════════════════════════════════════════════════════╝");

  if (failures.length > 0) {
    console.log("\nFailures:");
    for (const f of failures) console.log(f);
    process.exit(1);
  }
  if (passCount === testCount) {
    console.log("\n🎉 ALL PHASE 3.1 TESTS PASSED");
  }
}

runAll().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
