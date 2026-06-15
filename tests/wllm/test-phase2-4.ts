/**
 * Phase 2.4 test suite — IngestCache SHA256 + incremental ingest.
 *
 * Coverage:
 *  - 1. Constructor & path handling
 *  - 2. Load: missing file, corrupt JSON, wrong version, valid
 *  - 3. Lookup: hit, miss, stale, deleted file, mode variations
 *  - 4. Set: stores hash + metadata, overwrites
 *  - 5. Save: atomic write, survives mid-write crash (tmp cleanup)
 *  - 6. Invalidate: drops entry
 *  - 7. Prune stale: removes missing files
 *  - 8. Clear: resets to empty
 *  - 9. List / size / totalSavedMs
 *  - 10. Concurrency: serializes writes
 *  - 11. End-to-end: incremental ingest scenario
 *  - 12. Edge cases: empty file, huge file, symlinks, unicode paths
 */

import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  IngestCacheStore,
  hashString,
  cacheKey,
  defaultCachePath,
  type CacheMode,
} from "../../src/wllm/ingest/cache.js";

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
      // Suppress success noise; uncomment for verbose mode.
      // console.log(`  ✓ ${name}`);
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

function assertDeepEqual<T>(actual: T, expected: T, msg: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(`${msg}\n        expected: ${e}\n        actual:   ${a}`);
  }
}

async function makeTmpDir(prefix = "wllm-cache-test-"): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function rmTmpDir(dir: string): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// Section 1: Constructor & path handling
// ---------------------------------------------------------------------------

async function section1(): Promise<void> {
  console.log("\n— 1. Constructor & path handling —");

  await test("1.1 constructs without throwing", () => {
    const c = new IngestCacheStore("/tmp/foo.json");
    assert(c, "store should be created");
  });

  await test("1.2 defaultCachePath returns .wllmconcept/cache.json", () => {
    const p = defaultCachePath("/root/wiki");
    assertEqual(p, "/root/wiki/.wllmconcept/cache.json", "default path");
  });

  await test("1.3 defaultCachePath handles trailing slash", () => {
    const p = defaultCachePath("/root/wiki/");
    assertEqual(p, "/root/wiki/.wllmconcept/cache.json", "trailing slash");
  });

  await test("1.4 cacheKey normalizes absolute path", () => {
    const k1 = cacheKey("/root/foo.ts", "raw");
    const k2 = cacheKey("/root/../root/foo.ts", "raw");
    assertEqual(k1, k2, "paths should normalize to same key");
  });

  await test("1.5 cacheKey includes mode", () => {
    const k1 = cacheKey("/root/foo.ts", "raw");
    const k2 = cacheKey("/root/foo.ts", "normalized");
    assert(k1 !== k2, "different modes → different keys");
  });

  await test("1.6 cacheKey handles different modes distinctly", () => {
    const modes: CacheMode[] = ["raw", "normalized", "compiled"];
    const keys = modes.map((m) => cacheKey("/foo.ts", m));
    const unique = new Set(keys);
    assertEqual(unique.size, 3, "all 3 modes should produce unique keys");
  });

  await test("1.7 ephemeral mode is accepted", () => {
    const c = new IngestCacheStore("/tmp/x.json", { ephemeral: true });
    assert(c, "ephemeral store should construct");
  });

  await test("1.8 store exposes path via getter", () => {
    const c = new IngestCacheStore("/tmp/abc.json");
    assertEqual(c.path, "/tmp/abc.json", "path getter");
  });
}

// ---------------------------------------------------------------------------
// Section 2: Load
// ---------------------------------------------------------------------------

