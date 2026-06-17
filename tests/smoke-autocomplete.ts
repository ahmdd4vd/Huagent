/**
 * smoke-autocomplete.ts — Real binary smoke test for slash command autocomplete.
 *
 * Spawns `bin/huagent.js` in a fresh home dir (with API key in env, so onboarding
 * is skipped), then:
 *   1. Type `/pro` — verify suggestions appear in output
 *   2. Press Enter — verify `/provider` was executed (not just submitted as text)
 *
 * Skip if PTY not available.
 */
import * as pty from 'node-pty';
import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BIN = join(process.cwd(), 'bin', 'huagent.js');

async function run() {
  // Use a fresh home so the config exists but the welcome doesn't show
  const freshHome = mkdtempSync(join(tmpdir(), 'huagent-ac-'));
  const configPath = join(freshHome, '.huagent', 'config.json');

  // Write a pre-existing config with valid provider/model (no API key needed for
  // autocomplete test — we're not actually calling the LLM)
  const { mkdirSync, writeFileSync } = await import('node:fs');
  mkdirSync(join(freshHome, '.huagent'), { recursive: true });
  writeFileSync(
    configPath,
    JSON.stringify({
      provider: 'anthropic',
      model: 'claude-3-5-sonnet-20241022',
      apiKey: 'sk-tes...2345',
      workdir: '/tmp',
      permissionMode: 'workspace-write',
      engine: 'v3',
      onboarded: true,
    }),
  );

  console.log(`[smoke-ac] fresh home: ${freshHome}`);

  const p = pty.spawn('node', [BIN], {
    name: 'xterm-color',
    cols: 100,
    rows: 30,
    env: {
      ...process.env,
      HOME: freshHome,
    },
  });

  let output = '';
  p.onData((data) => {
    output += data;
  });

  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

  try {
    // Wait for TUI to render
    await wait(2000);

    // Type /pro character by character (simulate real typing)
    p.write('/');
    await wait(100);
    p.write('p');
    await wait(100);
    p.write('r');
    await wait(100);
    p.write('o');
    await wait(500);

    // Suggestions should be visible. Press Enter — should auto-complete to /provider
    p.write('\r');
    await wait(1500);

    // Cancel the picker with Esc (so we can verify the suggestions popped up)
    p.write('\x1b');
    await wait(500);

    // Exit TUI
    p.write('/exit\r');
    await wait(1000);
  } catch (err) {
    console.error('[smoke-ac] error:', err);
  } finally {
    p.kill();
  }

  await wait(500);

  console.log('\n[smoke-ac] ── assertions ──');

  let pass = 0;
  let fail = 0;
  function check(label: string, cond: boolean) {
    if (cond) {
      console.log(`  ✓ ${label}`);
      pass++;
    } else {
      console.log(`  ✗ ${label}`);
      fail++;
    }
  }

  // Suggestions should have appeared (the popup shows the command names + summary)
  // We check that "/provider" or "provider" is mentioned in the output as a suggestion
  check('suggestion "/provider" appears in output', output.includes('/provider') || output.includes('Switch provider'));
  check('suggestion "/providers" appears in output', output.includes('/providers') || output.includes('List all'));

  // After Enter, the provider picker should have opened
  // We can detect this by "Switch Provider" picker text appearing
  check('Enter on /pro opened the provider picker', output.includes('Switch Provider') || output.includes('switch provider'));

  // Cleanup
  rmSync(freshHome, { recursive: true, force: true });

  // Print a snapshot of the output for debugging
  console.log('\n[smoke-ac] output snapshot (last 2000 chars):');
  console.log(output.slice(-2000));

  console.log(`\n[smoke-ac] ${pass} passed, ${fail} failed`);
  if (fail > 0) {
    console.log('✗ FAIL');
    process.exit(1);
  } else {
    console.log('✓ PASS');
  }
}

run().catch((err) => {
  console.error('[smoke-ac] FATAL:', err);
  process.exit(1);
});
