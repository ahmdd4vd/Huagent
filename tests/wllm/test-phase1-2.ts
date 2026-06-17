#!/usr/bin/env tsx
/**
 * test-wllm-phase1-2.ts — Test SQLite backend
 */
import { WikiStore } from "../../src/wllm/index.js";
import { SqliteGraphStore } from "../../src/engine/v4/graph/sqlite-store.js";
import { unlinkSync, existsSync } from "fs";

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
  await section("1. SqliteGraphStore basic CRUD");
  // ====================================================================
  const dbPath = "/tmp/wllm-test-1.db";
  if (existsSync(dbPath)) unlinkSync(dbPath);
  if (existsSync(dbPath + "-wal")) unlinkSync(dbPath + "-wal");
  if (existsSync(dbPath + "-shm")) unlinkSync(dbPath + "-shm");

  const store1 = new SqliteGraphStore({ path: dbPath });
  const wiki1 = new WikiStore({ graph: store1 });
  await wiki1.clear();

  const p1 = await wiki1.createPage({
    pageType: "entity",
    label: "PostgreSQL",
    body: "PostgreSQL is a relational database with ACID compliance.",
    confidenceLevel: "VERIFIED",
    sources: ["docs/db.md"],
    tags: ["database", "backend"],
  });
  test("Created page in SQLite", p1.id && p1.label === "PostgreSQL");

  const p2 = await wiki1.createPage({
    pageType: "decision",
    label: "PostgreSQL over MongoDB",
    body: "Chose PostgreSQL for ACID compliance.",
    confidenceLevel: "VERIFIED",
    decisionStatus: "ACTIVE",
  });
  test("Created decision page", p2.id && p2.pageType === "decision");

  await wiki1.addEdge(p1.id, p2.id, "wikilink", 1.0);
  const count1 = await wiki1.graph.count();
  test("SQLite: 2 nodes, 1 edge", count1.nodes === 2 && count1.edges === 1);

  // ====================================================================
  await section("2. Persistence across instances (THE key feature)");
  // ====================================================================
  // Close current store
  store1.close();

  // Open a NEW store on the same file
  const store2 = new SqliteGraphStore({ path: dbPath });
  const wiki2 = new WikiStore({ graph: store2 });

  const reloaded = await wiki2.getPage(p1.id);
  test("Reloaded page exists", reloaded?.label === "PostgreSQL");
  test("Reloaded body intact", reloaded?.body.includes("ACID"));
  test("Reloaded confidenceLevel intact", reloaded?.confidenceLevel === "VERIFIED");
  test("Reloaded sources intact", reloaded?.sources.length === 1);

  const reloaded2 = await wiki2.getPage(p2.id);
  test("Reloaded decision page", reloaded2?.decisionStatus === "ACTIVE");

  const reloadedCount = await wiki2.graph.count();
  test("Reloaded: 2 nodes, 1 edge", reloadedCount.nodes === 2 && reloadedCount.edges === 1);

  // ====================================================================
  await section("3. In-memory mode (':memory:')");
  // ====================================================================
  const memStore = new SqliteGraphStore({ path: ":memory:" });
  const memWiki = new WikiStore({ graph: memStore });
  const memPage = await memWiki.createPage({
    pageType: "concept",
    label: "Test",
    body: "test",
  });
  test("In-memory page created", memPage.id);
  const memCount = await memWiki.graph.count();
  test("In-memory: 1 node", memCount.nodes === 1);
  memStore.close();

  // ====================================================================
  await section("4. Bi-temporal persistence");
  // ====================================================================
  store2.close();
  if (existsSync(dbPath)) unlinkSync(dbPath);

  const store3 = new SqliteGraphStore({ path: dbPath });
  const wiki3 = new WikiStore({ graph: store3 });
  await wiki3.clear();

  const tPage = await wiki3.createPage({ pageType: "concept", label: "Time Travel", body: "v1" });
  const tCreated = Date.now();
  await new Promise(r => setTimeout(r, 50));
  await wiki3.updatePage(tPage.id, { body: "v2" });
  const tUpdated = Date.now();

  store3.close();

  // Reopen
  const store4 = new SqliteGraphStore({ path: dbPath });
  const wiki4 = new WikiStore({ graph: store4 });

  const v1 = await wiki4.getPage(tPage.id, tCreated);
  test("SQLite bi-temporal: v1 retrieved", v1?.body === "v1");

  const v2 = await wiki4.getPage(tPage.id, tUpdated + 100);
  test("SQLite bi-temporal: v2 retrieved", v2?.body === "v2");

  const vNow = await wiki4.getPage(tPage.id);
  test("SQLite bi-temporal: current is v2", vNow?.body === "v2");

  store4.close();

  // ====================================================================
  await section("5. All 5 memory types in SQLite");
  // ====================================================================
  if (existsSync(dbPath)) unlinkSync(dbPath);
  const store5 = new SqliteGraphStore({ path: dbPath });
  const wiki5 = new WikiStore({ graph: store5 });
  await wiki5.clear();

  const types: Array<{ type: any; label: string; extra?: any }> = [
    { type: "entity", label: "PostgreSQL" },
    { type: "concept", label: "Repository Pattern" },
    { type: "episode", label: "Auth Bug", extra: { subtype: "debug", episodeOutcome: "RESOLVED" } },
    { type: "structure", label: "Architecture", extra: { subtype: "architecture" } },
    { type: "decision", label: "Postgres", extra: { decisionStatus: "ACTIVE" } },
    { type: "meta", label: "Heuristics", extra: { subtype: "debugging-heuristics" } },
  ];

  for (const t of types) {
    await wiki5.createPage({ pageType: t.type, label: t.label, body: "test", confidenceLevel: "VERIFIED", ...t.extra });
  }

  const stats = await wiki5.getStats();
  test("SQLite: 6 pages total", stats.totalPages === 6);
  test("SQLite: 2 semantic", stats.byMemory.semantic === 2);
  test("SQLite: 1 episodic", stats.byMemory.episodic === 1);
  test("SQLite: 1 structural", stats.byMemory.structural === 1);
  test("SQLite: 1 causal", stats.byMemory.causal === 1);
  test("SQLite: 1 meta", stats.byMemory.meta === 1);

  store5.close();

  // ====================================================================
  await section("6. Concurrent updates");
  // ====================================================================
  if (existsSync(dbPath)) unlinkSync(dbPath);
  const store6 = new SqliteGraphStore({ path: dbPath });
  const wiki6 = new WikiStore({ graph: store6 });
  await wiki6.clear();

  const cPage = await wiki6.createPage({ pageType: "entity", label: "Counter", body: "0" });
  // Sequential updates (SQLite is single-writer; better-sqlite3 is sync)
  for (let i = 1; i <= 10; i++) {
    await wiki6.updatePage(cPage.id, { body: String(i) });
  }
  const final = await wiki6.getPage(cPage.id);
  test("SQLite: 10 sequential updates", final?.body === "10");

  store6.close();

  // ====================================================================
  await section("7. Large dataset");
  // ====================================================================
  if (existsSync(dbPath)) unlinkSync(dbPath);
  const store7 = new SqliteGraphStore({ path: dbPath });
  const wiki7 = new WikiStore({ graph: store7 });
  await wiki7.clear();

  const t0 = Date.now();
  for (let i = 0; i < 100; i++) {
    await wiki7.createPage({
      pageType: "entity",
      label: `Entity ${i}`,
      body: `Description of entity ${i} with some content to search through`,
      confidenceLevel: "INFERRED",
    });
  }
  const elapsed = Date.now() - t0;
  test(`SQLite: 100 inserts in ${elapsed}ms`, elapsed < 5000);

  // Search should find them
  const hits = await wiki7.search("Description", 5);
  test("SQLite: FTS/LIKE search works", hits.length > 0);

  // Bi-temporal on bulk data
  const page20 = (await wiki7.listByType("entity"))[20];
  const origValidFrom = page20.validFrom;
  await new Promise(r => setTimeout(r, 20));
  await wiki7.updatePage(page20.id, { body: "UPDATED" });
  const orig = await wiki7.getPage(page20.id, origValidFrom);
  test("SQLite bi-temporal: original preserved in bulk", orig?.body.includes("Description of entity 20"));

  store7.close();

  // Cleanup
  if (existsSync(dbPath)) unlinkSync(dbPath);
  if (existsSync(dbPath + "-wal")) unlinkSync(dbPath + "-wal");
  if (existsSync(dbPath + "-shm")) unlinkSync(dbPath + "-shm");

  // ====================================================================
  console.log(`\n${"=".repeat(60)}`);
  console.log(`  Phase 1.2 Test Results: ${pass} passed, ${fail} failed`);
  console.log("=".repeat(60));

  if (fail > 0) {
    console.log("\n❌ Some tests FAILED");
    process.exit(1);
  } else {
    console.log("\n🎉 ALL Phase 1.2 tests PASSED");
  }
}

main().catch(e => { console.error("FATAL:", e); process.exit(1); });