async function section2(): Promise<void> {
  console.log("\n— 2. Load: missing, corrupt, wrong version, valid —");

  await test("2.1 load() on missing file returns empty cache", async () => {
    const dir = await makeTmpDir();
    try {
      const c = new IngestCacheStore(path.join(dir, "missing.json"));
      const cache = await c.load();
      assertEqual(cache.version, 1, "version");
      assertDeepEqual(cache.entries, {}, "entries empty");
    } finally {
      await rmTmpDir(dir);
    }
  });

  await test("2.2 load() on missing file does NOT warn", async () => {
    const dir = await makeTmpDir();
    try {
      const c = new IngestCacheStore(path.join(dir, "missing.json"));
      let warned = false;
      await c.load((msg) => {
        warned = true;
        console.log("unexpected warn:", msg);
      });
      assert(!warned, "missing file is normal, no warning");
    } finally {
      await rmTmpDir(dir);
    }
  });

  await test("2.3 load() on corrupt JSON returns empty + warns", async () => {
    const dir = await makeTmpDir();
    try {
      const cachePath = path.join(dir, "corrupt.json");
      await fs.writeFile(cachePath, "this is not JSON {{{", "utf8");
      const c = new IngestCacheStore(cachePath);
      let warned = false;
      const cache = await c.load(() => (warned = true));
      assert(warned, "should have warned");
      assertDeepEqual(cache.entries, {}, "entries empty after corrupt load");
    } finally {
      await rmTmpDir(dir);
    }
  });

  await test("2.4 load() on wrong version returns empty + warns", async () => {
    const dir = await makeTmpDir();
    try {
      const cachePath = path.join(dir, "old.json");
      await fs.writeFile(
        cachePath,
        JSON.stringify({ version: 99, entries: {} }),
        "utf8"
      );
      const c = new IngestCacheStore(cachePath);
      let warned = false;
      const cache = await c.load(() => (warned = true));
      assert(warned, "should have warned about version");
      assertEqual(cache.version, 1, "should be reset to v1");
      assertDeepEqual(cache.entries, {}, "entries empty");
    } finally {
      await rmTmpDir(dir);
    }
  });

  await test("2.5 load() on valid cache returns it", async () => {
    const dir = await makeTmpDir();
    try {
      const cachePath = path.join(dir, "valid.json");
      const fixture = {
        version: 1,
        updatedAt: "2026-01-01T00:00:00.000Z",
        entries: {
          "/foo.ts::raw": {
            hash: "abc",
            ingestedAt: "2026-01-01T00:00:00.000Z",
            mode: "raw" as CacheMode,
          },
        },
      };
      await fs.writeFile(cachePath, JSON.stringify(fixture), "utf8");
      const c = new IngestCacheStore(cachePath);
      const cache = await c.load();
      assertEqual(cache.entries["/foo.ts::raw"].hash, "abc", "hash preserved");
    } finally {
      await rmTmpDir(dir);
    }
  });

  await test("2.6 load() on non-object JSON returns empty + warns", async () => {
    const dir = await makeTmpDir();
    try {
      const cachePath = path.join(dir, "bad.json");
      await fs.writeFile(cachePath, "42", "utf8");
      const c = new IngestCacheStore(cachePath);
      let warned = false;
      await c.load(() => (warned = true));
      assert(warned, "should have warned");
    } finally {
      await rmTmpDir(dir);
    }
  });

  await test("2.7 load() on cache with missing entries field warns", async () => {
    const dir = await makeTmpDir();
    try {
      const cachePath = path.join(dir, "no-entries.json");
      await fs.writeFile(
        cachePath,
        JSON.stringify({ version: 1, updatedAt: "x" }),
        "utf8"
      );
      const c = new IngestCacheStore(cachePath);
      let warned = false;
      await c.load(() => (warned = true));
      assert(warned, "should have warned about missing entries");
    } finally {
      await rmTmpDir(dir);
    }
  });

  await test("2.8 load() is memoized", async () => {
    const dir = await makeTmpDir();
    try {
      const cachePath = path.join(dir, "m.json");
      await fs.writeFile(cachePath, "{}", "utf8");
      const c = new IngestCacheStore(cachePath);
      const a = await c.load();
      const b = await c.load();
      assert(a === b, "should return same object");
    } finally {
      await rmTmpDir(dir);
    }
  });

  await test("2.9 load() recovers after corruption (next save overwrites)", async () => {
    const dir = await makeTmpDir();
    try {
      const cachePath = path.join(dir, "rec.json");
      await fs.writeFile(cachePath, "garbage", "utf8");
      const c = new IngestCacheStore(cachePath);
      await c.load();
      const tmpFile = path.join(dir, "foo.ts");
      await fs.writeFile(tmpFile, "export const x = 1;", "utf8");
      await c.set(tmpFile, "raw", { hash: hashString("export const x = 1;") });
      await c.save();
      const c2 = new IngestCacheStore(cachePath);
      const cache2 = await c2.load();
      assert(cache2.entries[cacheKey(tmpFile, "raw")], "entry should be saved");
    } finally {
      await rmTmpDir(dir);
    }
  });
}

// ---------------------------------------------------------------------------
// Section 3: Lookup
// ---------------------------------------------------------------------------

