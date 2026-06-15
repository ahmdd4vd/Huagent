/**
 * v4/discipline/verify-hook.ts
 *
 * Fable 5 principle 5: "Run the real check after editing."
 *
 * Fable 5 only ran the real test 54.5% of the time after editing — this
 * is the source's biggest blind spot. The discipline layer fires the
 * verify hook on EVERY Edit/Write, so we exceed 54.5% by design.
 *
 * The verify hook:
 *   1. Receives the file that was just edited
 *   2. Determines the project's test command (auto-detect or explicit)
 *   3. Runs the command (with timeout)
 *   4. Returns a VerifyResult with pass/fail, output, duration
 *   5. Emits verify_started / verify_completed / verify_failed events
 *
 * Auto-detection rules (in order):
 *   - package.json with "test" script  → `npm test`
 *   - package.json with "scripts.test" → `npm test`
 *   - Cargo.toml                     → `cargo test`
 *   - go.mod                         → `go test ./...`
 *   - pyproject.toml with pytest     → `pytest`
 *   - Makefile with "test" target    → `make test`
 *   - Otherwise                      → skip with reason "no test command found"
 *
 * The hook can be disabled (`mode: "never"`) for cases where the project
 * genuinely has no test command, or where running it would be too slow.
 */

import { randomUUID } from "node:crypto";
import type { VerifyResult, VerifyHookConfig, GroundCheck } from "./types.js";
import { recordVerify } from "./state.js";
import type { DisciplineState } from "./types.js";
import { EventFactory } from "../stream/cognitive-event.js";

/**
 * Default executor: runs a shell command via Node's child_process.
 * Returns stdout/stderr/exitCode/durationMs.
 */
export type ShellExecutor = (command: string, cwd?: string, timeoutMs?: number) => Promise<{
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
}>;

/**
 * Default implementation: spawn a process and wait for it.
 */
export const defaultShellExec: ShellExecutor = async (command, cwd, timeoutMs = 60_000) => {
  const { spawn } = await import("node:child_process");
  const start = Date.now();
  return new Promise((resolve) => {
    const child = spawn("bash", ["-c", command], { cwd: cwd ?? process.cwd() });
    let stdout = "";
    let stderr = "";
    let killed = false;
    const timer = setTimeout(() => {
      killed = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.stdout.on("data", (b) => { stdout += b.toString(); if (stdout.length > 16_384) stdout = stdout.slice(0, 16_384); });
    child.stderr.on("data", (b) => { stderr += b.toString(); if (stderr.length > 16_384) stderr = stderr.slice(0, 16_384); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (killed) {
        resolve({ stdout, stderr: stderr + "\n[TIMEOUT]", exitCode: 124, durationMs: Date.now() - start });
      } else {
        resolve({ stdout, stderr, exitCode: code ?? 0, durationMs: Date.now() - start });
      }
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ stdout, stderr: stderr + "\n" + err.message, exitCode: 127, durationMs: Date.now() - start });
    });
  });
};

/**
 * Auto-detect the project's test command by inspecting files in the project root.
 *
 * @param projectRoot absolute path to the project root
 * @returns the command to run, or null if none found
 */
export interface AutoDetectContext {
  projectRoot: string;
  /** Optional pre-fetched file map (file path → contents) */
  files?: Record<string, string>;
  /** Optional list of filenames in the project root */
  fileNames?: string[];
}

export function autoDetectTestCommand(ctx: AutoDetectContext): { command: string; language: string } | null {
  const files = ctx.fileNames ?? (ctx.files ? Object.keys(ctx.files) : []);
  const read = (p: string): string => ctx.files?.[p] ?? "";

  // Node.js: package.json with "scripts.test"
  if (files.includes("package.json")) {
    try {
      const pkg = JSON.parse(read("package.json"));
      if (pkg.scripts?.test && typeof pkg.scripts.test === "string") {
        return { command: "npm test --silent", language: "javascript" };
      }
    } catch {
      // ignore parse error
    }
  }

  // Python: pyproject.toml with [tool.pytest]
  if (files.includes("pyproject.toml")) {
    const txt = read("pyproject.toml");
    if (/\[tool\.pytest\]/i.test(txt) || /pytest/i.test(txt)) {
      return { command: "pytest -x --tb=short -q", language: "python" };
    }
  }

  // Python: requirements.txt + tests/ folder (weak signal)
  if (files.includes("pytest.ini") || files.some((f) => f.startsWith("test_") && f.endsWith(".py"))) {
    return { command: "pytest -x --tb=short -q", language: "python" };
  }

  // Rust: Cargo.toml
  if (files.includes("Cargo.toml")) {
    return { command: "cargo test --quiet", language: "rust" };
  }

  // Go: go.mod
  if (files.includes("go.mod")) {
    return { command: "go test ./...", language: "go" };
  }

  // Makefile with "test" target
  if (files.includes("Makefile")) {
    const mk = read("Makefile");
    if (/^test:/m.test(mk)) {
      return { command: "make test", language: "make" };
    }
  }

  // TypeScript-only: tsc --noEmit
  if (files.includes("tsconfig.json") && !files.includes("package.json")) {
    return { command: "npx tsc --noEmit", language: "typescript" };
  }

  return null;
}

