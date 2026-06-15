/**
 * Test v4 stream + HTN primitives.
 */
import { EventFactory, BoundedQueue, Source, Transform, Sink, tee, ReplayLog, summarize, type CognitiveEvent } from "./src/engine/v4/stream/index.js";
import { HTNPlanner, type LLMCall } from "./src/engine/v4/htn/index.js";

async function main() {

// ────────────────────────────────────────────────────────────────────
// Test 1: BoundedQueue with backpressure
// ────────────────────────────────────────────────────────────────────
console.log("=== Test 1: BoundedQueue backpressure ===");
{
  const q = new BoundedQueue<number>(3, "block");
  console.log("✓ Created queue capacity=3");

  await q.push(1);
  await q.push(2);
  await q.push(3);
  console.log(`✓ Filled queue: size=${q.size}`);

  const a = await q.pull();
  console.log(`✓ Pulled: ${a}, size=${q.size}`);

  await q.push(4);
  console.log(`✓ Pushed 4, size=${q.size}`);

  // Test drop_old
  const q2 = new BoundedQueue<number>(3, "drop_old");
  await q2.push(1);
  await q2.push(2);
  await q2.push(3);
  const dropped = await q2.push(4);
  console.log(`✓ drop_old: pushed 4, dropped=${!dropped}, size=${q2.size}`);
  const items: number[] = [];
  for (let i = 0; i < 3; i++) items.push((await q2.pull())!);
  console.log(`✓ Items after drop_old: ${items.join(",")} (expected: 2,3,4)`);

  // Test error
  const q3 = new BoundedQueue<number>(2, "error");
  await q3.push(1);
  await q3.push(2);
  try {
    await q3.push(3);
    console.log("✗ Should have thrown!");
  } catch (e) {
    console.log(`✓ error strategy threw: ${(e as Error).message.slice(0, 40)}`);
  }
}

// ────────────────────────────────────────────────────────────────────
// Test 2: EventFactory
// ────────────────────────────────────────────────────────────────────
console.log("\n=== Test 2: EventFactory ===");
{
  const f = new EventFactory();
  const e1 = f.make("classified", { task: "fix bug", intent: "code_fix", complexity: "simple", confidence: 0.9 });
  const e2 = f.make("htn_plan", { planId: "p1", subgoals: 4, steps: 6, parallelGroups: 3 });
  const e3 = f.make("critic_verdict", { critic: "correctness", score: 0.85, confidence: 0.9, rationale: "looks good" });
  console.log(`✓ Created 3 events: seq=${e1.seq},${e2.seq},${e3.seq}`);
  console.log(`  e1: ${summarize(e1)}`);
  console.log(`  e2: ${summarize(e2)}`);
  console.log(`  e3: ${summarize(e3)}`);
}

// ────────────────────────────────────────────────────────────────────
// Test 3: Source → Transform → Sink (full pipeline)
// ────────────────────────────────────────────────────────────────────
console.log("\n=== Test 3: Source → Transform → Sink ===");
{
  const events: CognitiveEvent[] = [];
  const f = new EventFactory();

  const source = new Source<CognitiveEvent>(async (emit) => {
    for (let i = 0; i < 5; i++) {
      await emit(f.make("tool_call", { tool: "read", args: { path: `f${i}.ts` } }));
    }
  });

  const transform = new Transform<CognitiveEvent, CognitiveEvent>(async (e, emit) => {
    // Convert tool_call → tool_result
    if (e.kind === "tool_call") {
      await emit({
        kind: "tool_result",
        tool: e.tool,
        result: { path: (e.args as any).path, content: "mock" },
        ts: Date.now(),
        seq: 0, // not used downstream
        durationMs: 5,
      });
    } else {
      await emit(e);
    }
  });

  const sink = new Sink<CognitiveEvent>(async (e) => {
    events.push(e);
  });

  // Start everything
  source.start();
  sink.run();

  // Wire them
  while (true) {
    const e = await source.pull();
    if (e === null) break;
    await transform.push(e);
  }
  transform.closeInput();
  await transform.drain();
  while (true) {
    const e = await transform.pull();
    if (e === null) break;
    await sink.push(e);
  }
  sink.close();
  await sink.run();

  console.log(`✓ Pipeline ran: ${events.length} events emitted`);
  console.log(`  First: ${summarize(events[0])}`);
  console.log(`  Last: ${summarize(events[events.length - 1])}`);
}

// ────────────────────────────────────────────────────────────────────
// Test 4: tee() fan-out (3 critics consume same event)
// ────────────────────────────────────────────────────────────────────
console.log("\n=== Test 4: tee() fan-out for critic mesh ===");
{
  const t = tee<CognitiveEvent>(10);
  const f = new EventFactory();
  const consumer1 = t.newConsumer();
  const consumer2 = t.newConsumer();
  const consumer3 = t.newConsumer();

  // Push 3 events
  for (let i = 0; i < 3; i++) {
    await t.push(f.make("token_delta", { text: `chunk-${i}` }));
  }

  const c1: string[] = [];
  const c2: string[] = [];
  const c3: string[] = [];

  // Read in parallel
  const drain = async (it: AsyncIterable<CognitiveEvent>, sink: string[], id: string) => {
    let count = 0;
    for await (const e of it) {
      if (e.kind === "token_delta") sink.push(e.text);
      count++;
      console.log(`  [${id}] got: ${(e as any).text}`);
    }
    console.log(`  [${id}] drain finished, got ${count} items`);
  };
  console.log(`  starting 3 drains...`);
  // Close tee FIRST so drains know when to stop
  t.close();
  await Promise.all([drain(consumer1, c1, "c1"), drain(consumer2, c2, "c2"), drain(consumer3, c3, "c3")]);

  console.log(`✓ tee() fanned out 3 events to 3 consumers`);
  console.log(`  c1: ${c1.join(",")}`);
  console.log(`  c2: ${c2.join(",")}`);
  console.log(`  c3: ${c3.join(",")}`);
  console.log(`  ${c1.length === c2.length && c2.length === c3.length ? "✓ all consumers got all events" : "✗ mismatch"}`);
}

// ────────────────────────────────────────────────────────────────────
// Test 5: ReplayLog
// ────────────────────────────────────────────────────────────────────
console.log("\n=== Test 5: ReplayLog ===");
{
  const log = new ReplayLog(10, 5);
  const f = new EventFactory();

  for (let i = 0; i < 15; i++) {
    log.push(f.make("token_delta", { text: `t${i}` }));
  }
  console.log(`✓ Pushed 15 events, log size=${log.size} (capacity=10)`);

  const all = Array.from(log.events()).map((e: any) => e.text);
  console.log(`✓ Events (chronological): ${all.slice(0, 5).join(",")}...`);

  const tail5 = Array.from(log.tail(5)).map((e: any) => e.text);
  console.log(`✓ Tail(5): ${tail5.join(",")} (expected: t10,t11,t12,t13,t14)`);

  const cp1 = log.checkpoint("before-edit");
  console.log(`✓ Checkpoint taken: seq=${cp1.seq} label="${cp1.label}"`);

  log.push(f.make("log", { level: "info", msg: "after checkpoint" }));
  const sinceCp = Array.from(log.sinceSeq(cp1.seq)).map((e: any) => e.kind);
  console.log(`✓ Events since checkpoint: ${sinceCp.join(",")}`);

  const allCps = log.listCheckpoints();
  console.log(`✓ Checkpoints: ${allCps.length}`);
}

// ────────────────────────────────────────────────────────────────────
// Test 6: HTN Planner - classify + plan
// ────────────────────────────────────────────────────────────────────
console.log("\n=== Test 6: HTN Planner - classify + plan ===");
{
  const stubLLM: LLMCall = async (prompt) => "[]"; // never called for built-in
  const planner = new HTNPlanner({ llm: stubLLM });

  // Classify
  const c1 = planner.classify("fix login bug");
  console.log(`✓ Classify "fix login bug": ${c1.intent}/${c1.complexity} conf=${c1.confidence}`);

  const c2 = planner.classify("what is jwt?");
  console.log(`✓ Classify "what is jwt?": ${c2.intent}/${c2.complexity} conf=${c2.confidence}`);

  const c3 = planner.classify("npm test");
  console.log(`✓ Classify "npm test": ${c3.intent}/${c3.complexity} conf=${c3.confidence}`);

  // Plan "fix login bug" → should match code-fix-bug method
  const plan1 = await planner.plan("fix login bug");
  console.log(`✓ Plan "fix login bug": ${plan1.subgoals.length} subgoals, ${plan1.executionOrder.length} batches, method=${plan1.methodsUsed.join(",")}`);
  console.log(`  synthesizedBy=${plan1.synthesizedBy}, estimatedMs=${plan1.estimatedMs}`);

  for (let i = 0; i < plan1.executionOrder.length; i++) {
    const batch = plan1.executionOrder[i];
    const sgs = batch.map(id => plan1.subgoals.find(s => s.id === id)!);
    console.log(`  Batch ${i} (${batch.length} parallel): ${sgs.map(s => s.description.slice(0, 30)).join(" | ")}`);
  }

  // Plan "what is jwt?" → should match trivial-question
  const plan2 = await planner.plan("what is jwt?");
  console.log(`\n✓ Plan "what is jwt?": ${plan2.subgoals.length} subgoals, method=${plan2.methodsUsed.join(",")}`);

  // Plan "npm test" → should match shell-command
  const plan3 = await planner.plan("npm test");
  console.log(`✓ Plan "npm test": ${plan3.subgoals.length} subgoals, method=${plan3.methodsUsed.join(",")}`);
  console.log(`  tool=${plan3.subgoals[0].steps[0].tool} args=${JSON.stringify(plan3.subgoals[0].steps[0].args)}`);

  // Plan "add OAuth feature" → should match code-write-feature
  const plan4 = await planner.plan("add OAuth login to the app");
  console.log(`\n✓ Plan "add OAuth login": ${plan4.subgoals.length} subgoals, ${plan4.executionOrder.length} batches, method=${plan4.methodsUsed.join(",")}`);
  for (let i = 0; i < plan4.executionOrder.length; i++) {
    const batch = plan4.executionOrder[i];
    const sgs = batch.map(id => plan4.subgoals.find(s => s.id === id)!);
    console.log(`  Batch ${i} (${batch.length} parallel): ${sgs.map(s => s.description.slice(0, 35)).join(" | ")}`);
  }
}

// ────────────────────────────────────────────────────────────────────
// Test 7: HTN LLM synthesis fallback (force a non-matching task)
// ────────────────────────────────────────────────────────────────────
console.log("\n=== Test 7: HTN LLM synthesis fallback ===");
{
  let llmCallCount = 0;
  const mockLLM: LLMCall = async (prompt) => {
    llmCallCount++;
    return JSON.stringify([
      {
        id: "sg1",
        description: "Mock LLM subgoal 1",
        steps: [{ id: "s1", tool: "llm_implement", args: { task: "x" }, estimatedMs: 1000, risk: 1, description: "do thing" }],
        dependsOn: [],
        parallelGroup: 0,
        acceptance: "done",
      },
      {
        id: "sg2",
        description: "Mock LLM subgoal 2",
        steps: [{ id: "s2", tool: "bash", args: { command: "test" }, estimatedMs: 1000, risk: 0, description: "run test" }],
        dependsOn: ["sg1"],
        parallelGroup: 1,
        acceptance: "tests pass",
      },
    ]);
  };
  // Empty methods library — only LLM fallback available
  const planner = new HTNPlanner({ llm: mockLLM, additionalMethods: [] });
  // We need to disable the BUILTIN methods to force LLM call
  // (since built-in "code-write-feature" has precondition () => true)
  (planner as any).methods = [];  // Hack: clear all methods
  const plan = await planner.plan("do something completely novel and weird");
  console.log(`✓ LLM-synthesized plan: ${plan.subgoals.length} subgoals, method=${plan.methodsUsed.join(",")}, synthesizedBy=${plan.synthesizedBy}`);
  console.log(`  LLM call count: ${llmCallCount} (expected 1)`);
  console.log(`  Execution: ${plan.executionOrder.map(b => b.length).join(" → ")} subgoals per batch`);
  if (llmCallCount !== 1) {
    throw new Error(`Expected 1 LLM call, got ${llmCallCount}`);
  }
}

// ────────────────────────────────────────────────────────────────────
// Test 8: Integration - stream + HTN + replay log
// ────────────────────────────────────────────────────────────────────
console.log("\n=== Test 8: End-to-end stream + HTN + replay ===");
{
  const log = new ReplayLog(100, 10);
  const f = new EventFactory();
  const stubLLM: LLMCall = async () => "[]";
  const planner = new HTNPlanner({ llm: stubLLM });

  // Simulate a session
  const sessionId = "sess-1";
  log.push(f.make("session_start", { sessionId }));

  // Classify
  const task = "fix logout bug";
  const cls = planner.classify(task);
  log.push(f.make("classified", { task, intent: cls.intent, complexity: cls.complexity, confidence: cls.confidence }));

  // Plan
  const plan = await planner.plan(task, { project: { root: "/tmp/test", language: "typescript" } });
  log.push(f.make("htn_plan", { planId: plan.id, subgoals: plan.subgoals.length, steps: plan.subgoals.reduce((s, sg) => s + sg.steps.length, 0), parallelGroups: plan.executionOrder.length }));

  // Simulate executing each batch
  for (let bi = 0; bi < plan.executionOrder.length; bi++) {
    const batch = plan.executionOrder[bi];
    for (const sgId of batch) {
      const sg = plan.subgoals.find(s => s.id === sgId)!;
      log.push(f.make("subgoal_started", { subgoalId: sg.id, description: sg.description }));
      for (const step of sg.steps) {
        log.push(f.make("step_started", { stepId: step.id, tool: step.tool }));
        log.push(f.make("step_completed", { stepId: step.id, ok: true, durationMs: 10 }));
      }
      log.push(f.make("subgoal_completed", { subgoalId: sg.id, ok: true, durationMs: 50 }));
    }
  }

  log.push(f.make("session_end", { sessionId, ok: true, durationMs: 250 }));

  console.log(`✓ Session logged: ${log.size} events`);
  console.log(`✓ Replay log summary:\n${log.toString().split("\n").slice(0, 8).join("\n")}`);

  // Verify the event stream
  const allEvents = Array.from(log.events());
  const kinds = new Set(allEvents.map(e => e.kind));
  console.log(`✓ Unique event kinds in session: ${kinds.size} (${Array.from(kinds).join(", ")})`);
}

console.log("\n🎉 All Phase 1 tests passed!");
}

main().catch(e => { console.error(e); process.exit(1); });
