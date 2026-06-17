#!/usr/bin/env tsx
/**
 * test-discipline.ts — Test the Discipline Layer (Fable-5 mindset)
 *
 * 50+ test cases across 8 modules. No external deps. Run with `tsx`.
 */
import {
  // types
  type PlanBeat,
  type ObserveBeat,
  type VerifyResult,
  type Diagnosis,
  type GroundBeat,
  type ErrorCategory,
  isDisciplineEvent,
  // state
  createDisciplineState,
  markFileRead,
  markFilesRead,
  checkFreshRead,
  DEFAULT_FRESH_READ_TTL_MS,
  recordPlanBeat,
  recordObserveBeat,
  recordGroundBeat,
  recordVerify,
  recordDiagnosis,
  resetDisciplineState,
  computeDisciplineMetrics,
  snapshotDisciplineState,
  normalizePath,
  // plan-beat
  generatePlanBeat,
  generatePlanBeatFromSubgoal,
  generatePlanBeatWithLLM,
  // observe-beat
  generateObserveBeat,
  generateObserveBeatWithLLM,
  summarizeResult,
  matchesHypothesis,
  // verify-hook
  generateVerify,
  runManualVerify,
  autoDetectTestCommand,
  type ShellExecutor,
  // diagnose-beat
  generateDiagnosis,
  generateDiagnosisWithLLM,
  classifyError,
  extractEvidence,
  CATEGORY_HYPOTHESES,
  CATEGORY_ACTIONS,
  CATEGORY_RETRYABLE,
  // ground-beat
  generateGroundBeat,
  generateGroundBeatSync,
  buildDefaultGroundChecks,
  runGroundCheck,
  // manager + engine
  DisciplineManager,
  EngineV4,
  type LLMProvider,
} from "../src/engine/v4/index.js";
import { EventFactory, type CognitiveEvent } from "../src/engine/v4/stream/cognitive-event.js";

let pass = 0;
let fail = 0;