/**
 * Generate a verify result for an edit. Runs the test command, captures
 * output, returns a structured result, and emits events.
 *
 * The hook is **synchronous from the caller's perspective** but executes
 * the command asynchronously.
 */
export interface GenerateVerifyOptions {
  state: DisciplineState;
  filePath: string;
  /** Tool that triggered this verify (Edit, Write, MultiEdit) */
  trigger: VerifyResult["trigger"];
  /** Hook configuration */
  config: VerifyHookConfig;
  /** Project root (for command cwd) */
  projectRoot?: string;
  /** Auto-detect context (project files) */
  autoDetect?: AutoDetectContext;
  /** Optional executor override (for tests) */
  exec?: ShellExecutor;
  /** Event factory */
  events: EventFactory;
  /** Whether to run a fresh auto-detect, or use the cached one */
  forceDetect?: boolean;
}

export async function generateVerify(opts: GenerateVerifyOptions): Promise<VerifyResult> {
  const { state, filePath, trigger, config, events } = opts;
  const id = randomUUID();
  const ts = Date.now();

  // Resolve the command
  const mode = config.mode ?? "if_project_test";
  let command = "";
  let skipped = false;
  let reason: string | undefined;

  if (mode === "never") {
    skipped = true;
    reason = "verify mode is 'never'";
  } else if (config.command) {
    command = config.command;
  } else if (mode === "if_project_test" && opts.autoDetect) {
    const detected = autoDetectTestCommand(opts.autoDetect);
    if (!detected) {
      skipped = true;
      reason = "no test command auto-detected for this project";
    } else {
      command = detected.command;
    }
  } else if (mode === "always") {
    command = "echo '[verify] no command configured'";
  }

  if (skipped) {
    const result: VerifyResult = {
      id,
      filePath,
      trigger,
      command: "",
      exitCode: 0,
      output: "",
      passed: true, // skipped is treated as pass (not a failure)
      durationMs: 0,
      ts,
      skipped: true,
      reason,
    };
    recordVerify(state, result);
    events.make("verify_completed", { result });
    return result;
  }

  // Emit started event
  events.make("verify_started", { filePath, command });

  // Run
  const exec = opts.exec ?? defaultShellExec;
  const timeout = config.timeoutMs ?? 60_000;
  const t0 = Date.now();
  let exitCode = 0;
  let output = "";
  try {
    const r = await exec(command, opts.projectRoot, timeout);
    exitCode = r.exitCode;
    output = (r.stdout + (r.stderr ? "\n" + r.stderr : "")).trim();
  } catch (err: unknown) {
    exitCode = 1;
    output = (err instanceof Error ? err.message : String(err));
  }
  const durationMs = Date.now() - t0;
  const passed = exitCode === 0;

  const result: VerifyResult = {
    id,
    filePath,
    trigger,
    command,
    exitCode,
    output: output.slice(0, 4096),
    passed,
    durationMs,
    ts,
    skipped: false,
  };
  recordVerify(state, result);
  if (passed) {
    events.make("verify_completed", { result });
  } else {
    events.make("verify_failed", { result });
  }
  return result;
}

/**
 * Convenience: run a manual verify (not triggered by an edit).
 * Useful for `huagent verify` CLI command or post-task verification.
 */
export async function runManualVerify(
  state: DisciplineState,
  command: string,
  events: EventFactory,
  exec: ShellExecutor = defaultShellExec,
  cwd?: string,
  timeoutMs: number = 60_000,
): Promise<VerifyResult> {
  const id = randomUUID();
  const ts = Date.now();
  events.make("verify_started", { filePath: "(manual)", command });
  const t0 = Date.now();
  let exitCode = 0;
  let output = "";
  try {
    const r = await exec(command, cwd, timeoutMs);
    exitCode = r.exitCode;
    output = (r.stdout + (r.stderr ? "\n" + r.stderr : "")).trim();
  } catch (err) {
    exitCode = 1;
    output = err instanceof Error ? err.message : String(err);
  }
  const durationMs = Date.now() - t0;
  const result: VerifyResult = {
    id,
    filePath: "(manual)",
    trigger: "manual",
    command,
    exitCode,
    output: output.slice(0, 4096),
    passed: exitCode === 0,
    durationMs,
    ts,
    skipped: false,
  };
  recordVerify(state, result);
  if (result.passed) events.make("verify_completed", { result });
  else events.make("verify_failed", { result });
  return result;
}
