#!/usr/bin/env tsx
/**
 * test-slash-picker-integration.ts — Test that /model and /provider commands
 * actually open the picker dialog (not just print text).
 *
 * Approach: Build a fake slash command context that records when picker
 * openers are called. Then execute the slash commands and verify the
 * right opener was invoked with the right arguments.
 */

import { executeSlashCommand, type SlashCommandContext } from "../src/slash-commands.js";

let pass = 0;
let fail = 0;

function test(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ': ' + detail : ''}`); }
}

function section(name: string) {
  console.log(`\n── ${name} ──`);
}

// Build a recording context
function makeCtx(overrides: Partial<SlashCommandContext> = {}): any {
  const ctx: any = {
    messages: [],
    llm: { getStats: () => ({ totalTokens: 0, totalInputTokens: 0, totalOutputTokens: 0, totalRequests: 0, totalCost: 0 }), resetStats: () => {} },
    memory: { stats: () => ({ memories: 0, skills: 0, facts: 0 }) },
    tools: { getPermissionMode: () => 'workspace-write', setPermissionMode: () => {} },
    sessions: { list: () => [], load: () => null, save: () => '' },
    workdir: '/tmp',
    config: { provider: 'mock', model: 'mock-1', workdir: '/tmp' },
    _called: { provider: 0, model: 0, scope: 0, permission: 0, session: 0 },
    onOpenProviderPicker: () => { ctx._called.provider++; },
    onOpenModelPicker: () => { ctx._called.model++; },
    onOpenScopePicker: () => { ctx._called.scope++; },
    onOpenPermissionPicker: () => { ctx._called.permission++; },
    onShowSessionResume: () => { ctx._called.session++; },
    ...overrides,
  };
  return ctx;
}

(async () => {
  // ─── /provider with no args opens picker ─────────────────────
  section("/provider opens picker");

  {
    const ctx = makeCtx();
    const result = await executeSlashCommand('provider', [], ctx);
    test("/provider → onOpenProviderPicker called once", ctx._called.provider === 1);
    test("/provider → no toast (picker is the UX)", !result.message || result.message.length === 0,
      `got: ${JSON.stringify(result.message)}`);
    test("/provider → handled", result.handled === true);
  }

  section("/model opens picker");

  {
    const ctx = makeCtx();
    const result = await executeSlashCommand('model', [], ctx);
    test("/model → onOpenModelPicker called once", ctx._called.model === 1);
    test("/model → no toast", !result.message || result.message.length === 0);
    test("/model → handled", result.handled === true);
  }

  section("/scope opens picker");

  {
    const ctx = makeCtx();
    const result = await executeSlashCommand('scope', [], ctx);
    test("/scope → onOpenScopePicker called once", ctx._called.scope === 1);
    test("/scope → no toast", !result.message || result.message.length === 0);
  }

  section("/permissions opens picker");

  {
    const ctx = makeCtx();
    const result = await executeSlashCommand('permissions', [], ctx);
    test("/permissions → onOpenPermissionPicker called once", ctx._called.permission === 1);
    test("/permissions → no toast", !result.message || result.message.length === 0);
  }

  section("/resume opens session picker");

  {
    const ctx = makeCtx();
    const result = await executeSlashCommand('resume', [], ctx);
    test("/resume → onShowSessionResume called once", ctx._called.session === 1);
  }

  // ─── /provider <name> still works (direct switch) ─────────────
  section("/provider <name> still switches directly");

  {
    let switched = '';
    const ctx = makeCtx({ onSwitchProvider: (p: string) => { switched = p; } });
    const result = await executeSlashCommand('provider', ['openai'], ctx);
    test("/provider openai → onSwitchProvider called with 'openai'", switched === 'openai');
    test("/provider openai → did NOT open picker", ctx._called.provider === 0);
    test("/provider openai → toast shown", !!result.message);
  }

  // ─── /model <name> still works ────────────────────────────────
  section("/model <name> still switches directly");

  {
    let switched = '';
    const ctx = makeCtx({ onSwitchModel: (m: string) => { switched = m; } });
    const result = await executeSlashCommand('model', ['gpt-4o-mini'], ctx);
    test("/model gpt-4o-mini → onSwitchModel called", switched === 'gpt-4o-mini');
    test("/model gpt-4o-mini → did NOT open picker", ctx._called.model === 0);
  }

  // ─── /scope <file> still sets directly ────────────────────────
  section("/scope <file> still sets directly");

  {
    let setScope = '';
    const ctx = makeCtx({ onSetScope: (s: string | undefined) => { setScope = s ?? ''; return s ?? null; } });
    await executeSlashCommand('scope', ['src/auth.ts'], ctx);
    test("/scope src/auth.ts → onSetScope called with 'src/auth.ts'", setScope === 'src/auth.ts');
    test("/scope src/auth.ts → did NOT open picker", ctx._called.scope === 0);
  }

  // ─── /permissions <mode> still sets directly ───────────────────
  section("/permissions <mode> still sets directly");

  {
    let setMode = '';
    const ctx = makeCtx({ onSetPermissionMode: (m: any) => { setMode = m; } });
    await executeSlashCommand('permissions', ['allow'], ctx);
    test("/permissions allow → onSetPermissionMode called with 'allow'", setMode === 'allow');
    test("/permissions allow → did NOT open picker", ctx._called.permission === 0);
  }

  // ─── /scope clear still works ────────────────────────────────
  section("/scope clear still works");

  {
    let setScope = 'initial';
    const ctx = makeCtx({ onSetScope: (s: string | undefined) => { setScope = s ?? 'cleared'; return s ?? null; } });
    await executeSlashCommand('scope', ['clear'], ctx);
    test("/scope clear → onSetScope called with undefined", setScope === 'cleared');
    test("/scope clear → did NOT open picker", ctx._called.scope === 0);
  }

  // ─── Other slash commands are unchanged ───────────────────────
  section("Other slash commands still work");

  {
    const ctx = makeCtx();
    const result = await executeSlashCommand('help', [], ctx);
    test("/help → returns message", !!result.message);
    test("/help → did NOT open any picker", ctx._called.provider === 0 && ctx._called.model === 0 && ctx._called.scope === 0 && ctx._called.permission === 0);
  }

  {
    const ctx = makeCtx();
    const result = await executeSlashCommand('status', [], ctx);
    test("/status → returns message", !!result.message);
  }

  {
    const ctx = makeCtx();
    const result = await executeSlashCommand('version', [], ctx);
    test("/version → returns message", !!result.message);
  }

  {
    const ctx = makeCtx();
    const result = await executeSlashCommand('clear', [], ctx);
    test("/clear → handled", result.handled === true);
  }

  {
    const ctx = makeCtx();
    const result = await executeSlashCommand('modes', [], ctx);
    test("/modes → returns message", !!result.message);
  }

  // ─── /provider with no callback falls back to text ────────────
  section("Fallback: no picker callback → print text");

  {
    const ctx = makeCtx({ onOpenProviderPicker: undefined });
    const result = await executeSlashCommand('provider', [], ctx);
    const stripped = (result.message || '').replace(/\x1b\[[0-9;]*m/g, '');
    test("/provider (no callback) → returns text message", stripped.includes('LLM Provider'),
      `got: ${stripped.slice(0, 80)}`);
  }

  {
    const ctx = makeCtx({ onOpenModelPicker: undefined });
    const result = await executeSlashCommand('model', [], ctx);
    const stripped = (result.message || '').replace(/\x1b\[[0-9;]*m/g, '');
    test("/model (no callback) → returns text message", stripped.includes('Current model'),
      `got: ${stripped.slice(0, 80)}`);
  }

  console.log(`\n── Summary ──`);
  console.log(`  ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
})();
