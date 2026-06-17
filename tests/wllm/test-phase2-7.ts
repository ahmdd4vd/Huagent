/**
 * Phase 2.7 — End-to-end integration test.
 *
 * The grand finale. Tests the FULL WllmConcept pipeline:
 *   1. Create a wiki from source files (3-pass ingest, mocked LLM)
 *   2. Verify cache hits on second pass
 *   3. Query the wiki
 *   4. Export to a .wllmwiki bundle
 *   5. Re-import the bundle
 *   6. Install with provenance
 *
 * Note: We use mock LLM responses to keep the test fast and deterministic.
 * Phase 2.2 already validates real LLM calls.
 */

import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { WikiStore, type CreatePageOptions } from "../../src/wllm/graph/wiki-store.js";
import { extractStructure } from "../../src/wllm/ingest/structural-extractor.js";
import { IngestCacheStore, hashString } from "../../src/wllm/ingest/cache.js";
import { writeBundle, readBundle, inspectBundle, type BundlePage } from "../../src/wllm/bundle/bundle.js";
import {
  ProvenanceStore,
  installFromFile,
  type ProvenanceRecord,
} from "../../src/wllm/provenance/provenance.js";
import { createDefaultManifest, type WikiManifest } from "../../src/wllm/storage/manifest.js";
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

async function makeTmpDir(prefix = "wllm-e2e-"): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function rmTmpDir(dir: string): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// Mock semantic extractor (deterministic for tests)
// ---------------------------------------------------------------------------

interface SemanticExtraction {
  entities: Array<{ name: string; kind: string; description: string }>;
  concepts: Array<{ name: string; description: string }>;
  gotchas: Array<{ name: string; severity: string; mitigation: string }>;
  summary: string;
}

async function mockExtractSemantics(file: string, content: string): Promise<SemanticExtraction> {
  const classMatches = content.match(/class\s+(\w+)/g) ?? [];
  const funcMatches = content.match(/(?:export\s+)?(?:async\s+)?function\s+(\w+)/g) ?? [];

  return {
    summary: `File ${path.basename(file)} contains ${classMatches.length} classes and ${funcMatches.length} functions.`,
    entities: classMatches.map((m) => ({
      name: m.replace("class ", ""),
      kind: "class",
      description: `Class defined in ${path.basename(file)}`,
    })),
    concepts: [
      { name: "structural-organization", description: "Code organized into classes and functions" },
    ],
    gotchas: [
      { name: "method-complexity", severity: "low", mitigation: "Break complex methods into smaller ones" },
    ],
  };
}

async function mockVerifyCritic(_e: SemanticExtraction): Promise<{ score: number; confidence: "VERIFIED" | "INFERRED" | "ASSUMED" | "CONTRADICTED" }> {
  return { score: 0.9, confidence: "VERIFIED" };
}

// ---------------------------------------------------------------------------
// The 3-pass ingest pipeline
// ---------------------------------------------------------------------------

interface IngestResult {
  pagesCreated: number;
  fromCache: number;
  freshlyIngested: number;
  durationMs: number;
}

async function ingestFile(
  filePath: string,
  store: WikiStore,
  cache: IngestCacheStore
): Promise<IngestResult> {
  const start = Date.now();
  const content = await fs.readFile(filePath, "utf8");
  const hash = hashString(content);

  // Check cache
  const lookup = await cache.lookup(filePath);
  if (lookup.hit) {
    return { pagesCreated: 0, fromCache: 1, freshlyIngested: 0, durationMs: 0 };
  }

  // Pass 1: Structural (TS Compiler)
  const structural = extractStructure(filePath);

  // Pass 2: Semantic (mocked LLM)
  const semantic = await mockExtractSemantics(filePath, content);

  // Pass 3: Critic (mocked)
  const critic = await mockVerifyCritic(semantic);

  // Create wiki pages using the real WikiStore API
  let pagesCreated = 0;
  for (const c of semantic.entities) {
    const opts: CreatePageOptions = {
      pageType: "entity",
      label: c.name,
      body: `${c.description}\n\nLocated in: ${filePath}`,
      confidenceLevel: critic.confidence,
      sources: [filePath],
      tags: [path.basename(filePath, ".ts")],
      frontmatter: { structural },
    };
    await store.createPage(opts);
    pagesCreated++;
  }

  for (const c of semantic.concepts) {
    const opts: CreatePageOptions = {
      pageType: "concept",
      label: c.name,
      body: c.description,
      confidenceLevel: critic.confidence,
      sources: [filePath],
      tags: [path.basename(filePath, ".ts"), "concept"],
    };
    await store.createPage(opts);
    pagesCreated++;
  }

  // Cache the result
  await cache.set(filePath, "raw", {
    hash,
    pageIds: [], // WikiStore doesn't return IDs in this version
    durationMs: Date.now() - start,
    stages: ["pass1-structural", "pass2-semantic", "pass3-critic"],
  });

  return { pagesCreated, fromCache: 0, freshlyIngested: 1, durationMs: Date.now() - start };
}

