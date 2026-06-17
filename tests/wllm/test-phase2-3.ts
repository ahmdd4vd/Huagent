#!/usr/bin/env tsx
/**
 * test-wllm-phase2-3.ts — Test Pass 3 (Critic Mesh verification)
 */
import { extractStructureFromSource } from "../../src/wllm/ingest/structural-extractor.js";
import { extractSemantics, createMockProvider, createTokenRouterProvider, type LLMProvider } from "../../src/wllm/ingest/semantic-extractor.js";
import { verify, aggregate, shouldTriggerArbiter } from "../../src/wllm/ingest/verifier.js";

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
  await section("1. aggregate() — Borda count");
  // ====================================================================
  const fakeCritics1 = [
    { persona: "correctness" as const, score: 0.98, confidence: 0.9, rationale: "", issues: [], suggestions: [], tokensUsed: 0, durationMs: 0 },
    { persona: "style" as const, score: 0.95, confidence: 0.8, rationale: "", issues: [], suggestions: [], tokensUsed: 0, durationMs: 0 },
    { persona: "intent" as const, score: 0.97, confidence: 0.85, rationale: "", issues: [], suggestions: [], tokensUsed: 0, durationMs: 0 },
  ];
  const agg1 = aggregate(fakeCritics1);
  test("All-good critics → high score", agg1.score > 0.9);
  test("All-good critics → VERIFIED", agg1.level === "VERIFIED");

  const fakeCritics2 = [
    { persona: "correctness" as const, score: 0.3, confidence: 0.5, rationale: "", issues: [], suggestions: [], tokensUsed: 0, durationMs: 0 },
    { persona: "style" as const, score: 0.4, confidence: 0.5, rationale: "", issues: [], suggestions: [], tokensUsed: 0, durationMs: 0 },
    { persona: "intent" as const, score: 0.5, confidence: 0.5, rationale: "", issues: [], suggestions: [], tokensUsed: 0, durationMs: 0 },
  ];
  const agg2 = aggregate(fakeCritics2);
  test("Low scores → ASSUMED", agg2.level === "ASSUMED" || agg2.level === "CONTRADICTED");

  const fakeCritics3 = [
    { persona: "correctness" as const, score: 0.1, confidence: 0.9, rationale: "", issues: [], suggestions: [], tokensUsed: 0, durationMs: 0 },
    { persona: "style" as const, score: 0.1, confidence: 0.9, rationale: "", issues: [], suggestions: [], tokensUsed: 0, durationMs: 0 },
    { persona: "intent" as const, score: 0.1, confidence: 0.9, rationale: "", issues: [], suggestions: [], tokensUsed: 0, durationMs: 0 },
  ];
  const agg3 = aggregate(fakeCritics3);
  test("Very low scores → CONTRADICTED", agg3.level === "CONTRADICTED");

  // ====================================================================
  await section("2. shouldTriggerArbiter() — disagreement detection");
  // ====================================================================
  test("No disagreement (< 0.4 spread) → no arbiter", !shouldTriggerArbiter(fakeCritics1));
  test("Strong disagreement (0.4+ spread) → arbiter", shouldTriggerArbiter([
    { persona: "correctness" as const, score: 0.2, confidence: 0.5, rationale: "", issues: [], suggestions: [], tokensUsed: 0, durationMs: 0 },
    { persona: "style" as const, score: 0.9, confidence: 0.5, rationale: "", issues: [], suggestions: [], tokensUsed: 0, durationMs: 0 },
    { persona: "intent" as const, score: 0.5, confidence: 0.5, rationale: "", issues: [], suggestions: [], tokensUsed: 0, durationMs: 0 },
  ]));
  test("Less than 3 critics → no arbiter", !shouldTriggerArbiter([
    { persona: "correctness" as const, score: 0.2, confidence: 0.5, rationale: "", issues: [], suggestions: [], tokensUsed: 0, durationMs: 0 },
  ]));

  // ====================================================================
  await section("3. Mock provider verification");
  // ====================================================================
  const mockStructure = extractStructureFromSource(`export class Test {}`, "test.ts");
  const mockProvider = createMockProvider();
  const mockAnalysis = await extractSemantics(mockStructure, mockProvider);
  const mockVerify = await verify(mockAnalysis, mockProvider);

  test("Mock verify: 3 critics", mockVerify.critics.length === 3);
  test("Mock verify: all 3 personas present", 
    mockVerify.critics.some(c => c.persona === "correctness") &&
    mockVerify.critics.some(c => c.persona === "style") &&
    mockVerify.critics.some(c => c.persona === "intent"));
  test("Mock verify: scores in 0-1", mockVerify.critics.every(c => c.score >= 0 && c.score <= 1));
  test("Mock verify: confidence in 0-1", mockVerify.critics.every(c => c.confidence >= 0 && c.confidence <= 1));
  test("Mock verify: aggregated score computed", typeof mockVerify.score === "number");
  test("Mock verify: confidence level assigned", mockVerify.confidenceLevel !== undefined);
  test("Mock verify: total tokens tracked", mockVerify.totalTokens > 0);
  test("Mock verify: mock doesn't trigger arbiter (consensus)", !mockVerify.arbiterTriggered);

  // ====================================================================
  await section("4. Verifier with forced disagreement (arbiter)");
  // ====================================================================
  // Create a provider that returns very different scores for each persona
  let callCount = 0;
  const disagreeingProvider: LLMProvider = {
    name: "disagree",
    model: "disagree",
    async chat() { return { content: "{}" }; },
    async generateText(prompt) {
      callCount++;
      let score = 0.5;
      if (prompt.includes("TECHNICAL CORRECTNESS")) score = 0.2;  // critic 1: bad
      if (prompt.includes("WRITING QUALITY")) score = 0.9;       // critic 2: good
      if (prompt.includes("ACTUAL PURPOSE")) score = 0.5;        // critic 3: middle
      return {
        text: JSON.stringify({
          score,
          confidence: 0.8,
          rationale: `Disagreement test for score ${score}`,
          issues: [],
          suggestions: [],
        }),
        tokensUsed: 50,
        durationMs: 5,
      };
    },
  };
  // Reset call counter for this test (extractSemantics already made 1 call)
  callCount = 0;
  const disagreeStructure = extractStructureFromSource(`// test`, "test.ts");
  // Use pre-built analysis with no LLM call needed (skip extractSemantics)
  const disagreeAnalysis = {
    structure: disagreeStructure,
    entities: [],
    concepts: [],
    gotchas: [],
    connections: [],
    contradictions: [],
    summary: "test",
    tokensUsed: 0,
  };
  const disagreeVerify = await verify(disagreeAnalysis, disagreeingProvider);

  test("Disagreement: arbiter triggered", disagreeVerify.arbiterTriggered);
  test("Disagreement: arbiter verdict present", disagreeVerify.arbiterVerdict !== undefined);
  // 3 critics + 1 arbiter = 4 calls
  test("Disagreement: 4 verify calls (3 critics + 1 arbiter)", callCount === 4);

  // ====================================================================
  await section("5. Real LLM verification (MiniMax-M3) — if key set");
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
 * Validates user input.
 */
