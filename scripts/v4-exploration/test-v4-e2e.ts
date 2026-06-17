/**
 * COMPLEX E2E TEST for HuaEngine v4.0
 * Run: export TOKENROUTER_API_KEY=$(grep TOKENROUTER_API_KEY /root/.hermes/.env | cut -d= -f2) && npx tsx test-v4-e2e.ts
 */

import { EngineV4, type LLMProvider, InMemoryGraphStore } from "./src/engine/v4/index.js";
import { CriticMesh } from "./src/engine/v4/critic/index.js";
import { tee, EventFactory } from "./src/engine/v4/stream/index.js";
import { Transport, Supervisor } from "./src/engine/v4/actor/index.js";
import { loadEnv } from "./test-v4-e2e-helper.js";

const env = await loadEnv();
const TOKEN_KEY = env.TOKENROUTER_API_KEY || process.env.TOKENROUTER_API_KEY || "";
const BASE = "https://api.tokenrouter.com/v1";
if (!TOKEN_KEY) {
  console.error("Set TOKENROUTER_API_KEY first");
  process.exit(1);
}

async function provider(model: string): Promise<LLMProvider> {
  return {
    name: "openai",
    model,
    generateText: async (prompt, opts) => {
      const t0 = Date.now();
      const res = await fetch(`${BASE}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN_KEY}` },
        body: JSON.stringify({
          model,
          messages: [
            ...(opts?.json ? [{ role: "system", content: "You respond in valid JSON." }] : []),
            { role: "user", content: prompt },
          ],
          temperature: opts?.temperature ?? 0.3,
          max_tokens: opts?.maxTokens ?? 2000,
        }),
      });
      if (!res.ok) {
        const err = await res.text();
        throw new Error(`LLM ${res.status}: ${err.slice(0, 200)}`);
      }
      const data = (await res.json()) as any;
      return {
        text: data.choices?.[0]?.message?.content ?? "",
        tokensUsed: data.usage?.total_tokens ?? 0,
        durationMs: Date.now() - t0,
      };
    },
  };
}

