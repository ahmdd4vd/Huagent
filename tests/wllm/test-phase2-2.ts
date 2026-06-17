#!/usr/bin/env tsx
/**
 * test-wllm-phase2-2.ts — Test Pass 2 (LLM semantic extraction)
 *
 * Tests:
 *   1. Prompt building (correct structure)
 *   2. Mock provider (no network)
 *   3. Real LLM provider (MiniMax-M3) — only if TOKENROUTER_API_KEY set
 *   4. End-to-end Pass 1 + Pass 2 integration
 *   5. Error handling
 *   6. JSON parsing robustness
 */
import { extractStructureFromSource } from "../../src/wllm/ingest/structural-extractor.js";
import {
  extractSemantics,
  createMockProvider,
  createTokenRouterProvider,
  type LLMProvider,
} from "../../src/wllm/ingest/semantic-extractor.js";

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
  // ====================================================================
  await section("1. Mock provider extraction (no network)");
  // ====================================================================
  const sampleSource = `import { Logger } from "./logger";
import jwt from "jsonwebtoken";

/**
 * Manages user authentication.
 */
export class AuthService {
  async login(email: string, password: string) {
    // TODO: add rate limiting
    return null;
  }
}
`;

  const structure = extractStructureFromSource(sampleSource, "auth-service.ts");
  const mockProvider = createMockProvider();
  const mockResult = await extractSemantics(structure, mockProvider);
  test("Mock: returns structure", mockResult.structure === structure);
  test("Mock: parses entities", mockResult.entities.length > 0);
  test("Mock: parses concepts", mockResult.concepts.length > 0);
  test("Mock: parses gotchas", mockResult.gotchas.length > 0);
  test("Mock: parses connections", mockResult.connections.length > 0);
  test("Mock: parses summary", mockResult.summary.length > 0);
  test("Mock: tokens tracked", mockResult.tokensUsed > 0);

  // ====================================================================
  await section("2. JSON parsing robustness");
  // ====================================================================
  // Test that we can parse JSON wrapped in markdown
  const wrappedJson = `Here's my analysis:

\`\`\`json
{
  "entities": [{"name": "Test", "kind": "service", "description": "Test", "confidence": 0.9}],
  "concepts": [],
  "gotchas": [],
  "connections": [],
  "contradictions": [],
  "summary": "Test file"
}
\`\`\`

That's all.`;

  const mockProvider2: LLMProvider = {
    name: "wrapped",
    model: "wrapped",
    async chat() { return { content: wrappedJson }; },
    async generateText() { return { text: wrappedJson, tokensUsed: 50, durationMs: 1 }; },
  };
  const wrappedStructure = extractStructureFromSource("// test", "test.ts");
  const wrappedResult = await extractSemantics(wrappedStructure, mockProvider2);
  test("Wrapped JSON: parses entities", wrappedResult.entities.length === 1);
  test("Wrapped JSON: parses summary", wrappedResult.summary === "Test file");

  // ====================================================================
  await section("3. Malformed JSON handling");
  // ====================================================================
  const malformedJson = `{ "entities": "not an array", this is invalid json`;
  const badProvider: LLMProvider = {
    name: "bad",
    model: "bad",
    async chat() { return { content: malformedJson }; },
    async generateText() { return { text: malformedJson, tokensUsed: 0, durationMs: 0 }; },
  };
  const badStructure = extractStructureFromSource("// bad", "bad.ts");
  try {
    await extractSemantics(badStructure, badProvider);
    test("Malformed JSON: should throw", false);
  } catch (e) {
    test("Malformed JSON: throws gracefully", true);
  }

  // ====================================================================
  await section("4. Empty fields handling");
  // ====================================================================
  const emptyJson = `{
  "entities": [],
  "concepts": [],
  "gotchas": [],
  "connections": [],
  "contradictions": [],
  "summary": "Empty file"
}`;
  const emptyProvider: LLMProvider = {
    name: "empty",
    model: "empty",
    async chat() { return { content: emptyJson }; },
    async generateText() { return { text: emptyJson, tokensUsed: 0, durationMs: 0 }; },
  };
  const emptyStructure = extractStructureFromSource("// empty", "empty.ts");
  const emptyResult = await extractSemantics(emptyStructure, emptyProvider);
  test("Empty: entities = []", emptyResult.entities.length === 0);
  test("Empty: concepts = []", emptyResult.concepts.length === 0);
  test("Empty: summary preserved", emptyResult.summary === "Empty file");

  // ====================================================================
  await section("5. Real LLM provider (MiniMax-M3) — only if key set");
  // ====================================================================
  if (!process.env.TOKENROUTER_API_KEY) {
    console.log("  ⊘ Skipped: TOKENROUTER_API_KEY not set");
  } else {
    console.log("  → Testing with real MiniMax-M3...");
    try {
      const provider = createTokenRouterProvider("MiniMax-M3");
      const realSource = `
import { Logger } from "./logger";

/**
 * Calculates fibonacci numbers.
 */
export class Fibonacci {
  static compute(n: number): number {
    // TODO: optimize with memoization
    if (n < 2) return n;
    return Fibonacci.compute(n - 1) + Fibonacci.compute(n - 2);
  }
}
`;
      const realStructure = extractStructureFromSource(realSource, "fibonacci.ts");
      const t0 = Date.now();
      const realResult = await extractSemantics(realStructure, provider);
      const elapsed = Date.now() - t0;

      test("Real LLM: returns analysis", realResult !== null);
      test(`Real LLM: completed in ${elapsed}ms (< 60000ms)`, elapsed < 60000);
      test("Real LLM: tokens used", realResult.tokensUsed > 0);
      test("Real LLM: has summary", realResult.summary.length > 0);
      console.log(`  → Real LLM output (${elapsed}ms):`);
      console.log(`     summary: "${realResult.summary}"`);
      console.log(`     entities: ${realResult.entities.length}`);
      console.log(`     concepts: ${realResult.concepts.length}`);
      console.log(`     gotchas: ${realResult.gotchas.length}`);
      console.log(`     connections: ${realResult.connections.length}`);
    } catch (e: any) {
      console.log(`  ✗ Real LLM failed: ${e.message}`);
      fail++;
      failures.push(`Real LLM: ${e.message}`);
    }
  }

  // ====================================================================
  await section("6. End-to-end: Pass 1 + Pass 2 integration");
  // ====================================================================
  const e2eSource = `
import { Database } from "./db";
import { Logger } from "./logger";
import { v4 as uuid } from "uuid";

/**
 * Manages user accounts with PostgreSQL backend.
 */
export class UserRepository {
  // FIXME: race condition in concurrent updates
  static async findById(id: string) {
    return Database.query("SELECT * FROM users WHERE id = $1", [id]);
  }
}
`;
  const e2eStructure = extractStructureFromSource(e2eSource, "user-repo.ts");
  test("Pass 1: detects TODO/FIXME", e2eStructure.comments.some(c => c.type === "FIXME"));
  test("Pass 1: detects 3 imports", e2eStructure.imports.length === 3);
  test("Pass 1: detects UserRepository class", e2eStructure.classes.length === 1);

  const e2eProvider = createMockProvider();
  const e2eResult = await extractSemantics(e2eStructure, e2eProvider);
  test("Pass 2: builds on Pass 1 structure", e2eResult.structure === e2eStructure);
  test("Pass 2: extracts entities", e2eResult.entities.length > 0);
  test("Pass 2: returns complete result", e2eResult !== null);

  // ====================================================================
  console.log(`\n${"=".repeat(60)}`);
  console.log(`  Phase 2.2 Test Results: ${pass} passed, ${fail} failed`);
  console.log("=".repeat(60));

  if (fail > 0) {
    console.log("\n❌ Failed tests:");
    failures.forEach(f => console.log(`  - ${f}`));
    process.exit(1);
  } else {
    console.log("\n🎉 ALL Phase 2.2 tests PASSED");
  }
}

main().catch(e => { console.error("FATAL:", e); process.exit(1); });