export class Validator {
  static isEmail(email: string): boolean {
    return /^\\S+@\\S+\\.\\S+$/.test(email);
  }
}
`;
      const realStructure = extractStructureFromSource(realSource, "validator.ts");
      const realAnalysis = await extractSemantics(realStructure, provider);
      const t0 = Date.now();
      const realVerify = await verify(realAnalysis, provider);
      const elapsed = Date.now() - t0;

      test(`Real verify: completed in ${elapsed}ms (< 120000ms)`, elapsed < 120000);
      test("Real verify: 3 critics", realVerify.critics.length === 3);
      test("Real verify: total tokens > 0", realVerify.totalTokens > 0);
      console.log(`  → Real verifier output (${elapsed}ms):`);
      console.log(`     score: ${realVerify.score.toFixed(3)}, confidence: ${realVerify.confidence.toFixed(3)}`);
      console.log(`     level: ${realVerify.confidenceLevel}`);
      console.log(`     arbiter: ${realVerify.arbiterTriggered}`);
      for (const c of realVerify.critics) {
        console.log(`     - ${c.persona}: score=${c.score.toFixed(2)}, conf=${c.confidence.toFixed(2)} - "${c.rationale.slice(0, 60)}"`);
      }
    } catch (e: any) {
      console.log(`  ✗ Real verify failed: ${e.message}`);
      fail++;
      failures.push(`Real verify: ${e.message}`);
    }
  }

  // ====================================================================
  console.log(`\n${"=".repeat(60)}`);
  console.log(`  Phase 2.3 Test Results: ${pass} passed, ${fail} failed`);
  console.log("=".repeat(60));

  if (fail > 0) {
    console.log("\n❌ Failed tests:");
    failures.forEach(f => console.log(`  - ${f}`));
    process.exit(1);
  } else {
    console.log("\n🎉 ALL Phase 2.3 tests PASSED");
  }
}

main().catch(e => { console.error("FATAL:", e); process.exit(1); });