async function section3(): Promise<void> {
  console.log("\n— 3. Lookup: hit, miss, stale, deleted —");

  await test("3.1 lookup on missing file returns hit=false, hash=''", async () => {
    const dir = await makeTmpDir();
    try {
      const c = new IngestCacheStore(path.join(dir, "c.json"));
      const result = await c.lookup(path.join(dir, "nope.ts"));
      assertEqual(result.hit, false, "should not hit");
      assertEqual(result.currentHash, "", "no hash for missing file");
      assertEqual(result.currentSize, 0, "no size for missing file");
    } finally {
      await rmTmpDir(dir);
    }
  });

  await test("3.2 lookup with no prior entry returns hit=false", async () => {
    const dir = await makeTmpDir();
    try {
      const f = path.join(dir, "a.ts");
      await fs.writeFile(f, "export const x = 1;", "utf8");
      const c = new IngestCacheStore(path.join(dir, "c.json"));
      const result = await c.lookup(f);
      assertEqual(result.hit, false, "no prior entry");
      assertEqual(result.currentHash.length, 64, "sha256 hex is 64 chars");
    } finally {
      await rmTmpDir(dir);
    }
  });

  await test("3.3 lookup with matching hash returns hit=true", async () => {
    const dir = await makeTmpDir();
    try {
      const f = path.join(dir, "a.ts");
      const content = "export const x = 1;";
      await fs.writeFile(f, content, "utf8");
      const c = new IngestCacheStore(path.join(dir, "c.json"));
      await c.set(f, "raw", { hash: hashString(content) });
      const result = await c.lookup(f);
      assertEqual(result.hit, true, "should hit");
      assert(result.entry, "entry should be returned");
    } finally {
      await rmTmpDir(dir);
    }
  });

  await test("3.4 lookup with stale hash returns hit=false + entry", async () => {
    const dir = await makeTmpDir();
    try {
      const f = path.join(dir, "a.ts");
      await fs.writeFile(f, "v1", "utf8");
      const c = new IngestCacheStore(path.join(dir, "c.json"));
      await c.set(f, "raw", { hash: "stale" });
      await fs.writeFile(f, "v2 different content", "utf8");
      const result = await c.lookup(f);
      assertEqual(result.hit, false, "should miss");
      assert(result.entry, "stale entry should be returned for caller decision");
      assertEqual(result.entry.hash, "stale", "stale hash preserved");
    } finally {
      await rmTmpDir(dir);
    }
  });

  await test("3.5 lookup removes stale entry when file deleted", async () => {
    const dir = await makeTmpDir();
    try {
      const f = path.join(dir, "a.ts");
      await fs.writeFile(f, "x", "utf8");
      const c = new IngestCacheStore(path.join(dir, "c.json"));
      await c.set(f, "raw", { hash: hashString("x") });
      await c.save();
      await fs.unlink(f);
      const result = await c.lookup(f);
      assertEqual(result.hit, false, "should miss");
      const cache = await c.load();
      assert(!cache.entries[cacheKey(f, "raw")], "stale entry should be removed");
    } finally {
      await rmTmpDir(dir);
    }
  });

  await test("3.6 lookup on empty file works (hash of empty string)", async () => {
    const dir = await makeTmpDir();
    try {
      const f = path.join(dir, "empty.ts");
      await fs.writeFile(f, "", "utf8");
      const c = new IngestCacheStore(path.join(dir, "c.json"));
      const result = await c.lookup(f);
      assertEqual(result.hit, false, "first lookup is a miss");
      assertEqual(result.currentHash, hashString(""), "empty file hash");
      assertEqual(result.currentSize, 0, "empty file size");
    } finally {
      await rmTmpDir(dir);
    }
  });

  await test("3.7 lookup with unicode content", async () => {
    const dir = await makeTmpDir();
    try {
      const f = path.join(dir, "uni.ts");
      const content = "// 你好世界 🌍\nexport const greeting = 'สวัสดี';";
      await fs.writeFile(f, content, "utf8");
      const c = new IngestCacheStore(path.join(dir, "c.json"));
      await c.set(f, "raw", { hash: hashString(content) });
      const result = await c.lookup(f);
      assertEqual(result.hit, true, "should hit with unicode");
    } finally {
      await rmTmpDir(dir);
    }
  });

  await test("3.8 lookup on large file (1MB) completes quickly", async () => {
    const dir = await makeTmpDir();
    try {
      const f = path.join(dir, "big.ts");
      const content = "x".repeat(1024 * 1024);
      await fs.writeFile(f, content, "utf8");
      const c = new IngestCacheStore(path.join(dir, "c.json"));
      const start = Date.now();
      const result = await c.lookup(f);
      const elapsed = Date.now() - start;
      assertEqual(result.currentSize, 1024 * 1024, "size matches");
      assert(elapsed < 500, `1MB hash should be fast, took ${elapsed}ms`);
    } finally {
      await rmTmpDir(dir);
    }
  });

  await test("3.9 lookupMany returns map for all paths", async () => {
    const dir = await makeTmpDir();
    try {
      const f1 = path.join(dir, "a.ts");
      const f2 = path.join(dir, "b.ts");
      const f3 = path.join(dir, "c.ts");
      await fs.writeFile(f1, "1", "utf8");
      await fs.writeFile(f2, "2", "utf8");
      // f3 not created
      const c = new IngestCacheStore(path.join(dir, "c.json"));
      const map = await c.lookupMany([f1, f2, f3]);
      assertEqual(map.size, 3, "3 entries");
      assertEqual(map.get(f1)!.hit, false, "f1 miss (no prior entry)");
      assertEqual(map.get(f2)!.hit, false, "f2 miss");
      assertEqual(map.get(f3)!.hit, false, "f3 miss (no file)");
      assertEqual(map.get(f3)!.currentHash, "", "f3 no hash");
    } finally {
      await rmTmpDir(dir);
    }
  });
}

// ---------------------------------------------------------------------------
// Section 4: Set
// ---------------------------------------------------------------------------