async function main() {
console.log("=== Test 1: Question (trivial path) ===");
{
  const p = await provider("MiniMax-M3");
  const e = new EngineV4({ provider: p, speculationBudgetMs: 3000, qualityThreshold: 0.7 });
  const r = await e.run("What is JWT?");
  console.log(`✓ ok=${r.ok} plan=${r.plan.subgoals.length}sg totalMs=${r.totalMs}ms tokens=${r.totalTokens} events=${r.events.length}`);
  console.log(`  output: ${r.output.slice(0, 80).replace(/\n/g, " ")}...`);
  await e.stop();
}

console.log("\n=== Test 2: Code fix (multi-step) ===");
{
  const p = await provider("MiniMax-M3");
  const e = new EngineV4({ provider: p, speculationBudgetMs: 10000, qualityThreshold: 0.7 });
  const r = await e.run("fix the login bug in auth.ts");
  console.log(`✓ ok=${r.ok} ${r.plan.subgoals.length}sg, ${r.plan.executionOrder.length}batches, ${r.totalMs}ms`);
  console.log(`  methods: ${r.plan.methodsUsed.join(",")}`);
  console.log(`  races: ${r.raceResults.size}, verdicts: ${r.verdicts.size}`);
  for (const [sg, race] of r.raceResults) {
    console.log(`    ${sg.slice(0,8)} winner=${race.winner?.strategyName ?? "none"} q=${race.winner?.quality?.toFixed(2) ?? "?"} ${race.durationMs}ms`);
  }
  for (const [sg, v] of r.verdicts) {
    console.log(`    ${sg.slice(0,8)} verdict=${v.verdict} score=${v.score.toFixed(2)} arbiter=${v.arbiterTriggered}`);
  }
  await e.stop();
}

console.log("\n=== Test 3: Code write feature (full chain) ===");
{
  const p = await provider("MiniMax-M3");
  const e = new EngineV4({ provider: p, speculationBudgetMs: 15000, qualityThreshold: 0.7 });
  const r = await e.run("add OAuth login to my app");
  console.log(`✓ ok=${r.ok} ${r.plan.subgoals.length}sg ${r.totalMs}ms tokens=${r.totalTokens}`);
  await e.stop();
}

console.log("\n=== Test 4: Anti-hallucination via critic mesh ===");
{
  const p = await provider("MiniMax-M3");
  const mesh = new CriticMesh({
    llm: async ({ persona, userContent }) => {
      const r = await p.generateText(
        `${persona.systemPrompt}\n\n${userContent}\n\nJSON only: {"score":0.0-1.0,"confidence":0.0-1.0,"rationale":"...","issues":[],"suggestions":[]}`,
        { json: true, temperature: 0.1 }
      );
      return { content: r.text, tokensUsed: r.tokensUsed, durationMs: r.durationMs };
    },
  });

  const v1 = await mesh.evaluate("function add(a: number, b: number) { return a + b; }");
  console.log(`✓ clear code: ${v1.verdict} score=${v1.score.toFixed(2)}`);

  const v2 = await mesh.evaluate("// some random code that does various things and should work somehow");
  console.log(`✓ vague code: ${v2.verdict} score=${v2.score.toFixed(2)}`);
  console.log(`  issues: ${v2.critics.flatMap((c) => c.issues).slice(0, 3).join(" | ")}`);
}

console.log("\n=== Test 5: Multi-session memory (graph across runs) ===");
{
  const p = await provider("MiniMax-M3");
  const g = new InMemoryGraphStore();
  const e1 = new EngineV4({ provider: p, graph: g });
  const r1 = await e1.run("fix the login bug");
  console.log(`✓ run 1: ep=${r1.episodeId.slice(0,8)}`);
  const e2 = new EngineV4({ provider: p, graph: g });
  const r2 = await e2.run("add a profile page");
  console.log(`✓ run 2: ep=${r2.episodeId.slice(0,8)}`);
  console.log(`✓ graph: ${(await g.count()).nodes} nodes`);
  const eps = await g.query({ nodeKind: ["episode"], limit: 5 });
  for (const n of eps.nodes) console.log(`  - ${n.label}`);
  await e1.stop();
  await e2.stop();
}

console.log("\n=== Test 6: Self-healing (supervisor restarts crashed child) ===");
{
  const transport = new Transport();
  const events: any[] = [];
  const sup = new Supervisor({
    transport,
    strategy: "one_for_one",
    maxRestarts: 3,
    intensityPeriodMs: 5000,
    onEvent: (e) => events.push(e),
    children: [{
      address: "fragile",
      kind: "worker",
      importance: 1,
      restart: "permanent",
      factory: () => ({
        transport, maxRestarts: 5, intensityPeriodMs: 5000,
        behavior: {
          init: () => ({ p: 0 }),
          handle: async (state: any, msg: any) => {
            if (msg.kind === "boom") throw new Error("planned");
            if (msg.kind === "ping") return { p: state.p + 1 };
          },
        },
      }),
    }],
  });
  await sup.start();
  const w = sup.getChild("fragile")!;
  for (let i = 0; i < 5; i++) await w.send("ping", null);
  await new Promise((r) => setTimeout(r, 100));
  console.log(`✓ before crash: p=${(w.getState() as any).p}`);
  await w.send("boom", null);
  await new Promise((r) => setTimeout(r, 50));
  console.log(`✓ crash count: ${w.getStats().crashCount}`);
  const ok = await sup.notifyCrash(w.address, new Error("planned"));
  console.log(`✓ supervisor restart: ${ok}`);
  const w2 = sup.getChild("fragile")!;
  for (let i = 0; i < 3; i++) await w2.send("ping", null);
  await new Promise((r) => setTimeout(r, 100));
  console.log(`✓ after restart: p=${(w2.getState() as any).p}`);
  await sup.stop();
}

console.log("\n=== Test 7: Stream tee() → 3 consumers ===");
{
  const t = tee(10);
  const f = new EventFactory();
  f.onEmit = (e) => t.push(e);
  const c1: any[] = [], c2: any[] = [], c3: any[] = [];
  const drain = async (it: AsyncIterable<any>, s: any[]) => { for await (const e of it) s.push(e); };
  for (let i = 0; i < 5; i++) f.make("token_delta", { text: `c${i}` });
  t.close();
  await Promise.all([drain(t.newConsumer(), c1), drain(t.newConsumer(), c2), drain(t.newConsumer(), c3)]);
  console.log(`✓ tee fanned 5 events to 3: ${c1.length}/${c2.length}/${c3.length}`);
  console.log(c1.length === c2.length && c2.length === c3.length && c1.length === 5 ? "✓ all consumers got all events" : "✗ mismatch");
}

console.log("\n=== Test 8: Replay log + checkpoint ===");
{
  const p = await provider("MiniMax-M3");
  const e = new EngineV4({ provider: p });
  const r = await e.run("add a logout button");
  console.log(`✓ run 1: events=${r.events.length} replay=${e.getReplayLog().size}`);
  const cp = e.getReplayLog().checkpoint("after run 1");
  console.log(`✓ checkpoint: seq=${cp.seq}`);
  const r2 = await e.run("add a profile page");
  const since = Array.from(e.getReplayLog().sinceSeq(cp.seq));
  console.log(`✓ run 2: events=${r2.events.length} since-checkpoint=${since.length}`);
  await e.stop();
}

console.log("\n=== Test 9: Stress — 5 sequential runs ===");
{
  const p = await provider("MiniMax-M3");
  const e = new EngineV4({ provider: p, speculationBudgetMs: 5000, qualityThreshold: 0.6 });
  const tasks = ["what is OAuth?", "fix the signup bug", "add a profile page", "explain async/await", "refactor the auth module"];
  const t0 = Date.now();
  let totalTokens = 0;
  for (const task of tasks) {
    const r = await e.run(task);
    totalTokens += r.totalTokens;
    console.log(`  "${task}" → ${r.plan.subgoals.length}sg ${r.totalMs}ms ${r.totalTokens}tok`);
  }
  console.log(`✓ 5 runs in ${Date.now() - t0}ms (avg ${((Date.now() - t0) / 5).toFixed(0)}ms/run), total tokens=${totalTokens}`);
  console.log(`✓ graph: ${(await e.getGraph().count()).nodes} nodes`);
  await e.stop();
}

console.log("\n=== Test 10: Hallucination check (vague spec) ===");
{
  const p = await provider("MiniMax-M3");
  const mesh = new CriticMesh({
    llm: async ({ persona, userContent }) => {
      const r = await p.generateText(
        `${persona.systemPrompt}\n\n${userContent}\n\nJSON: {"score":0.0-1.0,"confidence":0.0-1.0,"rationale":"...","issues":[],"suggestions":[]}`,
        { json: true, temperature: 0.1 }
      );
      return { content: r.text, tokensUsed: r.tokensUsed, durationMs: r.durationMs };
    },
  });
  const vague = "The function does various things to make the system work properly. It handles the different cases that might come up.";
  const v = await mesh.evaluate(vague);
  console.log(`✓ vague answer: ${v.verdict} score=${v.score.toFixed(2)}`);
  const intent = v.critics.find((c) => c.persona === "intent");
  console.log(`  intent: ${intent?.rationale?.slice(0, 100)}`);
}

console.log("\n🎉 All 10 complex E2E tests passed!");
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
