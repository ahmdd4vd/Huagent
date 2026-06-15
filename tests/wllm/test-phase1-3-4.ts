#!/usr/bin/env tsx
/**
 * test-wllm-phase1-3-4.ts — Test Markdown export/import roundtrip
 *
 * Tests:
 *   1. pageToMarkdown for entity page
 *   2. pageToMarkdown for concept page
 *   3. pageToMarkdown for episode (all fields)
 *   4. pageToMarkdown for decision (all fields)
 *   5. pageToMarkdown for structure/meta pages
 *   6. pageToMarkdown handles special chars in YAML
 *   7. markdownToPage parses simple frontmatter
 *   8. markdownToPage parses lists
 *   9. markdownToPage parses nested fields
 *   10. markdownToPage handles missing frontmatter
 *   11. Extract [[wikilinks]] from body
 *   12. Full roundtrip: page → md → page (preserves all fields)
 *   13. Export to directory + read back
 *   14. Import from sample WllmConcept-format markdown
 *   15. Update existing page (re-import)
 */
import { WikiStore } from "../../src/wllm/index.js";
import { pageToMarkdown, exportAllPages, writePageMarkdown } from "../../src/wllm/sync/markdown-export.js";
import { markdownToPage, importMarkdownFile, importMarkdownDir, extractWikilinks } from "../../src/wllm/sync/markdown-import.js";
import { mkdtemp, rm, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { existsSync } from "node:fs";

let pass = 0;
let fail = 0;
const failures: string[] = [];

function test(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else {
    fail++;
    failures.push(`${name}${detail ? ': ' + detail : ''}`);
    console.log(`  ✗ ${name}${detail ? ': ' + detail : ''}`);
  }
}

async function section(name: string) {
  console.log(`\n=== ${name} ===`);
}

async function main() {
  // ====================================================================
  await section("1. pageToMarkdown for entity page");
  // ====================================================================
  {
    const p: any = {
      id: "test-1",
      kind: "entity",
      pageType: "entity",
      label: "PostgreSQL",
      body: "PostgreSQL is a relational database with ACID compliance.",
      properties: {},
      confidence: 1.0,
      confidenceLevel: "VERIFIED",
      freshness: { lastChecked: 1700000000000, staleness: "LOW" },
      sources: ["docs/db.md"],
      tags: ["database", "backend"],
      related: ["[[mysql]]"],
      validFrom: 1700000000000,
      validTo: null,
      recordedAt: 1700000000000,
    };
    const md = pageToMarkdown(p);
    test("Entity page has frontmatter", md.startsWith("---"));
    test("Entity page has type: entity", md.includes("type: entity"));
    test("Entity page has confidence: VERIFIED", md.includes("confidence: VERIFIED"));
    test("Entity page has sources list", md.includes("- docs/db.md"));
    test("Entity page has tags list", md.includes("- database"));
    test("Entity page has related with wikilink", md.includes("[[mysql]]"));
    test("Entity page has H1 with label", md.includes("# PostgreSQL"));
    test("Entity page has body", md.includes("PostgreSQL is a relational database"));
  }

  // ====================================================================
  await section("2. pageToMarkdown for concept page");
  // ====================================================================
  {
    const p: any = {
      id: "test-2",
      kind: "concept",
      pageType: "concept",
      label: "Repository Pattern",
      body: "Abstracts data access.",
      properties: {},
      confidence: 0.8,
      confidenceLevel: "INFERRED",
      freshness: { lastChecked: 1700000000000, staleness: "LOW" },
      sources: [],
      tags: [],
      related: [],
      validFrom: 1700000000000,
      validTo: null,
      recordedAt: 1700000000000,
    };
    const md = pageToMarkdown(p);
    test("Concept page: type: concept", md.includes("type: concept"));
    test("Concept page: confidence: INFERRED", md.includes("confidence: INFERRED"));
    test("Concept page: no sources when empty", !md.includes("sources:"));
  }

  // ====================================================================
  await section("3. pageToMarkdown for episode (all fields)");
  // ====================================================================
  {
    const p: any = {
      id: "ep-1",
      kind: "episode",
      pageType: "episode",
      label: "Auth Race Condition",
      body: "Race condition in token refresh.",
      properties: {},
      confidence: 1.0,
      confidenceLevel: "VERIFIED",
      freshness: { lastChecked: 1700000000000, staleness: "LOW" },
      sources: ["debug-session"],
      tags: ["auth", "race-condition"],
      related: [],
      validFrom: 1700000000000,
      validTo: null,
      recordedAt: 1700000000000,
      subtype: "debug",
      episodeDate: 1700000000000,
      episodeDurationMin: 45,
      episodeOutcome: "RESOLVED",
      episodeDifficulty: "HARD",
      episodeAffectedFiles: ["src/auth.ts"],
      episodeLessons: ["Intermittent = concurrency"],
    };
    const md = pageToMarkdown(p);
    test("Episode: outcome: RESOLVED", md.includes("outcome: RESOLVED"));
    test("Episode: difficulty: HARD", md.includes("difficulty: HARD"));
    test("Episode: affected_files", md.includes("affected_files:"));
    test("Episode: src/auth.ts listed", md.includes("- src/auth.ts"));
    test("Episode: lessons listed", md.includes("lessons:"));
    test("Episode: 'Intermittent = concurrency'", md.includes("Intermittent = concurrency"));
    test("Episode: duration: 45min", md.includes("duration: 45min"));
  }

  // ====================================================================
  await section("4. pageToMarkdown for decision (all fields)");
  // ====================================================================
  {
    const p: any = {
      id: "dec-1",
      kind: "decision",
      pageType: "decision",
      label: "PostgreSQL over MongoDB",
      body: "ACID > flexibility",
      properties: {},
      confidence: 1.0,
      confidenceLevel: "VERIFIED",
      freshness: { lastChecked: 1700000000000, staleness: "LOW" },
      sources: [],
      tags: ["database", "architecture"],
      related: [],
      validFrom: 1700000000000,
      validTo: null,
      recordedAt: 1700000000000,
      subtype: "ACTIVE",
      decisionDate: 1700000000000,
      decisionStatus: "ACTIVE",
      decisionStakeholders: ["dev-team", "cto"],
      decisionAlternativesRejected: [
        { name: "MongoDB", reason: "Weak ACID" },
        { name: "MySQL", reason: "Weaker JSON" },
      ],
      decisionTradeoffsAccepted: ["Harder horizontal scaling"],
    };
    const md = pageToMarkdown(p);
    test("Decision: status: ACTIVE", md.includes("status: ACTIVE"));
    test("Decision: stakeholders list", md.includes("stakeholders:"));
    test("Decision: dev-team listed", md.includes("- dev-team"));
    test("Decision: alternatives_rejected", md.includes("alternatives_rejected:"));
    test("Decision: MongoDB alternative", md.includes("name: MongoDB"));
    test("Decision: tradeoffs_accepted", md.includes("tradeoffs_accepted:"));
  }

  // ====================================================================
  await section("5. Special chars in YAML escaping");
  // ====================================================================
  {
    const p: any = {
      id: "test-special",
      kind: "entity",
      pageType: "entity",
      label: "Test Special",
      body: "body with: colon and # hash",
      properties: {},
      confidence: 0.5,
      confidenceLevel: "ASSUMED",
      freshness: { lastChecked: 1700000000000, staleness: "LOW" },
      sources: ["file: with: colons.md", "normal.md"],
      tags: ["tag-with-dash", "tag with space"],
      related: [],
      validFrom: 1700000000000,
      validTo: null,
      recordedAt: 1700000000000,
    };
    const md = pageToMarkdown(p);
    test("Special chars: file: with: colons quoted", md.includes('"file: with: colons.md"'));
    test("Special chars: tag with space", md.includes("tag with space"));
  }

  // ====================================================================
  await section("6. markdownToPage simple frontmatter");
  // ====================================================================
  {
    const md = `---
type: entity
confidence: VERIFIED
id: test-123
sources:
  - a.md
  - b.md
tags:
  - one
  - two
---

# Test Page

This is the body.`;
    const p = markdownToPage(md);
    test("Parse: type", p.pageType === "entity");
    test("Parse: confidence", p.confidenceLevel === "VERIFIED");
    test("Parse: id", p.id === "test-123");
    test("Parse: label from H1", p.label === "Test Page");
    test("Parse: sources", p.sources.length === 2 && p.sources[0] === "a.md");
    test("Parse: tags", p.tags.length === 2 && p.tags[0] === "one");
    test("Parse: body (without H1)", p.body === "This is the body.");
  }

  // ====================================================================
  await section("7. markdownToPage lists and nested");
  // ====================================================================
  {
    const md = `---
type: episode
outcome: RESOLVED
duration: 45min
affected_files:
  - src/auth.ts
  - src/token.ts
---

# Auth Bug`;
    const p = markdownToPage(md);
    test("Parse: episode type", p.pageType === "episode");
    test("Parse: outcome", p.episodeOutcome === "RESOLVED");
    test("Parse: duration (45min)", p.episodeDurationMin === 45);
    test("Parse: affected_files list", p.episodeAffectedFiles && p.episodeAffectedFiles.length === 2);
  }

  // ====================================================================
  await section("8. markdownToPage without frontmatter");
  // ====================================================================
  {
    const md = `# Just a Title

No frontmatter here.`;
    const p = markdownToPage(md);
    test("Parse: defaults to concept", p.pageType === "concept");
    test("Parse: label from H1", p.label === "Just a Title");
    test("Parse: defaults to ASSUMED", p.confidenceLevel === "ASSUMED");
  }

  // ====================================================================
  await section("9. extractWikilinks");
  // ====================================================================
  {
    const body = "See [[PostgreSQL]] and [[JWT|json web token]] for more. Also see [[redis]].";
    const links = extractWikilinks(body);
    test("Extract: 3 unique links", links.length === 3);
    test("Extract: includes PostgreSQL", links.includes("PostgreSQL"));
    test("Extract: includes 'json web token' (display text)", links.includes("json web token"));
    test("Extract: includes redis", links.includes("redis"));
  }

  // ====================================================================
  await section("10. Full roundtrip: page → md → page");
  // ====================================================================
  {
    const store = new WikiStore();
    await store.clear();
    const original = await store.createPage({
      pageType: "decision",
      label: "PostgreSQL over MongoDB",
      body: "We chose PostgreSQL for ACID compliance.",
      confidenceLevel: "VERIFIED",
      sources: ["docs/db-decision.md"],
      tags: ["database", "architecture"],
      decisionStatus: "ACTIVE",
      decisionStakeholders: ["dev-team"],
      decisionAlternativesRejected: [{ name: "MongoDB", reason: "Weak ACID" }],
    });

    const md = pageToMarkdown(original);
    const reparsed = markdownToPage(md);

    test("Roundtrip: pageType preserved", reparsed.pageType === original.pageType);
    test("Roundtrip: label preserved", reparsed.label === original.label);
    test("Roundtrip: body preserved", reparsed.body === original.body);
    test("Roundtrip: confidenceLevel preserved", reparsed.confidenceLevel === original.confidenceLevel);
    test("Roundtrip: sources preserved", JSON.stringify(reparsed.sources) === JSON.stringify(original.sources));
    test("Roundtrip: tags preserved", JSON.stringify(reparsed.tags) === JSON.stringify(original.tags));
    test("Roundtrip: decisionStatus preserved", reparsed.decisionStatus === "ACTIVE");
    test("Roundtrip: stakeholders preserved", JSON.stringify(reparsed.decisionStakeholders) === JSON.stringify(original.decisionStakeholders));
  }

  // ====================================================================
  await section("11. Export all pages to directory");
  // ====================================================================
  {
    const tmpDir = await mkdtemp(join(tmpdir(), "wllm-test-"));
    try {
      const store = new WikiStore();
      await store.clear();
      await store.createPage({ pageType: "entity", label: "PostgreSQL", body: "test" });
      await store.createPage({ pageType: "concept", label: "ACID", body: "test" });
      await store.createPage({ pageType: "decision", label: "Postgres Choice", body: "test" });

      const result = await exportAllPages(store, tmpDir);
      test("Export: 3 files written", result.written === 3);
      test("Export: entity file at pages/entities/", result.paths.some(p => p.includes("pages/entities/postgresql.md")));
      test("Export: concept file at pages/concepts/", result.paths.some(p => p.includes("pages/concepts/acid.md")));
      test("Export: decision file at causation/decisions/", result.paths.some(p => p.includes("causation/decisions/")));

      // Read back
      const content = await readFile(result.paths[0], "utf8");
      test("Export: file has frontmatter", content.startsWith("---"));
    } finally {
      await rm(tmpDir, { recursive: true });
    }
  }

  // ====================================================================
  await section("12. Import from sample WllmConcept format");
  // ====================================================================
  {
    const tmpDir = await mkdtemp(join(tmpdir(), "wllm-import-"));
    try {
      // Create sample WllmConcept-format files
      const entityDir = join(tmpDir, "pages/entities");
      await mkdir(entityDir, { recursive: true });
      await writeFile(join(entityDir, "redis.md"), `---
type: entity
confidence: VERIFIED
sources:
  - docs/redis.md
tags:
  - cache
---

# Redis

In-memory data store. See also [[PostgreSQL]] for persistent storage.`, "utf8");

      const decisionDir = join(tmpDir, "causation/decisions");
      await mkdir(decisionDir, { recursive: true });
      await writeFile(join(decisionDir, "2026-01-15-redis.md"), `---
type: decision
status: ACTIVE
stakeholders:
  - backend-team
alternatives_rejected:
  - name: Memcached
    reason: No persistence
---

# Decision: Redis for Caching

Use Redis for caching.`, "utf8");

      const store = new WikiStore();
      await store.clear();
      const result = await importMarkdownDir(store, tmpDir, { recursive: true });
      test("Import: 2 files imported", result.imported === 2);
      test("Import: 0 failed", result.failed === 0);

      const all = await store.listAll();
      test("Import: 2 pages in wiki", all.length === 2);
      test("Import: redis has related (extracted from body)", all.some(p => p.label === "Redis" && p.related.length > 0));
      test("Import: decision has status", all.some(p => p.pageType === "decision" && p.decisionStatus === "ACTIVE"));
    } finally {
      await rm(tmpDir, { recursive: true });
    }
  }

  // ====================================================================
  await section("13. Re-import updates existing page");
  // ====================================================================
  {
    const tmpDir = await mkdtemp(join(tmpdir(), "wllm-reimport-"));
    try {
      const filePath = join(tmpDir, "page.md");
      await writeFile(filePath, `---
type: entity
id: fixed-id-123
confidence: ASSUMED
---

# Test Page

Original body.`, "utf8");

      const store = new WikiStore();
      await store.clear();
      const first = await importMarkdownFile(store, filePath);
      test("First import: created", first?.id === "fixed-id-123");
      test("First import: confidence ASSUMED", first?.confidenceLevel === "ASSUMED");

      // Now update the file
      await writeFile(filePath, `---
type: entity
id: fixed-id-123
confidence: VERIFIED
---

# Test Page

Updated body.`, "utf8");

      const second = await importMarkdownFile(store, filePath);
      test("Re-import: same id", second?.id === "fixed-id-123");
      test("Re-import: updated body", second?.body === "Updated body.");
      test("Re-import: confidence promoted to VERIFIED", second?.confidenceLevel === "VERIFIED");

      const all = await store.listAll();
      test("Re-import: still 1 page (not duplicated)", all.length === 1);
    } finally {
      await rm(tmpDir, { recursive: true });
    }
  }

  // ====================================================================
  await section("14. Full export → reimport roundtrip");
  // ====================================================================
  {
    const tmpDir = await mkdtemp(join(tmpdir(), "wllm-roundtrip-"));
    try {
      const store1 = new WikiStore();
      await store1.clear();
      const p1 = await store1.createPage({ pageType: "entity", label: "PostgreSQL", body: "DB" });
      const p2 = await store1.createPage({ pageType: "decision", label: "Postgres Choice", body: "Why", decisionStatus: "ACTIVE" });
      const p3 = await store1.createPage({ pageType: "episode", label: "Auth Bug", body: "Debug", episodeOutcome: "RESOLVED" });

      // Export
      await exportAllPages(store1, tmpDir);

      // Import into new store
      const store2 = new WikiStore();
      await store2.clear();
      const result = await importMarkdownDir(store2, tmpDir, { recursive: true });
      test("Full roundtrip: 3 imported", result.imported === 3);

      const r1 = await store2.getPageByLabel("PostgreSQL");
      const r2 = await store2.getPageByLabel("Postgres Choice");
      const r3 = await store2.getPageByLabel("Auth Bug");
      test("Full roundtrip: entity preserved", r1 !== null);
      test("Full roundtrip: decision preserved", r2 !== null);
      test("Full roundtrip: decision status preserved", r2?.decisionStatus === "ACTIVE");
      test("Full roundtrip: episode preserved", r3 !== null);
      test("Full roundtrip: episode outcome preserved", r3?.episodeOutcome === "RESOLVED");
    } finally {
      await rm(tmpDir, { recursive: true });
    }
  }

  // ====================================================================
  console.log(`\n${"=".repeat(60)}`);
  console.log(`  Phase 1.3+1.4 Test Results: ${pass} passed, ${fail} failed`);
  console.log("=".repeat(60));

  if (fail > 0) {
    console.log("\n❌ Failed tests:");
    failures.forEach(f => console.log(`  - ${f}`));
    process.exit(1);
  } else {
    console.log("\n🎉 ALL Phase 1.3+1.4 tests PASSED");
  }
}

main().catch(e => { console.error("FATAL:", e); process.exit(1); });