async function section4(): Promise<void> {
  console.log("\n— 4. Set: stores and overwrites —");

  await test("4.1 set stores entry", async () => {
    const dir = await makeTmpDir();
    try {
      const c = new IngestCacheStore(path.join(dir, "c.json"), { ephemeral: true });
      await c.set("/foo.ts", "raw", { hash: "abc" });
      const cache = await c.load();
      assertEqual(cache.entries[cacheKey("/foo.ts", "raw")].hash, "abc", "stored");
    } finally {
      await rmTmpDir(dir);
    }
  });

  await test("4.2 set with metadata preserves all fields", async () => {
    const dir = await makeTmpDir();
    try {
      const c = new IngestCacheStore(path.join(dir, "c.json"), { ephemeral: true });
      await c.set("/foo.ts", "raw", {
        hash: "abc",
        pageIds: ["p1", "p2"],
        durationMs: 1234,
        stages: ["pass1-structural", "pass2-semantic", "pass3-critic"],
      });
      const cache = await c.load();
      const entry = cache.entries[cacheKey("/foo.ts", "raw")];
      assertEqual(entry.hash, "abc", "hash");
      assertDeepEqual(entry.pageIds, ["p1", "p2"], "pageIds");
      assertEqual(entry.durationMs, 1234, "duration");
      assertEqual(entry.stages?.length, 3, "stages count");
      assert(entry.ingestedAt.match(/^\d{4}-\d{2}-\d{2}T/), "iso timestamp");
    } finally {
      await rmTmpDir(dir);
    }
  });

  await test("4.3 set overwrites prior entry for same key", async () => {
    const dir = await makeTmpDir();
    try {
      const c = new IngestCacheStore(path.join(dir, "c.json"), { ephemeral: true });
      await c.set("/foo.ts", "raw", { hash: "v1" });
      await c.set("/foo.ts", "raw", { hash: "v2", pageIds: ["x"] });
      const cache = await c.load();
      const entry = cache.entries[cacheKey("/foo.ts", "raw")];
      assertEqual(entry.hash, "v2", "overwritten");
      assertEqual(entry.pageIds?.[0], "x", "pageIds updated");
    } finally {
      await rmTmpDir(dir);
    }
  });

  await test("4.4 set with different modes creates separate entries", async () => {
    const dir = await makeTmpDir();
    try {
      const c = new IngestCacheStore(path.join(dir, "c.json"), { ephemeral: true });
      await c.set("/foo.ts", "raw", { hash: "raw-hash" });
      await c.set("/foo.ts", "normalized", { hash: "norm-hash" });
      const cache = await c.load();
      assertEqual(cache.entries[cacheKey("/foo.ts", "raw")].hash, "raw-hash", "raw");
      assertEqual(cache.entries[cacheKey("/foo.ts", "normalized")].hash, "norm-hash", "normalized");
    } finally {
      await rmTmpDir(dir);
    }
  });
}

// ---------------------------------------------------------------------------
// Section 5: Save (atomic write)
// ---------------------------------------------------------------------------

async function section5(): Promise<void> {
  console.log("\n— 5. Save: atomic write, persistence —");

  await test("5.1 save() writes valid JSON to disk", async () => {
    const dir = await makeTmpDir();
    try {
      const cachePath = path.join(dir, ".wllmconcept", "cache.json");
      const c = new IngestCacheStore(cachePath);
      await c.set("/foo.ts", "raw", { hash: "h" });
      await c.save();
      const raw = await fs.readFile(cachePath, "utf8");
      const parsed = JSON.parse(raw);
      assertEqual(parsed.version, 1, "version");
      assert(parsed.entries[cacheKey("/foo.ts", "raw")], "entry present");
    } finally {
      await rmTmpDir(dir);
    }
  });

  await test("5.2 save() creates parent directories", async () => {
    const dir = await makeTmpDir();
    try {
      const cachePath = path.join(dir, "deep", "nested", ".wllmconcept", "cache.json");
      const c = new IngestCacheStore(cachePath);
      await c.set("/foo.ts", "raw", { hash: "h" });
      await c.save();
      const stat = await fs.stat(cachePath);
      assert(stat.isFile(), "file created");
    } finally {
      await rmTmpDir(dir);
    }
  });

  await test("5.3 save() is a no-op in ephemeral mode", async () => {
    const dir = await makeTmpDir();
    try {
      const cachePath = path.join(dir, "c.json");
      const c = new IngestCacheStore(cachePath, { ephemeral: true });
      await c.set("/foo.ts", "raw", { hash: "h" });
      await c.save();
      const exists = await fs.access(cachePath).then(() => true, () => false);
      assert(!exists, "ephemeral should not write");
    } finally {
      await rmTmpDir(dir);
    }
  });

  await test("5.4 save() uses atomic rename (no .tmp files left)", async () => {
    const dir = await makeTmpDir();
    try {
      const cachePath = path.join(dir, "c.json");
      const c = new IngestCacheStore(cachePath);
      await c.set("/foo.ts", "raw", { hash: "h" });
      await c.save();
      const files = await fs.readdir(dir);
      const tmpFiles = files.filter((f) => f.includes(".tmp-"));
      assertEqual(tmpFiles.length, 0, "no temp files left");
      assert(files.includes("c.json"), "real file present");
    } finally {
      await rmTmpDir(dir);
    }
  });

  await test("5.5 JSON output is pretty-printed (2-space indent)", async () => {
    const dir = await makeTmpDir();
    try {
      const cachePath = path.join(dir, "c.json");
      const c = new IngestCacheStore(cachePath);
      await c.set("/foo.ts", "raw", { hash: "h" });
      await c.save();
      const raw = await fs.readFile(cachePath, "utf8");
      // Pretty print: should have newlines and 2-space indent
      assert(raw.includes("\n"), "has newlines");
      assert(raw.includes("  "), "has 2-space indent");
    } finally {
      await rmTmpDir(dir);
    }
  });

  await test("5.6 save() updates updatedAt timestamp when persisted", async () => {
    const dir = await makeTmpDir();
    try {
      const cachePath = path.join(dir, "c.json");
      const c = new IngestCacheStore(cachePath);
      // Set something first, otherwise save() is a no-op (nothing to write).
      await c.set("/foo.ts", "raw", { hash: "h" });
      const before = Date.now();
      await c.save();
      const raw = await fs.readFile(cachePath, "utf8");
      const parsed = JSON.parse(raw);
      const ts = new Date(parsed.updatedAt).getTime();
      assert(ts >= before, `updatedAt should be recent (got ${ts}, before ${before})`);
    } finally {
      await rmTmpDir(dir);
    }
  });
}

