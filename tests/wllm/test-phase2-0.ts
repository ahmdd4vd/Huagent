#!/usr/bin/env tsx
/**
 * test-wllm-phase2-0.ts — Test Wiki Manifest
 */
import { WikiStore } from "../../src/wllm/index.js";
import {
  ManifestManager,
  createDefaultManifest,
  parseManifest,
  manifestToYaml,
  generateManifestFromWiki,
  validateManifest,
  namespacedPageId,
  extractWikiId,
  extractPageSlug,
  type WikiManifest,
} from "../../src/wllm/storage/manifest.js";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

let pass = 0;
let fail = 0;
const failures: string[] = [];

function test(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; failures.push(`${name}${detail ? ': ' + detail : ''}`); console.log(`  ✗ ${name}${detail ? ': ' + detail : ''}`); }
}

async function section(name: string) {
  console.log(`\n=== ${name} ===`);
}

async function main() {
  const tmpDir = await mkdtemp(join(tmpdir(), "wllm-manifest-"));
  try {
    // ====================================================================
    await section("1. createDefaultManifest");
    // ====================================================================
    const def = createDefaultManifest();
    test("Default has name", def.name === "Untitled Wiki");
    test("Default has version 0.1.0", def.version === "0.1.0");
    test("Default has license MIT", def.license === "MIT");
    test("Default has id in namespace:slug format", def.id.includes(":"));
    test("Default has created timestamp", !!def.created);
    test("Default has empty tags", def.tags.length === 0);
    test("Default has empty dependencies", def.dependencies.length === 0);

    const custom = createDefaultManifest({
      name: "My Wiki",
      id: "wllm:my-wiki",
      version: "2.0.0",
      tags: ["test"],
    });
    test("Custom name", custom.name === "My Wiki");
    test("Custom id", custom.id === "wllm:my-wiki");
    test("Custom version", custom.version === "2.0.0");
    test("Custom tags", custom.tags.length === 1);

    // ====================================================================
    await section("2. manifestToYaml + parseManifest roundtrip");
    // ====================================================================
    const sample: WikiManifest = {
      name: "PostgreSQL Panduan",
      id: "wllm:postgres-panduan",
      version: "1.2.0",
      author: { name: "David", handle: "@david", email: "david@example.com" },
      license: "MIT",
      description: "Panduan PostgreSQL untuk backend",
      longDescription: "Wiki ini mencakup...",
      tags: ["postgres", "database", "backend"],
      category: "backend",
      github: "https://github.com/david/wllm-postgres",
      homepage: "https://wllm.example.com/postgres",
      dependencies: ["PostgreSQL 14+", "Node 20+"],
      minHuagentVersion: "4.0.0",
      created: "2026-01-15T00:00:00.000Z",
      updated: "2026-06-14T00:00:00.000Z",
    };

    const yaml = manifestToYaml(sample);
    test("YAML has name", yaml.includes("name: PostgreSQL Panduan"));
    test("YAML has id (quoted or unquoted)", yaml.includes("wllm:postgres-panduan"));
    test("YAML has version", yaml.includes("version: 1.2.0"));
    test("YAML has author block", yaml.includes("author:") && yaml.includes("name: David") && yaml.includes("handle:") && yaml.includes("@david"));
    test("YAML has license", yaml.includes("license: MIT"));
    test("YAML has tags list", yaml.includes("tags:") && yaml.includes("- postgres") && yaml.includes("- database"));
    test("YAML has dependencies list", yaml.includes("dependencies:") && yaml.includes("- PostgreSQL 14+"));
    test("YAML has github (quoted)", yaml.includes("github.com/david/wllm-postgres"));

    const parsed = parseManifest(yaml);
    test("Parse: name", parsed.name === sample.name);
    test("Parse: id", parsed.id === sample.id);
    test("Parse: version", parsed.version === sample.version);
    test("Parse: author.name", parsed.author.name === "David");
    test("Parse: author.handle", parsed.author.handle === "@david");
    test("Parse: author.email", parsed.author.email === "david@example.com");
    test("Parse: license", parsed.license === "MIT");
    test("Parse: description", parsed.description === sample.description);
    test("Parse: tags", JSON.stringify(parsed.tags) === JSON.stringify(sample.tags));
    test("Parse: category", parsed.category === "backend");
    test("Parse: github", parsed.github === sample.github);
    test("Parse: homepage", parsed.homepage === sample.homepage);
    test("Parse: dependencies", JSON.stringify(parsed.dependencies) === JSON.stringify(sample.dependencies));
    test("Parse: minHuagentVersion", parsed.minHuagentVersion === "4.0.0");
    test("Parse: created", parsed.created === sample.created);

    // ====================================================================
    await section("3. ManifestManager read/write");
    // ====================================================================
    const manifestPath = join(tmpDir, "wiki.yaml");
    const mm = new ManifestManager(manifestPath);

    test("Manifest doesn't exist initially", !mm.exists());

    const written = await mm.write(sample);
    test("After write, exists", mm.exists());

    const read = await mm.read();
    test("Read after write returns manifest", read !== null);
    test("Read: name matches", read?.name === sample.name);
    test("Read: github matches", read?.github === sample.github);
    test("Read: tags match", JSON.stringify(read?.tags) === JSON.stringify(sample.tags));

    // ====================================================================
    await section("4. ManifestManager update");
    // ====================================================================
    const updated = await mm.update({ version: "1.3.0", tags: ["postgres", "database", "backend", "new"] });
    test("Update changes version", updated.version === "1.3.0");
    test("Update preserves name", updated.name === sample.name);
    test("Update adds tag", updated.tags.length === 4);

    // Update author block — only email should change, handle should be preserved (deep merge)
    const updatedAuthor = await mm.update({ author: { name: "David", email: "new@example.com" } });
    test("Update author.name preserves", updatedAuthor.author.name === "David");
    test("Update author.email overwrites", updatedAuthor.author.email === "new@example.com");
    test("Update author.handle preserved (deep merge)", updatedAuthor.author.handle === "@david");

    // ====================================================================
    await section("5. ManifestManager ensureExists");
    // ====================================================================
    const tmpDir2 = await mkdtemp(join(tmpdir(), "wllm-ensure-"));
    try {
      const mm2 = new ManifestManager(join(tmpDir2, "wiki.yaml"));
      const store = new WikiStore();
      await store.clear();
      await store.createPage({ pageType: "entity", label: "PostgreSQL", body: "DB", tags: ["postgres", "database"] });
      await store.createPage({ pageType: "concept", label: "ACID", body: "concept", tags: ["postgres"] });
      await store.createPage({ pageType: "decision", label: "Postgres Choice", body: "why" });

      const ensured = await mm2.ensureExists(store, { name: "PG Wiki" });
      test("ensureExists creates manifest", ensured !== null);
      test("ensureExists uses provided name", ensured.name === "PG Wiki");
      test("ensureExists uses auto-generated description", ensured.description.includes("3 pages"));
      test("ensureExists auto-detects tags", ensured.tags.includes("postgres"));
      test("ensureExists auto-detects category", ensured.category === "reference" || ensured.category === "patterns");
    } finally {
      await rm(tmpDir2, { recursive: true });
    }

    // ====================================================================
    await section("6. validateManifest");
    // ====================================================================
    test("Valid manifest passes", validateManifest(sample).valid);

    const invalid1 = { ...sample, name: "" };
    test("Empty name fails", !validateManifest(invalid1).valid);

    const invalid2 = { ...sample, id: "no-namespace" };
    test("id without namespace fails", !validateManifest(invalid2).valid);

    const invalid3 = { ...sample, author: { name: "" } as any };
    test("Empty author.name fails", !validateManifest(invalid3).valid);

    // ====================================================================
    await section("7. namespacedPageId utilities");
    // ====================================================================
    test("namespacedPageId simple", namespacedPageId("wllm:postgres", "acid") === "wllm:postgres:acid");
    test("namespacedPageId with github", namespacedPageId("github:david/repo", "patterns") === "github:david/repo:patterns");

    test("extractWikiId simple", extractWikiId("wllm:postgres:acid") === "wllm:postgres");
    test("extractWikiId github", extractWikiId("github:david/repo:patterns") === "github:david/repo");
    test("extractWikiId invalid", extractWikiId("no-namespace") === null);

    test("extractPageSlug simple", extractPageSlug("wllm:postgres:acid") === "acid");
    test("extractPageSlug github", extractPageSlug("github:david/repo:patterns") === "patterns");
    test("extractPageSlug invalid", extractPageSlug("no-namespace") === null);

    // ====================================================================
    await section("8. generateManifestFromWiki with various wiki states");
    // ====================================================================
    const store3 = new WikiStore();
    await store3.clear();

    // Empty wiki
    const gen1 = await generateManifestFromWiki(store3);
    // Empty wiki has no pages, so dominantType is undefined, falls through to "concept" → "patterns"
    test("Empty wiki: has a default category", typeof gen1.category === "string" && gen1.category.length > 0);
    test("Empty wiki: no tags", gen1.tags.length === 0);

    // Wiki with various pages
    await store3.createPage({ pageType: "entity", label: "PostgreSQL", body: "DB", tags: ["postgres", "database"] });
    await store3.createPage({ pageType: "entity", label: "Redis", body: "Cache", tags: ["cache"] });
    await store3.createPage({ pageType: "decision", label: "Choice", body: "why" });

    const gen2 = await generateManifestFromWiki(store3, { name: "Test Wiki" });
    test("Generated: uses provided name", gen2.name === "Test Wiki");
    test("Generated: description mentions pages", gen2.description.includes("3 pages"));
    test("Generated: top tag is 'postgres'", gen2.tags[0] === "postgres");

    // ====================================================================
    await section("9. End-to-end: create wiki + manifest + read back");
    // ====================================================================
    const tmpDir3 = await mkdtemp(join(tmpdir(), "wllm-e2e-"));
    try {
      const manifestPath = join(tmpDir3, "wiki.yaml");
      const mm3 = new ManifestManager(manifestPath);

      const store = new WikiStore();
      await store.clear();
      await store.createPage({ pageType: "entity", label: "JWT", body: "Token standard", tags: ["auth", "security"] });

      // 1. Ensure manifest exists
      const m = await mm3.ensureExists(store, {
        name: "Auth Wiki",
        id: "wllm:auth",
        author: { name: "David", handle: "@david" },
        description: "Wiki about authentication",
        github: "https://github.com/david/wllm-auth",
        tags: ["auth"],
        category: "security",
      });
      test("E2E: manifest created", m.id === "wllm:auth");
      test("E2E: manifest has github", m.github?.includes("github.com"));

      // 2. Read back from disk
      const mmRead = new ManifestManager(manifestPath);
      const readBack = await mmRead.read();
      test("E2E: manifest persists to disk", readBack !== null);
      test("E2E: persisted manifest has correct id", readBack?.id === "wllm:auth");
      test("E2E: persisted manifest has correct author.handle", readBack?.author.handle === "@david");

      // 3. Update and verify update
      await mmRead.update({ version: "2.0.0" });
      const reRead = await mmRead.read();
      test("E2E: update persists", reRead?.version === "2.0.0");
      test("E2E: updated timestamp is newer", reRead!.updated >= m.updated);

      // 4. Validate final
      const v = validateManifest(reRead!);
      test("E2E: final manifest is valid", v.valid);
    } finally {
      await rm(tmpDir3, { recursive: true });
    }

    // ====================================================================
    console.log(`\n${"=".repeat(60)}`);
    console.log(`  Phase 2.0 Test Results: ${pass} passed, ${fail} failed`);
    console.log("=".repeat(60));

    if (fail > 0) {
      console.log("\n❌ Failed tests:");
      failures.forEach(f => console.log(`  - ${f}`));
      process.exit(1);
    } else {
      console.log("\n🎉 ALL Phase 2.0 tests PASSED");
    }
  } finally {
    await rm(tmpDir, { recursive: true });
  }
}

main().catch(e => { console.error("FATAL:", e); process.exit(1); });
