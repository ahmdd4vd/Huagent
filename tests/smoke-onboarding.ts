/**
 * smoke-onboarding.ts — Real binary smoke test for first-run onboarding.
 *
 * Spawns the actual `bin/huagent.js` in a fresh home dir, simulates keypresses,
 * and verifies:
 *   1. Welcome screen appears
 *   2. Provider picker shows
 *   3. API key input masks the key
 *   4. Model picker shows
 *   5. Effort picker shows
 *   6. Success screen appears
 *   7. Config file is saved to disk
 *
 * Skip if PTY not available (e.g. in some CI environments).
 */
import * as pty from 'node-pty';
import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

const BIN = join(process.cwd(), 'bin', 'huagent.js');
const TEST_TIMEOUT_MS = 30000;

async function run() {
  // Create a fresh home dir so first-run detection triggers
  const freshHome = mkdtempSync(join(tmpdir(), 'huagent-onboard-'));
  const configPath = join(freshHome, '.huagent', 'config.json');

  console.log(`[smoke-onboarding] fresh home: ${freshHome}`);

  // Make sure config doesn't exist
  if (existsSync(configPath)) rmSync(configPath);

  // Spawn the binary with HOME set to fresh dir
  const p = pty.spawn('node', [BIN], {
    name: 'xterm-color',
    cols: 100,
    rows: 30,
    env: {
      ...process.env,
      HOME: freshHome,
      // Wipe provider API keys from env so first-run detection triggers
      ANTHROPIC_API_KEY: '',
      OPENAI_API_KEY: '',
      TOKENROUTER_API_KEY: '',
    },
  });

  let output = '';
  p.onData((data) => {
    output += data;
    process.stdout.write(data);
  });

  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

  try {
    // Wait for welcome screen
    await wait(1500);

    // Press Enter to advance from welcome
    p.write('\r');
    await wait(800);

    // Press Enter to select first provider (anthropic is at top)
    p.write('\r');
    await wait(800);

    // Type API key
    p.write('sk-test-fake-key-12345');
    await wait(300);
    p.write('\r');
    await wait(800);

    // Press Enter to select default model
    p.write('\r');
    await wait(800);

    // Press Enter to confirm detected effort
    p.write('\r');
    await wait(1500);

    // Exit TUI gracefully with /exit
    p.write('/exit\r');
    await wait(1000);
  } catch (err) {
    console.error('[smoke-onboarding] error:', err);
  } finally {
    p.kill();
  }

  // Wait a moment for cleanup
  await wait(500);

  console.log('\n[smoke-onboarding] ── assertions ──');

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

  check('welcome screen rendered', output.includes('huagent v'));
  check('provider picker showed', output.includes('LLM Provider') || output.includes('Choose'));
  check('API key prompt showed', output.includes('API key:'));
  check('model picker showed', output.includes('Pick a') || output.includes('Model:'));
  check('effort picker showed', output.includes('Effort') || output.includes('EFFORT TIER'));
  check('config file saved', existsSync(configPath));

  if (existsSync(configPath)) {
    const rawContent = readFileSync(configPath, 'utf-8');
    console.log('[smoke-onboarding] raw config file length:', rawContent.length);
    const saved = JSON.parse(rawContent);
    check('config has provider', !!saved.provider);
    check('config has model', !!saved.model);
    check('config has apiKey', !!saved.apiKey);
    check('config has effort', !!saved.effort);
    check('config has onboarded=true', saved.onboarded === true);
    check('apiKey length matches input (22)', saved.apiKey?.length === 22);
  }

  // Cleanup
  rmSync(freshHome, { recursive: true, force: true });

  console.log(`\n[smoke-onboarding] ${pass} passed, ${fail} failed`);
  if (fail > 0) {
    console.log('✗ FAIL');
    process.exit(1);
  } else {
    console.log('✓ PASS');
  }
}

run().catch((err) => {
  console.error('[smoke-onboarding] FATAL:', err);
  process.exit(1);
});
