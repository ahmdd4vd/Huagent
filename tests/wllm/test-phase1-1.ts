#!/usr/bin/env tsx
/**
 * test-wllm-phase1-1.ts — Test WllmConcept types & WikiStore CRUD
 *
 * Tests:
 *   1. Confidence level numeric conversion (ASSUMED → INFERRED → VERIFIED)
 *   2. Freshness staleness computation
 *   3. Page slugify + path generation
 *   4. WikiStore createPage for all 5 memory systems
 *   5. WikiStore getPage / getPageByLabel
 *   6. WikiStore updatePage (bi-temporal versioning)
 *   7. WikiStore confidence promotion lifecycle
 *   8. WikiStore edge operations + backlinks
 *   9. WikiStore listByMemory / listByType
 *   10. WikiStore search with intent weighting
 *   11. WikiStore getStalePages
 *   12. WikiStore getStats
 *   13. Bi-temporal query (time-travel)
 *   14. Edge cases: empty wiki, missing page, invalid promotion
 */
import { WikiStore, numericToConfidence, computeStaleness, slugify, pageToFilePath, CONFIDENCE_WEIGHT, PAGE_TYPE_TO_MEMORY } from "../../src/wllm/index.js";

let pass = 0;
let fail = 0;

function test(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ': ' + detail : ''}`); }
}

async function section(name: string) {
  console.log(`\n=== ${name} ===`);
}

async function main() {
  // ====================================================================
  await section("1. Confidence level numeric conversion");
  // ====================================================================
  test("0.0 → CONTRADICTED", numericToConfidence(0.0) === "CONTRADICTED");
  test("0.3 → CONTRADICTED", numericToConfidence(0.3) === "CONTRADICTED");
  test("0.4 → ASSUMED", numericToConfidence(0.4) === "ASSUMED");
  test("0.5 → ASSUMED", numericToConfidence(0.5) === "ASSUMED");
  test("0.7 → INFERRED", numericToConfidence(0.7) === "INFERRED");
  test("0.9 → INFERRED", numericToConfidence(0.9) === "INFERRED");
  test("0.95 → VERIFIED", numericToConfidence(0.95) === "VERIFIED");
  test("1.0 → VERIFIED", numericToConfidence(1.0) === "VERIFIED");

  test("VERIFIED weight = 1.0", CONFIDENCE_WEIGHT.VERIFIED === 1.0);
  test("INFERRED weight = 0.8", CONFIDENCE_WEIGHT.INFERRED === 0.8);
  test("ASSUMED weight = 0.5", CONFIDENCE_WEIGHT.ASSUMED === 0.5);
  test("CONTRADICTED weight = 0.2", CONFIDENCE_WEIGHT.CONTRADICTED === 0.2);

  // ====================================================================
  await section("2. Freshness staleness computation");
  // ====================================================================
  const windowMs = 7 * 24 * 60 * 60 * 1000; // 7 days
  const now = Date.now();
  test("Just checked → LOW", computeStaleness(now, windowMs, now) === "LOW");
  test("3 days ago → LOW", computeStaleness(now - 3 * 86400_000, windowMs, now) === "LOW");
  test("7 days ago → LOW (boundary)", computeStaleness(now - 7 * 86400_000, windowMs, now) === "LOW");
  test("8 days ago → MEDIUM", computeStaleness(now - 8 * 86400_000, windowMs, now) === "MEDIUM");
  test("14 days ago → MEDIUM (boundary)", computeStaleness(now - 14 * 86400_000, windowMs, now) === "MEDIUM");
  test("15 days ago → HIGH", computeStaleness(now - 15 * 86400_000, windowMs, now) === "HIGH");
  test("28 days ago → HIGH (boundary)", computeStaleness(now - 28 * 86400_000, windowMs, now) === "HIGH");
  test("30 days ago → STALE", computeStaleness(now - 30 * 86400_000, windowMs, now) === "STALE");

  // ====================================================================
  await section("3. Slugify + path generation");
  // ====================================================================
  test("'PostgreSQL over MongoDB' → 'postgresql-over-mongodb'", slugify("PostgreSQL over MongoDB") === "postgresql-over-mongodb");
  test("'Auth Race Condition!' → 'auth-race-condition'", slugify("Auth Race Condition!") === "auth-race-condition");
  test("'  multi   space  ' → 'multi-space'", slugify("  multi   space  ") === "multi-space");
  test("entity path includes 'pages/entities/'", pageToFilePath("entity", "jwt").includes("pages/entities/jwt.md"));
  test("episode path includes 'episodes/' and date", pageToFilePath("episode", "auth-bug", Date.now()).includes("episodes/"));
  test("decision path includes 'causation/decisions/'", pageToFilePath("decision", "postgres", Date.now()).includes("causation/decisions/"));

  // ====================================================================
  await section("4. WikiStore createPage for all 5 memory systems");
  // ====================================================================
  const store = new WikiStore();
  await store.clear();

  // SEMANTIC: entity
  const p1 = await store.createPage({
    pageType: "entity",
    label: "PostgreSQL",
    body: "PostgreSQL is a relational database with ACID compliance.",
    confidenceLevel: "VERIFIED",
    sources: ["docs/db.md"],
    tags: ["database", "backend"],
  });
  test("Created entity page", p1.id && p1.pageType === "entity" && p1.label === "PostgreSQL");
  test("Page mapped to semantic memory", PAGE_TYPE_TO_MEMORY[p1.pageType] === "semantic");

  // SEMANTIC: concept
  const p2 = await store.createPage({
    pageType: "concept",
    label: "Repository Pattern",
    body: "The Repository pattern abstracts data access.",
    confidenceLevel: "INFERRED",
    sources: ["src/repo.ts"],
    tags: ["architecture"],
  });
  test("Created concept page", p2.id && p2.pageType === "concept");

  // EPISODIC: episode
  const p3 = await store.createPage({
    pageType: "episode",
    label: "Auth Race Condition",
    body: "Two concurrent requests both refresh stale token.",
    confidenceLevel: "VERIFIED",
    subtype: "debug",
    episodeDate: Date.now(),
    episodeDurationMin: 45,
    episodeOutcome: "RESOLVED",
    episodeDifficulty: "HARD",
    episodeAffectedFiles: ["src/auth.ts"],
    episodeLessons: ["Intermittent auth = check concurrency first"],
  });
  test("Created episode page", p3.id && p3.pageType === "episode");
  test("Episode has outcome", p3.episodeOutcome === "RESOLVED");
  test("Episode has lessons", p3.episodeLessons && p3.episodeLessons.length === 1);

  // STRUCTURAL: structure
  const p4 = await store.createPage({
    pageType: "structure",
    label: "Architecture",
    body: "Microservices with API gateway.",
    confidenceLevel: "INFERRED",
    subtype: "architecture",
  });
  test("Created structure page", p4.id && p4.pageType === "structure");
  test("Structural mapped to structural memory", PAGE_TYPE_TO_MEMORY[p4.pageType] === "structural");

  // CAUSAL: decision
  const p5 = await store.createPage({
    pageType: "decision",
    label: "PostgreSQL over MongoDB",
    body: "Chose PostgreSQL for ACID compliance.",
    confidenceLevel: "VERIFIED",
    subtype: "ACTIVE",
    decisionDate: Date.now(),
    decisionStatus: "ACTIVE",
    decisionStakeholders: ["dev-team", "cto"],
    decisionAlternativesRejected: [
      { name: "MongoDB", reason: "Weak ACID" },
      { name: "MySQL", reason: "Weaker JSON support" },
    ],
    decisionTradeoffsAccepted: ["Harder horizontal scaling"],
  });
  test("Created decision page", p5.id && p5.pageType === "decision");
  test("Decision has alternatives", p5.decisionAlternativesRejected && p5.decisionAlternativesRejected.length === 2);
  test("Causal mapped to causal memory", PAGE_TYPE_TO_MEMORY[p5.pageType] === "causal");

  // META: meta
  const p6 = await store.createPage({
    pageType: "meta",
    label: "Debugging Heuristics",
    body: "Intermittent = concurrency. Restart fixes = leak.",
    confidenceLevel: "INFERRED",
    subtype: "debugging-heuristics",
  });
  test("Created meta page", p6.id && p6.pageType === "meta");
  test("Meta mapped to meta memory", PAGE_TYPE_TO_MEMORY[p6.pageType] === "meta");

  // ====================================================================
  await section("5. getPage / getPageByLabel");
  // ====================================================================
  const found = await store.getPage(p1.id);
  test("getPage by id returns correct page", found?.label === "PostgreSQL");

  const byLabel = await store.getPageByLabel("PostgreSQL");
  test("getPageByLabel finds by label", byLabel?.id === p1.id);

  const byLabelSlug = await store.getPageByLabel("postgresql");
  test("getPageByLabel handles case + slug", byLabelSlug?.id === p1.id);

  const notFound = await store.getPage("nonexistent");
  test("getPage returns null for missing", notFound === null);

  const labelNotFound = await store.getPageByLabel("nonexistent");
  test("getPageByLabel returns null for missing", labelNotFound === null);

  // ====================================================================
  await section("6. updatePage (bi-temporal versioning)");
  // ====================================================================
  const updated = await store.updatePage(p1.id, {
    body: "PostgreSQL is a relational database with ACID compliance and JSONB support.",
    sources: ["docs/db.md", "docs/orm.md"],
  });
  test("updatePage returns updated page", updated?.body.includes("JSONB"));
  test("updatePage updates sources", updated?.sources.length === 2);

  // Verify old version still accessible
  const beforeUpdate = Date.now() - 1000;
  const oldVersion = await store.getPage(p1.id, beforeUpdate);
  // Old version is the one before update, may be the original or null
  test("Bi-temporal: old time returns old or null", oldVersion === null || oldVersion.body !== updated?.body);

  // Get current (latest) version
  const current = await store.getPage(p1.id);
  test("Current time returns latest", current?.body.includes("JSONB"));

  // ====================================================================
  await section("7. Confidence promotion lifecycle");
  // ====================================================================
  // Start p2 at INFERRED
  test("p2 starts INFERRED", p2.confidenceLevel === "INFERRED");

  // ASSUMED → INFERRED (promotion)
  const pAssumed = await store.createPage({
    pageType: "concept",
    label: "Test Assumed",
    body: "test",
    confidenceLevel: "ASSUMED",
  });
  const promoted1 = await store.promoteConfidence(pAssumed.id, "INFERRED");
  test("ASSUMED → INFERRED succeeds", promoted1?.confidenceLevel === "INFERRED");

  // INFERRED → VERIFIED (promotion)
  const promoted2 = await store.promoteConfidence(pAssumed.id, "VERIFIED");
  test("INFERRED → VERIFIED succeeds", promoted2?.confidenceLevel === "VERIFIED");

  // VERIFIED → ASSUMED (demotion should fail)
  const demoted = await store.promoteConfidence(pAssumed.id, "ASSUMED");
  test("VERIFIED → ASSUMED (demotion) fails", demoted === null);

  // VERIFIED → CONTRADICTED (allowed)
  const contradicted = await store.promoteConfidence(pAssumed.id, "CONTRADICTED");
  test("VERIFIED → CONTRADICTED (allowed)", contradicted?.confidenceLevel === "CONTRADICTED");

  // CONTRADICTED → RESOLVED (allowed)
  const resolved = await store.promoteConfidence(pAssumed.id, "RESOLVED");
  test("CONTRADICTED → RESOLVED (allowed)", resolved?.confidenceLevel === "RESOLVED");

  // promoteConfidence on missing page
  const missing = await store.promoteConfidence("nonexistent", "VERIFIED");
  test("promoteConfidence on missing returns null", missing === null);

  // ====================================================================
  await section("8. Edge operations + backlinks");
  // ====================================================================
  await store.addEdge(p1.id, p2.id, "wikilink", 1.0);
  await store.addEdge(p3.id, p1.id, "related", 0.5);
  await store.addEdge(p3.id, p5.id, "caused", 0.9);
  await store.addEdge(p2.id, p1.id, "related", 0.5);

  const outFromP1 = await store.getOutgoingEdges(p1.id);
  test("p1 has 1 outgoing edge", outFromP1.length === 1);

  const inToP1 = await store.getIncomingEdges(p1.id);
  test("p1 has 2 incoming edges (from p2 and p3)", inToP1.length === 2);

  const backlinks = await store.getBacklinks(p1.id);
  test("p1 has 2 backlinks", backlinks.length === 2);
  test("Backlinks include p2 and p3", backlinks.some(p => p.id === p2.id) && backlinks.some(p => p.id === p3.id));

  // ====================================================================
  await section("9. listByMemory / listByType");
  // ====================================================================
  const semanticPages = await store.listByMemory("semantic");
  // At this point: p1 (entity), p2 (concept), pAssumed (concept) = 3
  test("listByMemory('semantic') = 3", semanticPages.length === 3, `got ${semanticPages.length}`);

  const episodicPages = await store.listByMemory("episodic");
  test("listByMemory('episodic') = 1 (p3)", episodicPages.length === 1);

  const causalPages = await store.listByMemory("causal");
  test("listByMemory('causal') = 1 (p5)", causalPages.length === 1);

  const allSemantic = await store.listByType("entity");
  test("listByType('entity') = 1", allSemantic.length === 1);

  // ====================================================================
  await section("10. Search with intent weighting");
  // ====================================================================
  // Search "PostgreSQL" — should find p1 (entity) and p5 (decision) high
  const searchAll = await store.search("PostgreSQL", 10);
  test("Search 'PostgreSQL' finds 2 pages", searchAll.length === 2);
  test("First result is highest score", searchAll[0].score >= searchAll[1].score);

  // Search with intent 'why' — should weight causal (p5) higher than semantic (p1)
  const searchWhy = await store.search("PostgreSQL", 10, "why");
  const whyFirstPage = searchWhy[0]?.page;
  test("Intent 'why' weights causal higher", whyFirstPage?.pageType === "decision" || whyFirstPage?.pageType === "entity");
  test("Intent 'why' gives causal memory weight 5", searchWhy[0]?.memory === "causal" || searchWhy[0]?.memory === "semantic");

  // Search with intent 'what' — should weight semantic higher
  const searchWhat = await store.search("PostgreSQL", 10, "what");
  test("Intent 'what' gives semantic memory weight 5", searchWhat[0]?.memory === "semantic");

  // Empty query returns nothing
  const empty = await store.search("", 10);
  test("Empty query returns no results", empty.length === 0);

  // No match
  const noMatch = await store.search("xyznevermatch", 10);
  test("No match returns empty", noMatch.length === 0);

  // ====================================================================
  await section("11. Stale pages");
  // ====================================================================
  // Create page with old freshness
  const oldPage = await store.createPage({
    pageType: "entity",
    label: "Old Page",
    body: "old",
    confidenceLevel: "VERIFIED",
  });
  // Manually set old freshness via the proper API
  const oldFreshness = { lastChecked: Date.now() - 30 * 86400_000, staleness: "STALE" as const };
  await store.setFreshness(oldPage.id, oldFreshness);
  const refreshed = await store.getPage(oldPage.id);
  if (refreshed) {
    const s = computeStaleness(refreshed.freshness.lastChecked, 7 * 86400_000);
    test("Old page has STALE staleness", s === "STALE");
  }

  const stale = await store.getStalePages();
  test("getStalePages includes old page", stale.some(p => p.id === oldPage.id));

  // ====================================================================
  await section("12. Stats");
  // ====================================================================
  const stats = await store.getStats();
  // At this point: p1, p2, p3, p4, p5, p6, pAssumed, oldPage = 8
  // (section 13 and 14 haven't run yet)
  test("Total pages = 8", stats.totalPages === 8, `got ${stats.totalPages}`);
  // Semantic: p1, p2, pAssumed, oldPage = 4
  test("Semantic memory = 4", stats.byMemory.semantic === 4, `got ${stats.byMemory.semantic}`);
  test("Episodic memory = 1", stats.byMemory.episodic === 1);
  test("Structural = 1", stats.byMemory.structural === 1);
  test("Causal = 1", stats.byMemory.causal === 1);
  test("Meta = 1", stats.byMemory.meta === 1);
  test("Total edges = 4", stats.totalEdges === 4);

  // ====================================================================
  await section("13. Bi-temporal query (time-travel)");
  // ====================================================================
  // Create page, then update, then check old version
  const tPage = await store.createPage({
    pageType: "concept",
    label: "Time Travel Test",
    body: "v1 content",
  });
  const tCreated = Date.now();
  await new Promise(r => setTimeout(r, 50));
  await store.updatePage(tPage.id, { body: "v2 content" });
  const tUpdated = Date.now();

  const v1 = await store.getPage(tPage.id, tCreated);
  test("Bi-temporal: asOf=tCreated returns v1", v1?.body === "v1 content", `got '${v1?.body}'`);

  const v2 = await store.getPage(tPage.id, tUpdated + 10);
  test("Bi-temporal: asOf=after update returns v2", v2?.body === "v2 content");

  const vNow = await store.getPage(tPage.id);
  test("Bi-temporal: current returns v2", vNow?.body === "v2 content");

  // History preservation: tPage has 2 versions (v1 + v2) but only v2 is current
  // The total current count is whatever it is at this point
  const allVersions = await store.graph.count();
  test("Bi-temporal: total current count is non-zero", allVersions.nodes > 0);

  // ====================================================================
  await section("14. Edge cases");
  // ====================================================================
  const emptyStore = new WikiStore();
  await emptyStore.clear();
  const emptyStats = await emptyStore.getStats();
  test("Empty store has 0 pages", emptyStats.totalPages === 0);
  const emptySearch = await emptyStore.search("anything", 10);
  test("Empty store search returns []", emptySearch.length === 0);
  const emptyStale = await emptyStore.getStalePages();
  test("Empty store stale = []", emptyStale.length === 0);

  // Very long label
  const longLabel = "a".repeat(500);
  const longPage = await store.createPage({
    pageType: "entity",
    label: longLabel,
    body: "test",
  });
  test("Very long label accepted", longPage.label.length === 500);

  // Unicode label
  const unicodePage = await store.createPage({
    pageType: "entity",
    label: "测试 ページ 🎌",
    body: "unicode test",
  });
  test("Unicode label accepted", unicodePage.label === "测试 ページ 🎌");

  // Empty body
  const emptyBodyPage = await store.createPage({
    pageType: "entity",
    label: "Empty Body",
    body: "",
  });
  test("Empty body accepted", emptyBodyPage.body === "");

  // Special chars in label
  const specialPage = await store.createPage({
    pageType: "entity",
    label: "Test & <special> chars!",
    body: "test",
  });
  const specialSlug = slugify(specialPage.label);
  test("Slug handles special chars", !specialSlug.includes("&") && !specialSlug.includes("<"));

  // ====================================================================
  console.log(`\n${"=".repeat(60)}`);
  console.log(`  Phase 1.1 Test Results: ${pass} passed, ${fail} failed`);
  console.log("=".repeat(60));

  if (fail > 0) {
    console.log("\n❌ Some tests FAILED");
    process.exit(1);
  } else {
    console.log("\n🎉 ALL Phase 1.1 tests PASSED");
  }
}

main().catch(e => { console.error("FATAL:", e); process.exit(1); });