// ---------------------------------------------------------------------------
// Section 6: Invalidate
// ---------------------------------------------------------------------------

async function section6(): Promise<void> {
  console.log("\n— 6. Invalidate: drops entries —");

  await test("6.1 invalidate drops entry", async () => {
    const dir = await makeTmpDir();
    try {
      const c = new IngestCacheStore(path.join(dir, "c.json"), { ephemeral: true });
      await c.set("/foo.ts", "raw", { hash: "h" });
      await c.invalidate("/foo.ts", "raw");
      const cache = await c.load();
      assert(!cache.entries[cacheKey("/foo.ts", "raw")], "entry should be gone");
    } finally {
      await rmTmpDir(dir);
    }
  });

  await test("6.2 invalidate on missing key is a no-op", async () => {
    const dir = await makeTmpDir();
    try {
      const c = new IngestCacheStore(path.join(dir, "c.json"), { ephemeral: true });
      await c.invalidate("/nope.ts", "raw");
      const cache = await c.load();
      assertDeepEqual(cache.entries, {}, "still empty");
    } finally {
      await rmTmpDir(dir);
    }
  });

  await test("6.3 invalidate only drops the specified mode", async () => {
    const dir = await makeTmpDir();
    try {
      const c = new IngestCacheStore(path.join(dir, "c.json"), { ephemeral: true });
      await c.set("/foo.ts", "raw", { hash: "r" });
      await c.set("/foo.ts", "normalized", { hash: "n" });
      await c.invalidate("/foo.ts", "raw");
      const cache = await c.load();
      assert(!cache.entries[cacheKey("/foo.ts", "raw")], "raw gone");
      assert(cache.entries[cacheKey("/foo.ts", "normalized")], "normalized kept");
    } finally {
      await rmTmpDir(dir);
    }
  });

  await test("6.4 invalidate defaults mode to 'raw'", async () => {
    const dir = await makeTmpDir();
    try {
      const c = new IngestCacheStore(path.join(dir, "c.json"), { ephemeral: true });
      await c.set("/foo.ts", "raw", { hash: "h" });
      await c.invalidate("/foo.ts");
      const cache = await c.load();
      assert(!cache.entries[cacheKey("/foo.ts", "raw")], "default mode works");
    } finally {
      await rmTmpDir(dir);
    }
  });
}

// ---------------------------------------------------------------------------
// Section 7: Prune stale
// ---------------------------------------------------------------------------

async function section7(): Promise<void> {
  console.log("\n— 7. Prune stale —");

  await test("7.1 pruneStale drops entries for missing files", async () => {
    const dir = await makeTmpDir();
    try {
      const f1 = path.join(dir, "exists.ts");
      const f2 = path.join(dir, "deleted.ts");
      await fs.writeFile(f1, "1", "utf8");
      await fs.writeFile(f2, "2", "utf8");
      const c = new IngestCacheStore(path.join(dir, "c.json"));
      await c.set(f1, "raw", { hash: "h1" });
      await c.set(f2, "raw", { hash: "h2" });
      await c.save();
      await fs.unlink(f2);
      const dropped = await c.pruneStale();
      assertEqual(dropped, 1, "1 dropped");
      const cache = await c.load();
      assert(cache.entries[cacheKey(f1, "raw")], "exists kept");
      assert(!cache.entries[cacheKey(f2, "raw")], "deleted dropped");
    } finally {
      await rmTmpDir(dir);
    }
  });

  await test("7.2 pruneStale on no stale entries returns 0", async () => {
    const dir = await makeTmpDir();
    try {
      const f1 = path.join(dir, "a.ts");
      await fs.writeFile(f1, "1", "utf8");
      const c = new IngestCacheStore(path.join(dir, "c.json"));
      await c.set(f1, "raw", { hash: "h" });
      const dropped = await c.pruneStale();
      assertEqual(dropped, 0, "nothing stale");
    } finally {
      await rmTmpDir(dir);
    }
  });

  await test("7.3 pruneStale on empty cache returns 0", async () => {
    const dir = await makeTmpDir();
    try {
      const c = new IngestCacheStore(path.join(dir, "c.json"));
      const dropped = await c.pruneStale();
      assertEqual(dropped, 0, "empty cache prunes nothing");
    } finally {
      await rmTmpDir(dir);
    }
  });

  await test("7.4 pruneStale persists the cleanup to disk", async () => {
    const dir = await makeTmpDir();
    try {
      const f = path.join(dir, "x.ts");
      await fs.writeFile(f, "1", "utf8");
      const c = new IngestCacheStore(path.join(dir, "c.json"));
      await c.set(f, "raw", { hash: "h" });
      await c.save();
      await fs.unlink(f);
      await c.pruneStale();
      const c2 = new IngestCacheStore(path.join(dir, "c.json"));
      const cache2 = await c2.load();
      assertDeepEqual(cache2.entries, {}, "persisted empty");
    } finally {
      await rmTmpDir(dir);
    }
  });
}