// ---------------------------------------------------------------------------
// Convert WikiPage[] → BundlePage[] (for bundle export)
// ---------------------------------------------------------------------------

function wikiPagesToBundle(pages: WikiPage[]): BundlePage[] {
  return pages.map((p) => ({
    id: p.id,
    title: p.label,
    body: typeof p.body === "string" ? p.body : JSON.stringify(p.body),
    meta: {
      memory: p.frontmatter?.memory as string | undefined,
      confidence: String(p.confidence),
      tags: p.tags,
    },
  }));
}

// ---------------------------------------------------------------------------
// The 8 grand E2E tests
// ---------------------------------------------------------------------------

async function sectionE2E(): Promise<void> {
  console.log("\n— Phase 2.7 E2E: Full pipeline test —");

  await test("E2E.1 create source files and ingest them (3-pass)", async () => {
    const dir = await makeTmpDir();
    try {
      const srcDir = path.join(dir, "src");
      await fs.mkdir(srcDir, { recursive: true });
      await fs.writeFile(
        path.join(srcDir, "auth.ts"),
        `export class AuthService {
  login(token: string): boolean {
    return token.length > 0;
  }
}
export function verifyToken(token: string): boolean {
  return token.startsWith("Bearer ");
}`,
        "utf8"
      );
      await fs.writeFile(
        path.join(srcDir, "user.ts"),
        `export class User {
  constructor(public name: string, public email: string) {}
}
export async function getUser(id: number): Promise<User> {
  return new User("Alice", "alice@example.com");
}`,
        "utf8"
      );

      const wikiDir = path.join(dir, "wiki");
      const cache = new IngestCacheStore(path.join(wikiDir, ".wllmconcept", "cache.json"));
      const wikiStore = new WikiStore();

      const files = ["auth.ts", "user.ts"].map((f) => path.join(srcDir, f));
      const results: IngestResult[] = [];
      for (const f of files) {
        results.push(await ingestFile(f, wikiStore, cache));
      }

      const totalPages = (await wikiStore.listAll()).length;
      assert(totalPages >= 4, `should have >= 4 pages, got ${totalPages}`);
      assertEqual(results[0].freshlyIngested, 1, "first file ingested");
      assertEqual(results[1].freshlyIngested, 1, "second file ingested");
      await cache.save();

      const cacheFile = path.join(wikiDir, ".wllmconcept", "cache.json");
      const exists = await fs.access(cacheFile).then(() => true, () => false);
      assert(exists, "cache file written");
    } finally {
      await rmTmpDir(dir);
    }
  });

  await test("E2E.2 second ingest is fully cached", async () => {
    const dir = await makeTmpDir();
    try {
      const file = path.join(dir, "x.ts");
      await fs.writeFile(file, "export const x = 1;", "utf8");

      const cache = new IngestCacheStore(path.join(dir, ".wllmconcept", "cache.json"));
      const wikiStore = new WikiStore();

      const r1 = await ingestFile(file, wikiStore, cache);
      assertEqual(r1.freshlyIngested, 1, "first pass ingests");

      const r2 = await ingestFile(file, wikiStore, cache);
      assertEqual(r2.fromCache, 1, "second pass hits cache");
      assertEqual(r2.freshlyIngested, 0, "no re-ingest");

      await fs.writeFile(file, "export const x = 2;", "utf8");
      const r3 = await ingestFile(file, wikiStore, cache);
      assertEqual(r3.freshlyIngested, 1, "modified file re-ingests");
    } finally {
      await rmTmpDir(dir);
    }
  });

  await test("E2E.3 export to .wllmwiki then reimport preserves wiki", async () => {
    const dir = await makeTmpDir();
    try {
      const manifest: WikiManifest = createDefaultManifest({
        name: "E2E Wiki",
        id: "wllm:e2e-test",
        version: "1.0.0",
        author: { name: "E2E Tester", handle: "@e2e" },
        description: "End-to-end test wiki",
        tags: ["e2e", "test"],
      });

      // Create pages directly in the bundle format (we don't need to ingest for this test)
      const bundlePages: BundlePage[] = [
        {
          id: "intro",
          title: "Introduction",
          body: "# Welcome\n\nThis is the intro.",
          meta: { memory: "semantic", confidence: "VERIFIED", tags: ["intro"] },
        },
        {
          id: "auth",
          title: "AuthService",
          body: "Class that handles authentication.",
          meta: { memory: "semantic", confidence: "INFERRED", tags: ["auth", "security"] },
        },
      ];

      const bundlePath = path.join(dir, "e2e.wllmwiki");
      const writeResult = await writeBundle(bundlePath, {
        manifest,
        pages: bundlePages,
        readme: "# E2E Wiki\n\nA test.",
      });
      assert(writeResult.bytes > 0, "bundle written");

      const info = await inspectBundle(bundlePath);
      assertEqual(info.pageCount, 2, "2 pages in bundle");
      assert(info.hasReadme, "has readme");

      // Re-import
      const read = await readBundle(bundlePath);
      assertEqual(read.contents.pages.length, 2, "2 pages after reimport");
      assertEqual(read.contents.manifest.id, "wllm:e2e-test", "id preserved");
      assertEqual(read.contents.manifest.author.handle, "@e2e", "author preserved");
    } finally {
      await rmTmpDir(dir);
    }
  });

  await test("E2E.4 full pipeline: ingest → bundle → install (with provenance)", async () => {
    const dir = await makeTmpDir();
    try {
      const wikiDir = path.join(dir, "wiki");
      await fs.mkdir(wikiDir, { recursive: true });

      // 1. Ingest a source file
      const srcFile = path.join(dir, "service.ts");
      await fs.writeFile(
        srcFile,
        "export class Service { run() { return 'ok'; } }",
        "utf8"
      );
      const cache = new IngestCacheStore(path.join(wikiDir, ".wllmconcept", "cache.json"));
      const wikiStore = new WikiStore();
      await ingestFile(srcFile, wikiStore, cache);
      await cache.save();

      // 2. Export to bundle
      const pages = await wikiStore.listAll();
      const manifest: WikiManifest = createDefaultManifest({
        name: "Service Wiki",
        id: "wllm:service",
        version: "1.0.0",
        author: { name: "Author", handle: "@author" },
        description: "Wiki for the service",
      });
      const bundlePages = wikiPagesToBundle(pages);
      const bundlePath = path.join(wikiDir, "service.wllmwiki");
      await writeBundle(bundlePath, {
        manifest,
        pages: bundlePages,
        provenance: { canUpdate: true, originalAuthor: "@author" },
      });

      // 3. "Install" the bundle on a fresh machine
      const machineB = path.join(dir, "machineB");
      await fs.mkdir(machineB, { recursive: true });
      const provStore = new ProvenanceStore(path.join(machineB, ".wllmconcept", "provenance.json"));
      const installResult = await installFromFile(bundlePath, machineB, provStore);

      assertEqual(installResult.wikiId, "wllm:service", "id");
      assertEqual(installResult.version, "1.0.0", "version");

      const rec = await provStore.get("wllm:service");
      assert(rec, "record exists");
      assertEqual(rec?.canUpdate, true, "canUpdate from bundle");
      assertEqual(rec?.authorHandle, "@author", "author");
      assertEqual(rec?.installedVersion, "1.0.0", "version");
      assert(rec?.bundleChecksum?.length === 64, "checksum is sha256 hex");
    } finally {
      await rmTmpDir(dir);
    }
  });

  await test("E2E.5 cache invalidation when file is deleted", async () => {
    const dir = await makeTmpDir();
    try {
      const file = path.join(dir, "x.ts");
      await fs.writeFile(file, "x", "utf8");
      const cache = new IngestCacheStore(path.join(dir, "c.json"));
      const l1 = await cache.lookup(file);
      await cache.set(file, "raw", { hash: l1.currentHash });
      await cache.save();
      assertEqual(cache.size(), 1, "1 entry");

      await fs.unlink(file);
      const l2 = await cache.lookup(file);
      assertEqual(l2.hit, false, "no hit on deleted file");
      assertEqual(cache.size(), 0, "entry removed");
    } finally {
      await rmTmpDir(dir);
    }
  });

  await test("E2E.6 multi-file ingest with mixed cache hits/misses", async () => {
    const dir = await makeTmpDir();
    try {
      const f1 = path.join(dir, "a.ts");
      const f2 = path.join(dir, "b.ts");
      const f3 = path.join(dir, "c.ts");
      await fs.writeFile(f1, "1", "utf8");
      await fs.writeFile(f2, "2", "utf8");

      const cache = new IngestCacheStore(path.join(dir, "c.json"));
      const wikiStore = new WikiStore();

      await ingestFile(f1, wikiStore, cache);
      await ingestFile(f2, wikiStore, cache);

      await fs.writeFile(f3, "3", "utf8");
      const r1 = await ingestFile(f1, wikiStore, cache);
      const r2 = await ingestFile(f2, wikiStore, cache);
      const r3 = await ingestFile(f3, wikiStore, cache);

      assertEqual(r1.fromCache, 1, "f1 cached");
      assertEqual(r2.fromCache, 1, "f2 cached");
      assertEqual(r3.freshlyIngested, 1, "f3 fresh");
    } finally {
      await rmTmpDir(dir);
    }
  });

  await test("E2E.7 wiki search after ingest", async () => {
    const dir = await makeTmpDir();
    try {
      const srcFile = path.join(dir, "test.ts");
      await fs.writeFile(
        srcFile,
        "export class Foo {}\nexport class Bar {}\nexport class Baz {}",
        "utf8"
      );

      const cache = new IngestCacheStore(path.join(dir, "c.json"));
      const wikiStore = new WikiStore();
      await ingestFile(srcFile, wikiStore, cache);

      const results = await wikiStore.search("Foo");
      assert(results.length >= 1, "should find Foo");
      const foundFoo = results.some((r) => r.page.label === "Foo");
      assert(foundFoo, `Foo in results: ${results.map((r) => r.page.label).join(", ")}`);
    } finally {
      await rmTmpDir(dir);
    }
  });

  await test("E2E.8 full lifecycle: create → ingest → bundle → install → re-bundle", async () => {
    const dir = await makeTmpDir();
    try {
      // ===== MACHINE A: Create + ingest =====
      const machineA = path.join(dir, "A");
      const srcFile = path.join(machineA, "api.ts");
      await fs.mkdir(path.dirname(srcFile), { recursive: true });
      await fs.writeFile(
        srcFile,
        "export class ApiClient { fetch(url: string) { return url; } }",
        "utf8"
      );

      const cacheA = new IngestCacheStore(path.join(machineA, "wiki", ".wllmconcept", "cache.json"));
      const wikiStoreA = new WikiStore();
      await ingestFile(srcFile, wikiStoreA, cacheA);
      await cacheA.save();

      // ===== MACHINE A: Export bundle =====
      const manifest: WikiManifest = createDefaultManifest({
        name: "API Wiki",
        id: "wllm:api",
        version: "1.0.0",
        author: { name: "Alice", handle: "@alice" },
      });
      const pagesA = await wikiStoreA.listAll();
      const bundlePagesA = wikiPagesToBundle(pagesA);
      const bundlePath = path.join(machineA, "api.wllmwiki");
      await writeBundle(bundlePath, { manifest, pages: bundlePagesA });

      // ===== MACHINE B: Install bundle =====
      const machineB = path.join(dir, "B");
      await fs.mkdir(machineB, { recursive: true });
      const provStoreB = new ProvenanceStore(path.join(machineB, ".wllmconcept", "provenance.json"));
      await installFromFile(bundlePath, machineB, provStoreB);

      const rec = await provStoreB.get("wllm:api");
      assert(rec, "installed");
      assertEqual(rec?.installedVersion, "1.0.0", "version");

      // ===== MACHINE B: Re-bundle (for sharing further) =====
      const read = await readBundle(bundlePath);
      const reBundlePath = path.join(machineB, "api-reshare.wllmwiki");
      await writeBundle(reBundlePath, read.contents);
      const reInfo = await inspectBundle(reBundlePath);
      assertEqual(reInfo.pageCount, bundlePagesA.length, "same page count");

      // Verify the re-bundle is also installable
      const reInfo2 = await installFromFile(reBundlePath, machineB, provStoreB);
      assertEqual(reInfo2.wikiId, "wllm:api", "re-installed");
    } finally {
      await rmTmpDir(dir);
    }
  });
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

async function runAll(): Promise<void> {
  console.log("╔════════════════════════════════════════════════════════════╗");
  console.log("║   PHASE 2.7 — E2E Integration Test                         ║");
  console.log("║   (the grand finale: full pipeline working end-to-end)     ║");
  console.log("╚════════════════════════════════════════════════════════════╝");

  await sectionE2E();

  console.log("\n╔════════════════════════════════════════════════════════════╗");
  console.log(`║   RESULTS: ${passCount}/${testCount} passed, ${failCount} failed       ║`);
  console.log("╚════════════════════════════════════════════════════════════╝");

  if (failures.length > 0) {
    console.log("\nFailures:");
    for (const f of failures) console.log(f);
    process.exit(1);
  }
  if (passCount === testCount) {
    console.log("\n🎉 ALL PHASE 2.7 TESTS PASSED — PIPELINE WORKS END-TO-END");
  }
}

runAll().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
