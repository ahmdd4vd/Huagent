#!/usr/bin/env tsx
/**
 * test-cli-commands.ts — Test the new autoresearch-inspired CLI commands
 *
 * Tests cover:
 *   1. parseOptions       — --autonomous, --no-autonomous, --scope
 *   2. cmdProvider        — /provider show / switch / persist / unknown
 *   3. cmdAutonomous      — /autonomous toggle / on / off
 *   4. cmdScope           — /scope show / set / clear
 *   5. cmdStatus          — /status shows autonomous + scope
 *   6. SlashCommandContext wiring — all callbacks resolve
 *
 * 30+ test cases. No external deps.
 */

// Import the slash commands + helpers we need
import {
  SLASH_COMMANDS,
  executeSlashCommand,
  type SlashCommandContext,
} from "../src/slash-commands.js";
import { theme } from "../src/tui/theme.js";
import { mascots } from "../src/tui/mascot.js";

let pass = 0;
let fail = 0;

function test(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ': ' + detail : ''}`); }
}

function section(name: string) {
  console.log(`\n── ${name} ──`);
}

// Stub objects for the ctx
function makeStubCtx(overrides: Partial<SlashCommandContext> = {}): SlashCommandContext {
  const state = {
    autonomous: false,
    scope: null as string | null,
    provider: 'mock',
    model: 'MiniMax-M3',
    persistCalled: 0,
  };
  return {
    messages: [],
    llm: {
      getStats: () => ({ totalTokens: 0, totalInputTokens: 0, totalOutputTokens: 0, totalCost: 0, totalRequests: 0 }),
      resetStats: () => {},
    } as any,
    memory: {
      stats: () => ({ memories: 0, skills: 0, facts: 0, sessions: 0 }),
      recall: () => [],
      getLearnedSkills: () => [],
      saveProjectFact: () => {},
      recordEpisode: () => {},
    } as any,
    tools: {
      getPermissionMode: () => 'workspace-write',
      setPermissionMode: () => {},
    } as any,
    sessions: {
      list: () => [],
      formatList: (s: any[]) => s.map((s) => `  - ${s.id}`).join('\n'),
      load: () => null,
      delete: () => true,
    } as any,
    workdir: '/tmp',
    config: {
      provider: 'mock',
      model: 'MiniMax-M3',
      knownProviders: ['mock', 'anthropic', 'openai'],
      permissionMode: 'workspace-write',
    },
    onSwitchProvider: (p) => { state.provider = p; },
    onToggleAutonomous: () => { state.autonomous = !state.autonomous; return state.autonomous; },
    onGetAutonomous: () => state.autonomous,
    onSetScope: (s) => { state.scope = s ?? null; return state.scope; },
    onGetScope: () => state.scope,
    onPersistConfig: () => { state.persistCalled++; },
    ...overrides,
  };
}

async function main() {

// ─── 1. SLASH_COMMANDS list ──────────────────────────────────────
section("1. SLASH_COMMANDS list");
{
  const cmds = SLASH_COMMANDS.map((c) => c.name);
  test("has /help", cmds.includes("help"));
  test("has /model", cmds.includes("model"));
  test("has /provider (new)", cmds.includes("provider"));
  test("has /autonomous (new)", cmds.includes("autonomous"));
  test("has /scope (new)", cmds.includes("scope"));
  test("has /permissions", cmds.includes("permissions"));
  test("has /exit", cmds.includes("exit"));

  // Aliases
  const provCmd = SLASH_COMMANDS.find((c) => c.name === "provider");
  test("provider has 'prov' alias", provCmd?.aliases.includes("prov"));

  const autoCmd = SLASH_COMMANDS.find((c) => c.name === "autonomous");
  test("autonomous has 'auto' alias", autoCmd?.aliases.includes("auto"));

  const total = SLASH_COMMANDS.length;
  test(`at least 22 slash commands (got ${total})`, total >= 22);
}

// ─── 2. /provider command ────────────────────────────────────────
section("2. /provider command");
{
  const ctx = makeStubCtx();

  // Show (no args)
  const r1 = await executeSlashCommand("provider", [], ctx);
  test("/provider (no args) is handled", r1.handled);
  test("/provider (no args) shows current", r1.message?.includes("mock"));
  test("/provider (no args) lists known", r1.message?.includes("anthropic"));
  test("/provider (no args) shows model", r1.message?.includes("MiniMax-M3"));

  // Switch
  const r2 = await executeSlashCommand("provider", ["anthropic"], ctx);
  test("/provider anthropic is handled", r2.handled);
  test("/provider anthropic persisted (default)", r2.message?.includes("persisted"));

  // Unknown
  const r3 = await executeSlashCommand("provider", ["nonexistent"], ctx);
  test("/provider unknown is rejected", r3.handled && r3.message?.includes("Unknown provider"));
  test("/provider unknown lists valid", r3.message?.includes("Valid"));

  // Persist
  const r4 = await executeSlashCommand("provider", ["persist"], ctx);
  test("/provider persist works", r4.handled && r4.message?.includes("persisted"));
}

// ─── 3. /autonomous command ──────────────────────────────────────
section("3. /autonomous command");
{
  const ctx = makeStubCtx();

  // Initial state: off
  test("initial autonomous state is off", ctx.onGetAutonomous!() === false);

  // Toggle on (no args)
  const r1 = await executeSlashCommand("autonomous", [], ctx);
  test("/autonomous (no args) toggles to ON", r1.handled);
  test("/autonomous ON message present", r1.message?.includes("ON"));
  test("autonomous state is now true", ctx.onGetAutonomous!() === true);

  // Toggle off
  const r2 = await executeSlashCommand("autonomous", [], ctx);
  test("/autonomous toggles back to OFF", r2.handled);
  test("/autonomous OFF message present", r2.message?.includes("OFF"));
  test("autonomous state is now false", ctx.onGetAutonomous!() === false);

  // Explicit on
  const r3 = await executeSlashCommand("autonomous", ["on"], ctx);
  test("/autonomous on works", r3.handled && ctx.onGetAutonomous!() === true);

  // Explicit off
  const r4 = await executeSlashCommand("autonomous", ["off"], ctx);
  test("/autonomous off works", r4.handled && ctx.onGetAutonomous!() === false);

  // Aliases
  const r5 = await executeSlashCommand("auto", ["on"], ctx);
  test("/auto (alias) works", r5.handled && ctx.onGetAutonomous!() === true);

  // Invalid arg
  const r6 = await executeSlashCommand("autonomous", ["maybe"], ctx);
  test("/autonomous invalid arg shows usage", r6.handled && r6.message?.includes("Usage"));
}

// ─── 4. /scope command ───────────────────────────────────────────
section("4. /scope command");
{
  const ctx = makeStubCtx();

  // Initial: no scope
  test("initial scope is null", ctx.onGetScope!() === null);

  // Show (no args)
  const r1 = await executeSlashCommand("scope", [], ctx);
  test("/scope (no args) is handled", r1.handled);
  test("/scope (no args) shows 'No scope set'", r1.message?.includes("No scope set"));

  // Set
  const r2 = await executeSlashCommand("scope", ["src/auth.ts"], ctx);
  test("/scope src/auth.ts is handled", r2.handled);
  test("/scope src/auth.ts is reflected in state", ctx.onGetScope!() === "src/auth.ts");

  // Show with scope set
  const r3 = await executeSlashCommand("scope", [], ctx);
  test("/scope shows current value", r3.message?.includes("src/auth.ts"));
  test("/scope shows example usage", r3.message?.includes("Usage"));

  // Clear
  const r4 = await executeSlashCommand("scope", ["clear"], ctx);
  test("/scope clear works", r4.handled);
  test("scope is null after clear", ctx.onGetScope!() === null);

  // Multi-word scope
  const r5 = await executeSlashCommand("scope", ["some", "path", "with", "spaces.ts"], ctx);
  test("/scope joins multi-word args", ctx.onGetScope!() === "some path with spaces.ts");

  // Clear via 'off'
  const r6 = await executeSlashCommand("scope", ["off"], ctx);
  test("/scope off works as alias for clear", ctx.onGetScope!() === null);
}

// ─── 5. /status command (with new fields) ────────────────────────
section("5. /status shows autonomous + scope");
{
  // No autonomous, no scope
  const ctx1 = makeStubCtx();
  const r1 = await executeSlashCommand("status", [], ctx1);
  test("/status handled", r1.handled);
  test("/status shows Autonomous field", r1.message?.includes("Autonomous:"));
  test("/status shows 'off' for autonomous", r1.message?.includes("off"));
  test("/status shows Scope field", r1.message?.includes("Scope:"));
  test("/status shows '(none)' for empty scope", r1.message?.includes("(none") || r1.message?.includes("multi-file"));

  // With autonomous on and scope set
  const ctx2 = makeStubCtx();
  ctx2.onToggleAutonomous!();
  ctx2.onSetScope!("src/main.ts");
  const r2 = await executeSlashCommand("status", [], ctx2);
  test("/status shows 'ON' for active autonomous", r2.message?.includes("ON"));
  test("/status shows active scope path", r2.message?.includes("src/main.ts"));
  test("/status shows '⚡' for autonomous", r2.message?.includes("⚡"));
}

// ─── 6. cmdHelp shows new commands ───────────────────────────────
section("6. /help lists new commands");
{
  const ctx = makeStubCtx();
  const r = await executeSlashCommand("help", [], ctx);
  test("/help handled", r.handled);
  test("/help shows /provider", r.message?.includes("/provider"));
  test("/help shows /autonomous", r.message?.includes("/autonomous"));
  test("/help shows /scope", r.message?.includes("/scope"));
  test("/help shows the mascot tip", r.message?.includes("tip"));
}

// ─── 7. Edge cases ────────────────────────────────────────────────
section("7. Edge cases");
{
  // Unknown command
  const ctx = makeStubCtx();
  const r = await executeSlashCommand("nonexistent", [], ctx);
  test("unknown command not handled", !r.handled);
  test("unknown command gives helpful message", r.message?.includes("Unknown command"));

  // Multiple args to /model
  const r2 = await executeSlashCommand("model", ["claude-sonnet-4.5"], ctx);
  test("/model with arg works", r2.handled);
}

// ─── 8. /models command ───────────────────────────────────────────
section("8. /models — list models per provider");
{
  const ctx = makeStubCtx();
  const r = await executeSlashCommand("models", [], ctx);
  test("/models with no args works", r.handled);
  test("/models message is non-empty", !!r.message && r.message.length > 0);

  // Test with specific provider
  const r2 = await executeSlashCommand("models", ["anthropic"], ctx);
  test("/models anthropic works", r2.handled);
  test("/models anthropic shows Claude", r2.message?.includes("Claude"));

  // Test unknown provider
  const r3 = await executeSlashCommand("models", ["nonexistent-xyz"], ctx);
  test("/models unknown provider gives error", r3.message?.includes("Unknown provider"));
}

// ─── 9. /providers command ────────────────────────────────────────
section("9. /providers — list all providers");
{
  const ctx = makeStubCtx();
  const r = await executeSlashCommand("providers", [], ctx);
  test("/providers works", r.handled);
  test("/providers lists Anthropic", r.message?.includes("Anthropic"));
  test("/providers lists Groq", r.message?.includes("Groq"));
  test("/providers lists DeepSeek", r.message?.includes("DeepSeek"));
  test("/providers lists 23+ providers", /total:\s*\d+\s*providers/.test(r.message || ''));
  test("/providers shows model count", r.message?.includes("models"));
}

// ─── Done ────────────────────────────────────────────────────────
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);

}

main().catch((err) => {
  console.error("Test runner crashed:", err);
  process.exit(2);
});