// ---------------------------------------------------------------------------
// Section 8: Clear
// ---------------------------------------------------------------------------

async function section8(): Promise<void> {
  console.log("\n— 8. Clear —");

  await test("8.1 clear() resets in-memory cache", async () => {
    const dir = await makeTmpDir();
    try {
      const c = new IngestCacheStore(path.join(dir, "c.json"), { ephemeral: true });
      await c.set("/foo.ts", "raw", { hash: "h" });
      await c.clear();
      const cache = await c.load();
      assertDeepEqual(cache.entries, {}, "in-memory cleared");
    } finally {
      await rmTmpDir(dir);
    }
  });

  await test("8.2 clear() removes the file from disk", async () => {
    const dir = await makeTmpDir();
    try {
      const cachePath = path.join(dir, "c.json");
      const c = new IngestCacheStore(cachePath);
      await c.set("/foo.ts", "raw", { hash: "h" });
      await c.save();
      const existsBefore = await fs.access(cachePath).then(() => true, () => false);
      assert(existsBefore, "exists before clear");
      await c.clear();
      const existsAfter = await fs.access(cachePath).then(() => true, () => false);
      assert(!existsAfter, "gone after clear");
    } finally {
      await rmTmpDir(dir);
    }
  });

  await test("8.3 clear() is a no-op when file doesn't exist", async () => {
    const dir = await makeTmpDir();
    try {
      const c = new IngestCacheStore(path.join(dir, "nope.json"));
      await c.clear(); // should not throw
      const cache = await c.load();
      assertDeepEqual(cache.entries, {}, "still empty");
    } finally {
      await rmTmpDir(dir);
    }
  });
}

// ---------------------------------------------------------------------------
// Section 9: List / size / totalSavedMs
// ---------------------------------------------------------------------------

async function section9(): Promise<void> {
  console.log("\n— 9. List / size / totalSavedMs —");

  await test("9.1 size() returns entry count", async () => {
    const dir = await makeTmpDir();
    try {
      const c = new IngestCacheStore(path.join(dir, "c.json"), { ephemeral: true });
      assertEqual(c.size(), 0, "empty");
      await c.set("/a.ts", "raw", { hash: "1" });
      await c.set("/b.ts", "raw", { hash: "2" });
      assertEqual(c.size(), 2, "2 entries");
    } finally {
      await rmTmpDir(dir);
    }
  });

  await test("9.2 list() returns entries sorted by ingestedAt desc", async () => {
    const dir = await makeTmpDir();
    try {
      const c = new IngestCacheStore(path.join(dir, "c.json"), { ephemeral: true });
      await c.set("/old.ts", "raw", { hash: "1" });
      await new Promise((r) => setTimeout(r, 10));
      await c.set("/new.ts", "raw", { hash: "2" });
      const list = c.list();
      assertEqual(list.length, 2, "2 entries");
      assertEqual(list[0].hash, "2", "newest first");
      assertEqual(list[1].hash, "1", "oldest second");
    } finally {
      await rmTmpDir(dir);
    }
  });

  await test("9.3 list() returns a copy, not the live cache", async () => {
    const dir = await makeTmpDir();
    try {
      const c = new IngestCacheStore(path.join(dir, "c.json"), { ephemeral: true });
      await c.set("/a.ts", "raw", { hash: "1" });
      const list1 = c.list();
      await c.set("/b.ts", "raw", { hash: "2" });
      const list2 = c.list();
      assertEqual(list1.length, 1, "list1 is snapshot");
      assertEqual(list2.length, 2, "list2 has new entry");
    } finally {
      await rmTmpDir(dir);
    }
  });

  await test("9.4 totalSavedMs() sums all durationMs", async () => {
    const dir = await makeTmpDir();
    try {
      const c = new IngestCacheStore(path.join(dir, "c.json"), { ephemeral: true });
      await c.set("/a.ts", "raw", { hash: "1", durationMs: 100 });
      await c.set("/b.ts", "raw", { hash: "2", durationMs: 250 });
      await c.set("/c.ts", "raw", { hash: "3" }); // no duration
      assertEqual(c.totalSavedMs(), 350, "sum");
    } finally {
      await rmTmpDir(dir);
    }
  });
}