function test(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ': ' + detail : ''}`); }
}

function section(name: string) {
  console.log(`\n── ${name} ──`);
}

// Stub LLM provider for tests
function makeStubProvider(): LLMProvider {
  return {
    name: "stub",
    model: "stub-model",
    async generateText() {
      return { text: '{"ok": true}', tokensUsed: 10, durationMs: 1 };
    },
  };
}

async function main() {

// ─── 1. state.ts tests ──────────────────────────────────────────
section("1. state.ts — DisciplineState");
{
  const s = createDisciplineState();
  test("createDisciplineState returns empty state", s.fileReadAt.size === 0 && s.planBeats.length === 0);

  markFileRead(s, "src/foo.ts");
  markFileRead(s, "src/bar.ts", 1000);
  test("markFileRead adds entries", s.fileReadAt.size === 2);
  test("markFileRead respects timestamp", s.fileReadAt.get("src/bar.ts") === 1000);

  markFilesRead(s, ["a.ts", "b.ts", "c.ts"]);
  test("markFilesRead adds multiple", s.fileReadAt.size === 5);

  const now = Date.now();
  markFileRead(s, "fresh.ts", now);
  const check1 = checkFreshRead(s, "fresh.ts", 60_000, now + 1000);
  test("fresh read passes TTL", check1.ok);
  test("fresh read has lastReadAt", check1.lastReadAt === now);

  markFileRead(s, "stale.ts", now - 120_000);
  const check2 = checkFreshRead(s, "stale.ts", 60_000, now);
  test("stale read fails TTL", !check2.ok);
  test("stale read reason present", !!check2.reason && check2.reason.includes("TTL"));

  const check3 = checkFreshRead(s, "never-read.ts", 60_000, now);
  test("never-read fails with reason", !check3.ok && check3.lastReadAt === null);

  markFileRead(s, "future.ts", now + 60_000);
  const check4 = checkFreshRead(s, "future.ts", 60_000, now);
  test("clock skew (future read) treated as fresh", check4.ok);

  test("normalizePath strips ./", normalizePath("./foo/bar") === "foo/bar");
  test("normalizePath collapses slashes", normalizePath("foo//bar") === "foo/bar");
  test("normalizePath keeps absolute", normalizePath("/foo/bar") === "/foo/bar");

  const pb: PlanBeat = { id: "p1", goal: "g", hypothesis: "h", plan: [], rationale: "r", risks: [], acceptance: "a", ts: now };
  recordPlanBeat(s, pb);
  test("recordPlanBeat adds to history", s.planBeats.length === 1);

  const ob: ObserveBeat = { id: "o1", tool: "Read", summary: "s", matchesHypothesis: true, newInfo: [], decision: "continue", ts: now };
  recordObserveBeat(s, ob);
  test("recordObserveBeat adds to history", s.observeBeats.length === 1);

  const gb: GroundBeat = { id: "g1", task: "t", checks: [], ts: now, totalDurationMs: 0 };
  recordGroundBeat(s, gb);
  test("recordGroundBeat sets currentTask", s.currentTask === "t" && s.groundBeats.length === 1);

  const vr: VerifyResult = { id: "v1", filePath: "f.ts", trigger: "Edit", command: "", exitCode: 0, output: "", passed: true, durationMs: 0, ts: now, skipped: true };
  recordVerify(s, vr);
  test("recordVerify adds to history", s.verifies.length === 1);

  const dx: Diagnosis = { id: "d1", tool: "Bash", error: "e", category: "logic", evidence: [], hypotheses: [], recommendedAction: "ra", isRetryable: false, ts: now };
  recordDiagnosis(s, dx);
  test("recordDiagnosis sets lastErroredTool", s.lastErroredTool === "Bash" && s.lastError === "e");

  const m = computeDisciplineMetrics(s);
  test("metrics has reasoning coverage", typeof m.reasoningCoverage === "number" && m.reasoningCoverage > 0);
  test("metrics has diagnose rate", typeof m.diagnoseRate === "number");

  const snap = snapshotDisciplineState(s);
  // fileReadAt has "src/foo.ts", "src/bar.ts", "a.ts", "b.ts", "c.ts", "fresh.ts", "stale.ts", "never-read.ts" (no, only the ones we marked)
  test("snapshot serializes fileReadAt to object", typeof snap.filesRead === "object" && "src/foo.ts" in snap.filesRead);
  test("snapshot copies planBeats", snap.planBeats.length === 1);

  resetDisciplineState(s);
  test("reset clears planBeats", s.planBeats.length === 0);
  test("reset clears fileReadAt", s.fileReadAt.size === 0);
  test("reset clears currentTask", s.currentTask === null);
  test("DEFAULT_FRESH_READ_TTL_MS is 5 min", DEFAULT_FRESH_READ_TTL_MS === 5 * 60 * 1000);
}

// ─── 2. plan-beat.ts tests ──────────────────────────────────────
section("2. plan-beat.ts — Plan beats");
{
  const s = createDisciplineState();
  const ev = new EventFactory();
  const pb = generatePlanBeat({
    state: s,
    context: { goal: "Fix the auth bug", hypothesis: "JWT token has wrong expiry" },
    events: ev,
    subgoalId: "sg-1",
  });
  test("plan beat has goal", pb.goal === "Fix the auth bug");
  test("plan beat has hypothesis", pb.hypothesis.includes("JWT token"));
  test("plan beat has ts", typeof pb.ts === "number");
  test("plan beat has subgoalId", pb.subgoalId === "sg-1");
  test("plan beat recorded in state", s.planBeats.length === 1);

  const pb2 = generatePlanBeatFromSubgoal(s, {
    id: "sg-2",
    description: "Refactor auth module",
    steps: [
      { id: "s1", tool: "Read", description: "read auth.ts" },
      { id: "s2", tool: "Edit", description: "fix bug" },
      { id: "s3", tool: "Bash", description: "run tests" },
    ],
    acceptance: "all tests pass",
    risk: 2,
  }, ev);
  test("plan-from-subgoal has 3 steps", pb2.plan.length === 3);
  test("plan-from-subgoal has risks", pb2.risks.length > 0);
  test("plan-from-subgoal triggers edit risk", pb2.risks.some((r) => r.includes("verify")));

  const llmPb = await generatePlanBeatWithLLM({
    state: s,
    context: { goal: "Add a feature" },
    events: ev,
    llmNarrate: async () => JSON.stringify({
      goal: "Add login feature",
      hypothesis: "We can extend the auth module",
      plan: ["read auth.ts", "add login route", "add tests"],
      rationale: "follows existing patterns",
      risks: ["breaks existing users"],
      acceptance: "tests pass",
    }),
  });
  test("LLM plan beat uses LLM goal", llmPb.goal === "Add login feature");
  test("LLM plan beat has LLM hypothesis", llmPb.hypothesis.includes("auth module"));
  test("LLM plan beat has 3 steps from LLM", llmPb.plan.length === 3);

  const llmFail = await generatePlanBeatWithLLM({
    state: s,
    context: { goal: "Test fallback" },
    events: ev,
    llmNarrate: async () => "not json at all",
  });
  test("LLM failure falls back", llmFail.goal === "Test fallback");
}

// ─── 3. observe-beat.ts tests ───────────────────────────────────
section("3. observe-beat.ts — Observe beats");
{
  test("summarizeResult on null", summarizeResult("Read", null).includes("no result"));
  test("summarizeResult on string", summarizeResult("Read", "hello world").includes("11 chars"));
  test("summarizeResult on array", summarizeResult("ls", [1, 2, 3]).includes("3 items"));
  test("summarizeResult on empty array", summarizeResult("ls", []).includes("empty"));
  test("summarizeResult on object with exitCode", summarizeResult("Bash", { stdout: "ok", exitCode: 0 }).includes("exit=0"));
  test("summarizeResult on empty object", summarizeResult("noop", {}).includes("empty"));
  test("summarizeResult on number", summarizeResult("count", 42).includes("42"));
  test("summarizeResult on boolean", summarizeResult("flag", true).includes("true"));

  test("matchesHypothesis: null = false", !matchesHypothesis("Read", null));
  test("matchesHypothesis: empty string = false", !matchesHypothesis("Read", ""));
  test("matchesHypothesis: exitCode 0 = true", matchesHypothesis("Bash", { exitCode: 0, stdout: "ok" }));
  test("matchesHypothesis: exitCode 1 = false", !matchesHypothesis("Bash", { exitCode: 1 }));
  test("matchesHypothesis: isError = false", !matchesHypothesis("Read", { isError: true }));
  test("matchesHypothesis: ENOENT = false", !matchesHypothesis("Read", "ENOENT: no such file"));
  test("matchesHypothesis: normal text = true", matchesHypothesis("Read", "file contents here"));

  const s = createDisciplineState();
  const ev = new EventFactory();
  const ob = generateObserveBeat({
    state: s,
    tool: "Read",
    result: "file content here, plenty of chars",
    events: ev,
  });
  // summarizeResult says "Read returned 32 chars of text." — verify it returned something useful
  test("observe beat has summary", ob.summary.length > 0 && ob.summary.includes("Read"));
  test("observe beat matches by default", ob.matchesHypothesis);
  test("observe beat decision is continue", ob.decision === "continue");

  const ob2 = generateObserveBeat({
    state: s,
    tool: "Bash",
    result: { exitCode: 1, stderr: "error" },
    events: ev,
    planBeat: { id: "pb-1", goal: "g", hypothesis: "will succeed", plan: [], rationale: "r", risks: [], acceptance: "a", ts: Date.now() },
  });
  test("observe beat detects mismatch", !ob2.matchesHypothesis);
  test("observe beat decision is adjust on mismatch", ob2.decision === "adjust");
  test("observe beat has adjustments", (ob2.adjustments?.length ?? 0) > 0);

  const ob3 = generateObserveBeat({
    state: s,
    tool: "Bash",
    result: "ok",
    events: ev,
    decision: "abort",
    summary: "manual abort",
  });
  test("observe beat respects manual decision", ob3.decision === "abort");

  const ob4 = await generateObserveBeatWithLLM({
    state: s,
    tool: "Read",
    result: "some content",
    events: ev,
    llmNarrate: async () => JSON.stringify({
      summary: "Found 3 lines",
      matchesHypothesis: false,
      newInfo: ["file exists", "has 3 lines"],
      decision: "adjust",
      adjustments: ["read more lines"],
    }),
  });
  test("LLM observe beat uses LLM summary", ob4.summary === "Found 3 lines");
  test("LLM observe beat uses LLM newInfo", ob4.newInfo.length === 2);
  test("LLM observe beat uses LLM decision", ob4.decision === "adjust");
}

// ─── 4. verify-hook.ts tests ────────────────────────────────────
section("4. verify-hook.ts — Verify hook");
{
  test("autoDetect: package.json with test script", autoDetectTestCommand({
    projectRoot: "/tmp",
    fileNames: ["package.json"],
    files: { "package.json": JSON.stringify({ scripts: { test: "jest" } }) },
  })?.command.includes("npm test"));

  test("autoDetect: pyproject.toml with pytest", autoDetectTestCommand({
    projectRoot: "/tmp",
    fileNames: ["pyproject.toml"],
    files: { "pyproject.toml": "[tool.pytest]\ntestpaths = [\"tests\"]" },
  })?.command.includes("pytest"));

  test("autoDetect: Cargo.toml", autoDetectTestCommand({
    projectRoot: "/tmp",
    fileNames: ["Cargo.toml"],
  })?.command.includes("cargo test"));

  test("autoDetect: go.mod", autoDetectTestCommand({
    projectRoot: "/tmp",
    fileNames: ["go.mod"],
  })?.command.includes("go test"));

  test("autoDetect: Makefile with test target", autoDetectTestCommand({
    projectRoot: "/tmp",
    fileNames: ["Makefile"],
    files: { Makefile: "test:\n\techo hi" },
  })?.command.includes("make test"));

  test("autoDetect: tsconfig.json only", autoDetectTestCommand({
    projectRoot: "/tmp",
    fileNames: ["tsconfig.json"],
  })?.command.includes("tsc"));

  test("autoDetect: nothing matches returns null", autoDetectTestCommand({
    projectRoot: "/tmp",
    fileNames: ["random.txt"],
  }) === null);

  const s = createDisciplineState();
  const ev = new EventFactory();
  const v1 = await generateVerify({
    state: s,
    filePath: "f.ts",
    trigger: "Edit",
    config: { mode: "never" },
    events: ev,
  });
  test("verify mode=never is skipped", v1.skipped);
  test("verify skipped reason", v1.reason?.includes("never"));

  const mockExec: ShellExecutor = async () => ({
    stdout: "all tests pass",
    stderr: "",
    exitCode: 0,
    durationMs: 10,
  });
  const v2 = await generateVerify({
    state: s,
    filePath: "f.ts",
    trigger: "Edit",
    config: { command: "echo pass", mode: "always" },
    events: ev,
    exec: mockExec,
  });
  test("verify pass=true", v2.passed);
  test("verify exitCode=0", v2.exitCode === 0);
  test("verify has output", v2.output === "all tests pass");

  const mockFailExec: ShellExecutor = async () => ({
    stdout: "",
    stderr: "TypeError: foo is not a function",
    exitCode: 1,
    durationMs: 5,
  });
  const v3 = await generateVerify({
    state: s,
    filePath: "f.ts",
    trigger: "Edit",
    config: { command: "bad", mode: "always" },
    events: ev,
    exec: mockFailExec,
  });
  test("verify fail=false", !v3.passed);
  test("verify exitCode=1", v3.exitCode === 1);

  const v4 = await runManualVerify(s, "echo hi", ev, mockExec);
  test("manual verify works", v4.passed && v4.trigger === "manual");
}

// ─── 5. diagnose-beat.ts tests ──────────────────────────────────
section("5. diagnose-beat.ts — Diagnose");
{
  test("classifyError: ETIMEDOUT = transient", classifyError("connect ETIMEDOUT") === "transient");
  test("classifyError: 429 = transient", classifyError("429 too many requests") === "transient");
  test("classifyError: SyntaxError = syntax", classifyError("SyntaxError: unexpected token") === "syntax");
  test("classifyError: TS2322 = syntax", classifyError("error TS2322: cannot assign") === "syntax");
  test("classifyError: AssertionError = test", classifyError("AssertionError: expected 1 to equal 2") === "test");
  test("classifyError: ENOENT = logic", classifyError("ENOENT: no such file") === "logic");
  test("classifyError: EACCES = config", classifyError("EACCES: permission denied") === "config");
  test("classifyError: command not found = config", classifyError("bash: foo: command not found") === "config");
  test("classifyError: ENOSPC = environment", classifyError("ENOSPC: no space left") === "environment");
  test("classifyError: ENOMEM = environment", classifyError("ENOMEM: out of memory") === "environment");
  test("classifyError: Module not found = config", classifyError("Cannot find module 'foo'") === "config");
  test("classifyError: unknown = unknown", classifyError("mystery error") === "unknown");

  for (const cat of ["transient", "logic", "config", "environment", "test", "syntax", "unknown"] as ErrorCategory[]) {
    test(`category ${cat} has hypotheses`, CATEGORY_HYPOTHESES[cat].length > 0);
    test(`category ${cat} has action`, CATEGORY_ACTIONS[cat].length > 0);
    test(`category ${cat} has retryable flag`, typeof CATEGORY_RETRYABLE[cat] === "boolean");
  }
  test("transient is retryable", CATEGORY_RETRYABLE.transient);
  test("logic is not retryable", !CATEGORY_RETRYABLE.logic);
  test("syntax is not retryable", !CATEGORY_RETRYABLE.syntax);

  test("extractEvidence: 1-line error", extractEvidence("error: foo").length === 1);
  test("extractEvidence: 3-line error", extractEvidence("a\nb\nc").length === 3);
  test("extractEvidence: empty error", extractEvidence("").length === 0);
  test("extractEvidence: 5-line error returns 3", extractEvidence("a\nb\nc\nd\ne").length === 3);
  test("extractEvidence: truncates long lines", extractEvidence("x".repeat(300)).every((l) => l.length <= 200));

  const s = createDisciplineState();
  const ev = new EventFactory();
  const dx = generateDiagnosis({
    state: s,
    tool: "Bash",
    error: "ENOENT: no such file",
    events: ev,
  });
  test("diagnosis classifies ENOENT as logic", dx.category === "logic");
  test("diagnosis has 3 hypotheses", dx.hypotheses.length === 3);
  test("diagnosis has recommended action", dx.recommendedAction.length > 0);
  test("diagnosis isRetryable=false for logic", !dx.isRetryable);
  test("diagnosis error truncated to 2048", dx.error.length <= 2048);

  const dx2 = generateDiagnosis({
    state: s,
    tool: "Bash",
    error: "anything",
    events: ev,
    category: "transient",
    isRetryable: true,
    recommendedAction: "just retry",
    hypotheses: ["only this one"],
  });
  test("diagnosis override works", dx2.category === "transient" && dx2.isRetryable && dx2.hypotheses.length === 1);

  const dx3 = await generateDiagnosisWithLLM({
    state: s,
    tool: "Bash",
    error: "TypeError: undefined",
    events: ev,
    llmNarrate: async () => JSON.stringify({
      category: "logic",
      hypotheses: ["null reference", "wrong arg order"],
      recommendedAction: "check the input",
      isRetryable: false,
    }),
  });
  test("LLM diagnosis uses LLM category", dx3.category === "logic");
  test("LLM diagnosis uses LLM hypotheses", dx3.hypotheses.includes("null reference"));
  test("LLM diagnosis uses LLM action", dx3.recommendedAction === "check the input");
}

// ─── 6. ground-beat.ts tests ────────────────────────────────────
section("6. ground-beat.ts — Ground");
{
  const checks = buildDefaultGroundChecks({ task: "test", projectRoot: "/tmp" });
  test("default checks include git_status", checks.some((c) => c.label === "git_status"));
  test("default checks include ls_root", checks.some((c) => c.label === "ls_root"));
  test("default checks include package_json", checks.some((c) => c.label === "package_json"));

  const noGitChecks = buildDefaultGroundChecks({ task: "test", projectRoot: "/tmp", hasGit: false });
  test("hasGit=false skips git_status", !noGitChecks.some((c) => c.label === "git_status"));

  const cappedChecks = buildDefaultGroundChecks({ task: "test", projectRoot: "/tmp", maxChecks: 2 });
  test("maxChecks caps the list", cappedChecks.length === 2);

  const mockExec: ShellExecutor = async () => ({ stdout: "M foo.ts", stderr: "", exitCode: 0, durationMs: 5 });
  const check = await runGroundCheck("git_status", "git status", "/tmp", mockExec);
  test("ground check has command", check.command === "git status");
  test("ground check has label", check.label === "git_status");
  test("ground check has output", check.output === "M foo.ts");
  test("ground check has exitCode", check.exitCode === 0);

  const longExec: ShellExecutor = async () => ({ stdout: "x".repeat(10_000), stderr: "", exitCode: 0, durationMs: 5 });
  const longCheck = await runGroundCheck("test", "echo x", "/tmp", longExec);
  test("ground check truncates long output", longCheck.output.length < 10_000 && longCheck.output.includes("truncated"));

  const s = createDisciplineState();
  const ev = new EventFactory();
  const beat = generateGroundBeatSync({ state: s, context: { task: "t", projectRoot: "/tmp" }, events: ev });
  test("sync ground beat has checks", beat.checks.length > 0);
  test("sync ground beat has task", beat.task === "t");
  test("sync ground beat recorded", s.groundBeats.length === 1);
  test("sync ground beat sets currentTask", s.currentTask === "t");

  const beat2 = await generateGroundBeat({ state: s, context: { task: "t2", projectRoot: "/tmp", exec: mockExec }, events: ev });
  test("async ground beat runs", beat2.totalDurationMs >= 0);
  test("async ground beat has checks", beat2.checks.length > 0);
  test("async ground beat sets new task", s.currentTask === "t2");
}

// ─── 7. manager.ts tests ────────────────────────────────────────
section("7. manager.ts — DisciplineManager");
{
  const events: CognitiveEvent[] = [];
  const ev = new EventFactory();
  ev.onEmit = (e) => events.push(e);

  const mockExec: ShellExecutor = async () => ({ stdout: "ok", stderr: "", exitCode: 0, durationMs: 1 });

  const mgr = new DisciplineManager({
    config: {
      planBeat: true,
      observeBeat: true,
      groundBeat: true,
      verifyHook: true,
      diagnoseBeat: true,
      freshReadCheck: true,
      exec: mockExec,  // inject for tests
    },
    events: ev,
  });

  test("manager has state", mgr.getState().planBeats.length === 0);
  test("manager has metrics", typeof mgr.metrics().reasoningCoverage === "number");

  const pb = mgr.plan({ goal: "do thing", hypothesis: "hypothesis text" }, { subgoalId: "sg-1" });
  test("manager.plan returns beat", pb.goal === "do thing");
  test("manager.plan emits plan_beat event", events.some((e) => e.kind === "plan_beat"));
  test("manager.plan records in state", mgr.getState().planBeats.length === 1);

  mgr.planFromSubgoal({
    id: "sg-2",
    description: "subgoal",
    steps: [{ id: "s1", tool: "Read" }],
  });
  test("manager.planFromSubgoal records", mgr.getState().planBeats.length === 2);

  const ob = mgr.observe("Read", "file content", { planBeat: pb });
  test("manager.observe returns beat", ob.tool === "Read");
  test("manager.observe emits observe_beat event", events.some((e) => e.kind === "observe_beat"));
  test("manager.observe records in state", mgr.getState().observeBeats.length === 1);

  mgr.markFileRead("src/foo.ts");
  const check = mgr.checkFreshRead("src/foo.ts");
  test("markFileRead + checkFreshRead", check.ok);

  mgr.markFileRead("stale.ts", Date.now() - 10 * 60 * 1000);
  const staleCheck = mgr.checkFreshRead("stale.ts");
  test("stale check fails after 10 min (TTL 5 min default)", !staleCheck.ok);

  const dx = mgr.diagnose("Bash", "ENOENT: no such file");
  test("manager.diagnose returns diagnosis", dx.category === "logic");
  test("manager.diagnose emits events", events.filter((e) => e.kind === "diagnose_started" || e.kind === "diagnose_completed").length === 2);

  // mgr has mockExec injected, so verify will use it
  const vr = await mgr.verify("f.ts", "Edit", { autoDetect: { projectRoot: "/tmp" } });
  test("manager.verify returns result", vr.filePath === "f.ts");
  test("manager.verify passes with mock exec", vr.passed);

  const mgr2 = new DisciplineManager({
    config: { planBeat: false, observeBeat: false, diagnoseBeat: false, verifyHook: false, groundBeat: false, freshReadCheck: false },
    events: ev,
  });
  mgr2.plan({ goal: "x" });
  mgr2.observe("Read", "y");
  mgr2.diagnose("Bash", "z");
  test("disabled plan still records", mgr2.getState().planBeats.length === 1);
  test("disabled observe still records", mgr2.getState().observeBeats.length === 1);
  test("disabled diagnose still records", mgr2.getState().diagnoses.length === 1);

  const vr2 = await mgr2.verify("f.ts", "Edit");
  test("disabled verify is skipped", vr2.skipped && vr2.reason === "verifyHook disabled");

  mgr.reset();
  test("manager.reset clears state", mgr.getState().planBeats.length === 0);
  test("manager.reset clears fileReadAt", mgr.getState().fileReadAt.size === 0);
}

// ─── 8. EngineV4 integration ────────────────────────────────────
section("8. EngineV4 integration with discipline layer");
{
  const engine = new EngineV4({
    provider: makeStubProvider(),
    discipline: {},
    projectRoot: "/tmp",
  });

  test("engine has discipline", engine.getDiscipline() !== undefined);
  test("engine without discipline returns undefined", new EngineV4({ provider: makeStubProvider() }).getDiscipline() === undefined);

  const result = await engine.run("Fix the bug");
  test("engine.run produces events", result.events.length > 0);
  test("engine.run result has plan", result.plan.subgoals.length >= 0);

  // Events come from the engine's internal eventFactory, captured in result.events
  const eventKinds = new Set(result.events.map((e) => e.kind));
  test("discipline emitted ground_beat", eventKinds.has("ground_beat"));
  test("discipline emitted plan_beat", eventKinds.has("plan_beat"));
  test("discipline emitted observe_beat", eventKinds.has("observe_beat"));
  test("engine emitted classified (HTN)", eventKinds.has("classified"));
  test("engine emitted htn_plan (HTN)", eventKinds.has("htn_plan"));
  test("engine emitted session_start + session_end", eventKinds.has("session_start") && eventKinds.has("session_end"));

  const planBeatEvent = result.events.find((e) => e.kind === "plan_beat");
  if (planBeatEvent) {
    test("isDisciplineEvent works", isDisciplineEvent(planBeatEvent));
    // The plan_beat should have goal/hypothesis
    if (planBeatEvent.kind === "plan_beat") {
      test("plan_beat has goal", planBeatEvent.beat.goal.length > 0);
      test("plan_beat has hypothesis", planBeatEvent.beat.hypothesis.length > 0);
    }
  } else {
    test("isDisciplineEvent works (no plan_beat in this run)", true);
  }
}

// ─── 9. CognitiveEvent type guards ──────────────────────────────
section("9. CognitiveEvent type guards");
{
  const ev = new EventFactory();
  const pb: PlanBeat = { id: "p", goal: "g", hypothesis: "h", plan: [], rationale: "r", risks: [], acceptance: "a", ts: 0 };
  const e1 = ev.make("plan_beat", { beat: pb });
  test("isDisciplineEvent on plan_beat", isDisciplineEvent(e1));

  const e2 = ev.make("session_start", { sessionId: "s" });
  test("isDisciplineEvent on session_start is false", !isDisciplineEvent(e2));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);

}

main().catch((err) => {
  console.error("Test runner crashed:", err);
  process.exit(2);
});
