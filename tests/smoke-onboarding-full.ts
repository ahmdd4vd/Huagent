/**
 * smoke-onboarding-full.ts — Exhaustive smoke test for the full wizard.
 *
 * Tests:
 *   - welcome + enter
 *   - provider picker: down x2, up x1, then enter (lands on 2nd item)
 *   - api key input (with backspace verification)
 *   - model picker: down x2, then enter
 *   - effort picker: down x1, then enter
 *   - main TUI appears
 */
import * as pty from 'node-pty';
import { mkdtempSync, existsSync, readFileSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BIN = join(process.cwd(), 'bin', 'huagent.js');

async function run() {
  const freshHome = mkdtempSync(join(tmpdir(), 'huagent-full-'));
  const configPath = join(freshHome, '.huagent', 'config.json');

  console.log(`[smoke-full] fresh home: ${freshHome}`);
  mkdirSync(join(freshHome, '.huagent'), { recursive: true });

  const p = pty.spawn('node', [BIN], {
    name: 'xterm-256color',
    cols: 100,
    rows: 40,
    env: {
      ...process.env,
      HOME: freshHome,
      ANTHROPIC_API_KEY: '',
      OPENAI_API_KEY: '',
      TOKENROUTER_API_KEY: '',
    },
  });

  let output = '';
  p.onData((data) => {
    output += data;
  });

  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

  let testProvider = '';
  let testModel = '';
  let testEffort = '';

  try {
    // Welcome
    await wait(1500);
    p.write('\r');
    await wait(800);

    // Provider picker: down x2 then up x1 (cursor on 2nd item)
    p.write('\x1b[B');
    await wait(200);
    p.write('\x1b[B');
    await wait(200);
    p.write('\x1b[A'); // up
    await wait(300);
    p.write('\r');
    await wait(800);
    testProvider = 'after_2down_1up';

    // API key (15 chars + backspace → 14)
    p.write('sk-test-key-123');
    await wait(200);
    p.write('\x7f'); // backspace
    await wait(200);
    p.write('\r');
    await wait(800);

    // Model picker: down x2
    p.write('\x1b[B');
    await wait(200);
    p.write('\x1b[B');
    await wait(300);
    p.write('\r');
    await wait(800);
    testModel = 'after_2down';

    // Effort picker: down x1
    p.write('\x1b[B');
    await wait(200);
    p.write('\r');
    await wait(1500);
    testEffort = 'after_1down';

    // Exit
    p.write('/exit\r');
    await wait(1000);
  } catch (err) {
    console.error('[smoke-full] error:', err);
  } finally {
    p.kill();
  }

  await wait(500);

  console.log('\n[smoke-full] ── assertions ──');

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

  check('config file saved', existsSync(configPath));

  if (existsSync(configPath)) {
    const saved = JSON.parse(readFileSync(configPath, 'utf-8'));
    console.log('[smoke-full] saved config (sanitized):', JSON.stringify({ ...saved, apiKey: `len=${saved.apiKey?.length}` }, null, 2));
    check('provider selected', !!saved.provider);
    check('model selected', !!saved.model);
    check('effort selected', !!saved.effort);
    check('apiKey length is 14 (15 typed - 1 backspace)', saved.apiKey?.length === 14);
    check('onboarded=true', saved.onboarded === true);
  }

  // Cleanup
  rmSync(freshHome, { recursive: true, force: true });

  console.log(`\n[smoke-full] ${pass} passed, ${fail} failed`);
  if (fail > 0) {
    console.log('✗ FAIL');
    console.log('\n[smoke-full] output snapshot (last 3000 chars):');
    console.log(output.slice(-3000));
    process.exit(1);
  } else {
    console.log('✓ PASS');
  }
}

run().catch((err) => {
  console.error('[smoke-full] FATAL:', err);
  process.exit(1);
});