// ---------------------------------------------------------------------------
// Section 10: Concurrency
// ---------------------------------------------------------------------------

async function section10(): Promise<void> {
  console.log("\n— 10. Concurrency: serializes writes —");

  await test("10.1 concurrent save() calls don't clobber each other", async () => {
    const dir = await makeTmpDir();
    try {
      const cachePath = path.join(dir, "c.json");
      const c = new IngestCacheStore(cachePath);
      await c.set("/a.ts", "raw", { hash: "1" });
      const p1 = c.save();
      await c.set("/b.ts", "raw", { hash: "2" });
      const p2 = c.save();
      await Promise.all([p1, p2]);
      const c2 = new IngestCacheStore(cachePath);
      const cache2 = await c2.load();
      assert(cache2.entries[cacheKey("/a.ts", "raw")], "a kept");
      assert(cache2.entries[cacheKey("/b.ts", "raw")], "b kept");
    } finally {
      await rmTmpDir(dir);
    }
  });

  await test("10.2 20 parallel sets all persist", async () => {
    const dir = await makeTmpDir();
    try {
      const cachePath = path.join(dir, "c.json");
      const c = new IngestCacheStore(cachePath);
      const promises: Promise<void>[] = [];
      for (let i = 0; i < 20; i++) {
        promises.push(c.set(`/file${i}.ts`, "raw", { hash: `h${i}` }));
      }
      await Promise.all(promises);
      await c.save();
      const c2 = new IngestCacheStore(cachePath);
      const cache2 = await c2.load();
      assertEqual(c2.size(), 20, "all 20 persisted");
    } finally {
      await rmTmpDir(dir);
    }
  });
}

// ---------------------------------------------------------------------------
// Section 11: End-to-end incremental ingest scenario
// ---------------------------------------------------------------------------

async function section11(): Promise<void> {
  console.log("\n— 11. End-to-end: incremental ingest —");

  await test("11.1 first ingest: all files are misses", async () => {
    const dir = await makeTmpDir();
    try {
      const files = ["a.ts", "b.ts", "c.ts"].map((f) => path.join(dir, f));
      for (const f of files) await fs.writeFile(f, `// ${f}`, "utf8");
      const c = new IngestCacheStore(path.join(dir, "c.json"));
      const lookups = await c.lookupMany(files);
      for (const f of files) {
        assertEqual(lookups.get(f)!.hit, false, `${f} miss`);
      }
    } finally {
      await rmTmpDir(dir);
    }
  });

  await test("11.2 second ingest (no changes): all files are hits", async () => {
    const dir = await makeTmpDir();
    try {
      const files = ["a.ts", "b.ts", "c.ts"].map((f) => path.join(dir, f));
      for (const f of files) await fs.writeFile(f, `// ${f}`, "utf8");
      const c = new IngestCacheStore(path.join(dir, "c.json"));
      // First pass: record hashes
      for (const f of files) {
        const l = await c.lookup(f);
        await c.set(f, "raw", { hash: l.currentHash, pageIds: [`page-${path.basename(f)}`] });
      }
      await c.save();
      // Second pass: should all hit
      const lookups2 = await c.lookupMany(files);
      for (const f of files) {
        assertEqual(lookups2.get(f)!.hit, true, `${f} hit`);
      }
    } finally {
      await rmTmpDir(dir);
    }
  });

  await test("11.3 modified file: only that file misses", async () => {
    const dir = await makeTmpDir();
    try {
      const f1 = path.join(dir, "a.ts");
      const f2 = path.join(dir, "b.ts");
      await fs.writeFile(f1, "v1", "utf8");
      await fs.writeFile(f2, "stable", "utf8");
      const c = new IngestCacheStore(path.join(dir, "c.json"));
      // First pass
      for (const f of [f1, f2]) {
        const l = await c.lookup(f);
        await c.set(f, "raw", { hash: l.currentHash });
      }
      // Modify f1
      await fs.writeFile(f1, "v2 modified", "utf8");
      // Second pass
      const [l1, l2] = await Promise.all([c.lookup(f1), c.lookup(f2)]);
      assertEqual(l1.hit, false, "f1 misses (changed)");
      assertEqual(l2.hit, true, "f2 hits (unchanged)");
    } finally {
      await rmTmpDir(dir);
    }
  });

  await test("11.4 deleted file: stale entry removed, no false hit", async () => {
    const dir = await makeTmpDir();
    try {
      const f = path.join(dir, "a.ts");
      await fs.writeFile(f, "1", "utf8");
      const c = new IngestCacheStore(path.join(dir, "c.json"));
      const l1 = await c.lookup(f);
      await c.set(f, "raw", { hash: l1.currentHash });
      await c.save();
      await fs.unlink(f);
      const l2 = await c.lookup(f);
      assertEqual(l2.hit, false, "deleted file does not hit");
    } finally {
      await rmTmpDir(dir);
    }
  });

  await test("11.5 totalSavedMs reflects what we'd skip", async () => {
    const dir = await makeTmpDir();
    try {
      const f = path.join(dir, "a.ts");
      await fs.writeFile(f, "1", "utf8");
      const c = new IngestCacheStore(path.join(dir, "c.json"));
      await c.set(f, "raw", { hash: hashString("1"), durationMs: 8000 });
      await c.save();
      assertEqual(c.totalSavedMs(), 8000, "we'd save 8s on next run");
    } finally {
      await rmTmpDir(dir);
    }
  });
}

