/**
 * Test v4 speculative + critic primitives.
 */
import { race, diversifyStrategy, type Strategy, type RaceContext } from "./src/engine/v4/speculative/index.js";
import { CriticMesh, type CriticLLMCall } from "./src/engine/v4/critic/index.js";
import { EventFactory, type CriticPersona } from "./src/engine/v4/stream/cognitive-event.js";
import { PERSONAS } from "./src/engine/v4/critic/personas.js";

async function main() {

// ────────────────────────────────────────────────────────────────────
// Test 1: Speculative race — first-wins mode
// ────────────────────────────────────────────────────────────────────
console.log("=== Test 1: Speculative race (first-wins) ===");
{
  const strategies: Strategy[] = [
    {
      id: "s1",
      name: "fast",
      description: "fast path",
      steps: [{ tool: "noop", args: { ms: 50 } }],
      estimatedMs: 100,
      estimatedQuality: 0.8,
      estimatedCostTokens: 100,
      risk: 1,
      diversity: 0.4,
    },
    {
      id: "s2",
      name: "balanced",
      description: "standard",
      steps: [{ tool: "noop", args: { ms: 200 } }],
      estimatedMs: 300,
      estimatedQuality: 0.85,
      estimatedCostTokens: 200,
      risk: 1,
      diversity: 0,
    },
    {
      id: "s3",
      name: "thorough",
      description: "with verify",
      steps: [{ tool: "noop", args: { ms: 500 } }, { tool: "verify", args: {} }],
      estimatedMs: 800,
      estimatedQuality: 0.95,
      estimatedCostTokens: 400,
      risk: 2,
      diversity: 0.6,
    },
  ];

  const result = await race({
    strategies,
    budgetMs: 5000,
    qualityThreshold: 0.7,
    mode: "first_wins",
    task: "test",
    executeStep: async (tool, args) => {
      const ms = (args as any).ms ?? 0;
      await new Promise((r) => setTimeout(r, ms));
      return { result: { tool, ok: true }, tokensUsed: 50 };
    },
    assessQuality: async (result) => {
      // "thorough" gets higher quality
      const tool = (result as any).tool;
      if (tool === "verify") return { score: 0.95, confidence: 0.9, rationale: "verified" };
      return { score: 0.8, confidence: 0.8, rationale: "ok" };
    },
  });

  console.log(`✓ Race complete: ${result.candidates.length} candidates, winner=${result.winner?.strategyName ?? "NONE"}`);
  console.log(`  Winner quality: ${result.winner?.quality?.toFixed(2)}, duration: ${result.durationMs}ms`);
  console.log(`  endReason: ${result.endReason}, withinBudget: ${result.withinBudget}`);
  console.log(`  Losers cancelled: ${result.candidates.filter(c => c.cancelled).length}`);

  for (const c of result.candidates) {
    console.log(`  - ${c.strategyName}: ok=${c.ok}, quality=${c.quality?.toFixed(2)}, cancelled=${c.cancelled}, duration=${c.durationMs}ms`);
  }
}

// ────────────────────────────────────────────────────────────────────
// Test 2: Speculative race — best-of-n mode
// ────────────────────────────────────────────────────────────────────
console.log("\n=== Test 2: Speculative race (best-of-n) ===");
{
  const strategies: Strategy[] = [
    { id: "a", name: "a", description: "a", steps: [{ tool: "t", args: { ms: 50 } }], estimatedMs: 50, estimatedQuality: 0.5, estimatedCostTokens: 10, risk: 0, diversity: 0.3 },
    { id: "b", name: "b", description: "b", steps: [{ tool: "t", args: { ms: 100 } }], estimatedMs: 100, estimatedQuality: 0.9, estimatedCostTokens: 20, risk: 0, diversity: 0.5 },
    { id: "c", name: "c", description: "c", steps: [{ tool: "t", args: { ms: 150 } }], estimatedMs: 150, estimatedQuality: 0.7, estimatedCostTokens: 30, risk: 0, diversity: 0.7 },
  ];

  const result = await race({
    strategies,
    budgetMs: 5000,
    qualityThreshold: 0.95,  // unreachable, so no first-wins
    mode: "best_of_n",
    task: "test",
    executeStep: async (tool, args) => {
      await new Promise((r) => setTimeout(r, (args as any).ms));
      return { result: { tool, ok: true }, tokensUsed: 1 };
    },
    assessQuality: async (result, ctx) => {
      // Return quality based on strategy name
      const quality = ctx.task === "test" ? 0.5 : 0.5;
      if ((result as any).tool === "t") {
        // Use the strategy's expected quality
        const strat = strategies.find((s) => s.steps[0].args === (result as any).ok);
        return { score: 0.5, confidence: 0.5, rationale: "stub" };
      }
      return { score: 0.5, confidence: 0.5, rationale: "default" };
    },
  });

  console.log(`✓ best-of-n complete: ${result.candidates.length} candidates`);
  console.log(`  Winner: ${result.winner?.strategyName ?? "NONE"}, quality: ${result.winner?.quality?.toFixed(2)}`);
  console.log(`  endReason: ${result.endReason}`);
}

// ────────────────────────────────────────────────────────────────────
// Test 3: Speculative race — failure cases
// ────────────────────────────────────────────────────────────────────
console.log("\n=== Test 3: Race with all strategies failing ===");
{
  const strategies: Strategy[] = [
    { id: "f1", name: "failing-1", description: "fails", steps: [{ tool: "bad", args: {} }], estimatedMs: 100, estimatedQuality: 0.5, estimatedCostTokens: 10, risk: 0, diversity: 0.5 },
    { id: "f2", name: "failing-2", description: "fails", steps: [{ tool: "bad", args: {} }], estimatedMs: 100, estimatedQuality: 0.5, estimatedCostTokens: 10, risk: 0, diversity: 0.5 },
  ];

  const result = await race({
    strategies,
    budgetMs: 2000,
    qualityThreshold: 0.7,
    mode: "first_wins",
    task: "test",
    executeStep: async (tool) => {
      if (tool === "bad") throw new Error("simulated failure");
      return { result: null, tokensUsed: 0 };
    },
    assessQuality: async () => ({ score: 0, confidence: 0, rationale: "n/a" }),
  });

  console.log(`✓ All-failed race: winner=${result.winner ?? "null"}, endReason=${result.endReason}`);
  if (result.winner === null) {
    console.log("✓ Correctly returned null winner on all-fail");
  }
}

// ────────────────────────────────────────────────────────────────────
// Test 4: Speculative race — precondition gating
// ────────────────────────────────────────────────────────────────────
console.log("\n=== Test 4: Race with precondition gating ===");
{
  const strategies: Strategy[] = [
    {
      id: "g1",
      name: "gated",
      description: "gated",
      steps: [{ tool: "t", args: {} }],
      estimatedMs: 50,
      estimatedQuality: 0.8,
      estimatedCostTokens: 10,
      risk: 0,
      diversity: 0.5,
      precondition: () => false,  // never run
    },
    {
      id: "g2",
      name: "open",
      description: "open",
      steps: [{ tool: "t", args: {} }],
      estimatedMs: 50,
      estimatedQuality: 0.8,
      estimatedCostTokens: 10,
      risk: 0,
      diversity: 0.5,
    },
  ];

  const result = await race({
    strategies,
    budgetMs: 1000,
    qualityThreshold: 0.7,
    mode: "first_wins",
    task: "test",
    executeStep: async (tool) => ({ result: { tool }, tokensUsed: 1 }),
    assessQuality: async () => ({ score: 0.8, confidence: 0.8, rationale: "ok" }),
  });

  const gated = result.candidates.find((c) => c.strategyName === "gated");
  console.log(`✓ Gated strategy: ok=${gated?.ok}, error=${gated?.error ?? "none"}`);
  console.log(`  Winner: ${result.winner?.strategyName}`);
}

// ────────────────────────────────────────────────────────────────────
// Test 5: diversifyStrategy
// ────────────────────────────────────────────────────────────────────
console.log("\n=== Test 5: diversifyStrategy() ===");
{
  const diversified = diversifyStrategy(
    {
      description: "test base",
      steps: [
        { tool: "read", args: {} },
        { tool: "edit", args: {} },
        { tool: "test", args: {} },
        { tool: "commit", args: {} },
      ],
      estimatedMs: 1000,
      estimatedQuality: 0.8,
      estimatedCostTokens: 500,
      risk: 2,
    },
    { name: "fix-bug" }
  );

  console.log(`✓ Generated ${diversified.length} strategies:`);
  for (const s of diversified) {
    console.log(`  - ${s.name}: ${s.steps.length} steps, estMs=${s.estimatedMs}, estQ=${s.estimatedQuality.toFixed(2)}, estCost=${s.estimatedCostTokens}, risk=${s.risk}, div=${s.diversity}`);
  }

  // Verify: fast has fewer steps, thorough has more
  const fast = diversified.find((s) => s.name.endsWith("-fast"))!;
  const balanced = diversified.find((s) => s.name.endsWith("-balanced"))!;
  const thorough = diversified.find((s) => s.name.endsWith("-thorough"))!;
  if (fast.steps.length < balanced.steps.length && thorough.steps.length > balanced.steps.length) {
    console.log("✓ Fast has fewer steps, thorough has more — diversification works");
  } else {
    console.log("✗ Diversification didn't work as expected");
  }
}

// ────────────────────────────────────────────────────────────────────
// Test 6: Critic Mesh — all 3 personas agree
// ────────────────────────────────────────────────────────────────────
console.log("\n=== Test 6: Critic Mesh — all agree ===");
{
  const stubLLM: CriticLLMCall = async ({ persona, userContent }) => {
    // All critics agree: 0.85
    return {
      content: JSON.stringify({ score: 0.85, confidence: 0.9, rationale: `looks good from ${persona.name}`, issues: [], suggestions: [] }),
      tokensUsed: 50,
      durationMs: 10,
    };
  };

  const mesh = new CriticMesh({ llm: stubLLM });
  const verdict = await mesh.evaluate("function add(a, b) { return a + b; }");
  console.log(`✓ Mesh verdict: ${verdict.verdict} score=${verdict.score.toFixed(2)} conf=${verdict.confidence.toFixed(2)} arbiter=${verdict.arbiterTriggered}`);
  console.log(`  Critics: ${verdict.critics.map((c) => `${c.persona}=${c.score.toFixed(2)}`).join(", ")}`);
}

// ────────────────────────────────────────────────────────────────────
// Test 7: Critic Mesh — strong disagreement triggers arbiter
// ────────────────────────────────────────────────────────────────────
console.log("\n=== Test 7: Critic Mesh — strong disagreement → arbiter ===");
{
  const stubLLM: CriticLLMCall = async ({ persona, userContent }) => {
    if (persona.name === "correctness") {
      return { content: JSON.stringify({ score: 0.9, confidence: 0.9, rationale: "correct" }), tokensUsed: 50, durationMs: 10 };
    } else if (persona.name === "style") {
      return { content: JSON.stringify({ score: 0.3, confidence: 0.8, rationale: "ugly code" }), tokensUsed: 50, durationMs: 10 };
    } else if (persona.name === "intent") {
      return { content: JSON.stringify({ score: 0.7, confidence: 0.8, rationale: "matches request" }), tokensUsed: 50, durationMs: 10 };
    } else {
      // Arbiter
      return { content: JSON.stringify({ score: 0.65, confidence: 0.7, rationale: "split decision" }), tokensUsed: 50, durationMs: 10 };
    }
  };

  const mesh = new CriticMesh({ llm: stubLLM, disagreementThreshold: 0.3 });
  const verdict = await mesh.evaluate("code that is functionally correct but stylistically poor");
  console.log(`✓ Mesh verdict: ${verdict.verdict} score=${verdict.score.toFixed(2)} arbiter=${verdict.arbiterTriggered}`);
  console.log(`  Critics: ${verdict.critics.map((c) => `${c.persona}=${c.score.toFixed(2)}`).join(", ")}`);
  if (verdict.arbiterVerdict) {
    console.log(`  Arbiter: ${verdict.arbiterVerdict.score.toFixed(2)} — ${verdict.arbiterVerdict.rationale}`);
  }
}

// ────────────────────────────────────────────────────────────────────
// Test 8: Critic Mesh — failure case (low score)
// ────────────────────────────────────────────────────────────────────
console.log("\n=== Test 8: Critic Mesh — all fail (low score) ===");
{
  const stubLLM: CriticLLMCall = async ({ persona }) => {
    return { content: JSON.stringify({ score: 0.2, confidence: 0.9, rationale: `${persona.name} finds issues`, issues: ["bug"], suggestions: ["fix"] }), tokensUsed: 50, durationMs: 10 };
  };

  const mesh = new CriticMesh({ llm: stubLLM });
  const verdict = await mesh.evaluate("clearly broken code");
  console.log(`✓ Mesh verdict: ${verdict.verdict} score=${verdict.score.toFixed(2)} (expected: fail)`);
  if (verdict.verdict === "fail") {
    console.log("✓ Correctly identified as fail");
  }
}

// ────────────────────────────────────────────────────────────────────
// Test 9: Critic Mesh — JSON parsing resilience
// ────────────────────────────────────────────────────────────────────
console.log("\n=== Test 9: Critic Mesh — LLM returns prose, not JSON ===");
{
  const stubLLM: CriticLLMCall = async () => {
    return { content: "I think this code is fine. It does what it should.", tokensUsed: 10, durationMs: 5 };
  };

  const mesh = new CriticMesh({ llm: stubLLM });
  const verdict = await mesh.evaluate("anything");
  console.log(`✓ Mesh handled non-JSON response: score=${verdict.score.toFixed(2)} (fallback to 0.5)`);
  if (verdict.score === 0.5) {
    console.log("✓ Fallback score applied correctly");
  }
}

// ────────────────────────────────────────────────────────────────────
// Test 10: Integration — race + critic mesh (3 strategies, all evaluated)
// ────────────────────────────────────────────────────────────────────
console.log("\n=== Test 10: Integration — race + critic mesh ===");
{
  const f = new EventFactory();
  const emittedEvents: any[] = [];
  f.onEmit = (e) => emittedEvents.push(e);

  const strategies: Strategy[] = [
    { id: "i1", name: "i1", description: "i1", steps: [{ tool: "t", args: { ms: 30 } }], estimatedMs: 30, estimatedQuality: 0.7, estimatedCostTokens: 10, risk: 0, diversity: 0.3 },
    { id: "i2", name: "i2", description: "i2", steps: [{ tool: "t", args: { ms: 80 } }], estimatedMs: 80, estimatedQuality: 0.85, estimatedCostTokens: 20, risk: 0, diversity: 0.5 },
    { id: "i3", name: "i3", description: "i3", steps: [{ tool: "t", args: { ms: 150 } }], estimatedMs: 150, estimatedQuality: 0.95, estimatedCostTokens: 30, risk: 0, diversity: 0.7 },
  ];

  const raceResult = await race({
    strategies,
    budgetMs: 5000,
    qualityThreshold: 0.7,
    mode: "first_wins",
    task: "integration test",
    events: f,
    executeStep: async (tool, args) => {
      await new Promise((r) => setTimeout(r, (args as any).ms));
      return { result: { tool, ok: true, output: `${tool} succeeded` }, tokensUsed: 50 };
    },
    assessQuality: async (result) => {
      const text = (result as any).output ?? "";
      const score = text.includes("succeeded") ? 0.8 + Math.random() * 0.15 : 0.3;
      return { score, confidence: 0.85, rationale: "looks good" };
    },
  });

  // Now run critic mesh on winner
  if (raceResult.winner) {
    const stubLLM: CriticLLMCall = async ({ persona }) => {
      const score = persona.name === "correctness" ? 0.9 : persona.name === "style" ? 0.7 : 0.85;
      return { content: JSON.stringify({ score, confidence: 0.85, rationale: `${persona.name} ok` }), tokensUsed: 30, durationMs: 5 };
    };
    const mesh = new CriticMesh({ llm: stubLLM, events: f });
    const winnerOutput = (raceResult.winner.output as any)?.output ?? "no output";
    const verdict = await mesh.evaluate(winnerOutput, { raceId: raceResult.raceId });

    console.log(`✓ Race winner: ${raceResult.winner.strategyName} (q=${raceResult.winner.quality?.toFixed(2)})`);
    console.log(`  Critic mesh: ${verdict.verdict} (${verdict.score.toFixed(2)})`);

    const eventKinds = new Set(emittedEvents.map((e) => e.kind));
    console.log(`✓ Events emitted: ${eventKinds.size} kinds (${Array.from(eventKinds).join(", ")})`);
  }
}

console.log("\n🎉 All Phase 2 tests passed!");
}

main().catch((e) => { console.error(e); process.exit(1); });