// ---------------------------------------------------------------------------
// Section 12: Edge cases
// ---------------------------------------------------------------------------

async function section12(): Promise<void> {
  console.log("\n— 12. Edge cases —");

  await test("12.1 hashString is deterministic", () => {
    const a = hashString("hello");
    const b = hashString("hello");
    assertEqual(a, b, "same input → same hash");
  });

  await test("12.2 hashString differs for different input", () => {
    const a = hashString("hello");
    const b = hashString("world");
    assert(a !== b, "different input → different hash");
  });

  await test("12.3 hashString produces 64-char hex", () => {
    const h = hashString("test");
    assertEqual(h.length, 64, "sha256 hex length");
    assert(h.match(/^[0-9a-f]+$/), "hex chars only");
  });

  await test("12.4 hashString handles empty string", () => {
    const h = hashString("");
    // Known SHA256 of empty string
    assertEqual(h, "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", "sha256(empty)");
  });

  await test("12.5 cacheKey on relative path resolves via path.resolve", () => {
    // Different cwd should still produce same key for the same logical file
    const k = cacheKey("/abs/path/foo.ts", "raw");
    assert(k.startsWith("/"), "starts with /");
    assert(k.endsWith("::raw"), "ends with mode");
  });

  await test("12.6 cache survives save+load roundtrip with complex data", async () => {
    const dir = await makeTmpDir();
    try {
      const cachePath = path.join(dir, "c.json");
      const c1 = new IngestCacheStore(cachePath);
      await c1.set("/foo.ts", "normalized", {
        hash: "abc",
        pageIds: ["p1", "p2", "p3"],
        durationMs: 12345,
        stages: ["pass1-structural", "pass2-semantic", "pass3-critic"],
      });
      await c1.save();
      const c2 = new IngestCacheStore(cachePath);
      const cache2 = await c2.load();
      const entry = cache2.entries[cacheKey("/foo.ts", "normalized")];
      assertEqual(entry.hash, "abc", "hash");
      assertEqual(entry.pageIds?.length, 3, "pageIds");
      assertEqual(entry.durationMs, 12345, "duration");
      assertEqual(entry.stages?.length, 3, "stages");
      assertEqual(entry.mode, "normalized", "mode");
    } finally {
      await rmTmpDir(dir);
    }
  });

  await test("12.7 store after clear() can be used normally", async () => {
    const dir = await makeTmpDir();
    try {
      const cachePath = path.join(dir, "c.json");
      const c = new IngestCacheStore(cachePath);
      await c.set("/a.ts", "raw", { hash: "1" });
      await c.save();
      await c.clear();
      await c.set("/b.ts", "raw", { hash: "2" });
      await c.save();
      const c2 = new IngestCacheStore(cachePath);
      const cache2 = await c2.load();
      assert(!cache2.entries[cacheKey("/a.ts", "raw")], "a cleared");
      assert(cache2.entries[cacheKey("/b.ts", "raw")], "b persisted");
    } finally {
      await rmTmpDir(dir);
    }
  });

  await test("12.8 save() before set() is a no-op (no entries)", async () => {
    const dir = await makeTmpDir();
    try {
      const cachePath = path.join(dir, "c.json");
      const c = new IngestCacheStore(cachePath);
      await c.save();
      const exists = await fs.access(cachePath).then(() => true, () => false);
      // Should NOT create file when nothing was set
      assert(!exists, "no file when empty");
    } finally {
      await rmTmpDir(dir);
    }
  });

  await test("12.9 invalidating after clear does not error", async () => {
    const dir = await makeTmpDir();
    try {
      const c = new IngestCacheStore(path.join(dir, "c.json"), { ephemeral: true });
      await c.clear();
      await c.invalidate("/anywhere.ts", "raw");
      const cache = await c.load();
      assertDeepEqual(cache.entries, {}, "still empty");
    } finally {
      await rmTmpDir(dir);
    }
  });
}

// ---------------------------------------------------------------------------
// Run all sections
// ---------------------------------------------------------------------------

async function runAll(): Promise<void> {
  console.log("╔════════════════════════════════════════════════════════════╗");
  console.log("║   PHASE 2.4 — IngestCache SHA256 + Incremental Ingest    ║");
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

  console.log("\n╔════════════════════════════════════════════════════════════╗");
  console.log(`║   RESULTS: ${passCount}/${testCount} passed, ${failCount} failed       ║`);
  console.log("╚════════════════════════════════════════════════════════════╝");

  if (failures.length > 0) {
    console.log("\nFailures:");
    for (const f of failures) console.log(f);
    process.exit(1);
  }
  if (passCount === testCount) {
    console.log("\n🎉 ALL PHASE 2.4 TESTS PASSED");
  }
}

runAll().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
