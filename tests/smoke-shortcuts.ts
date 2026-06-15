#!/usr/bin/env tsx
/**
 * Test which Ctrl+ shortcuts actually work in the TUI.
 */
import * as pty from 'node-pty';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const tmp = mkdtempSync(join(tmpdir(), 'huagent-keys-'));
const env = {
  ...process.env,
  HUAGENT_PROVIDER: 'openai',
  HUAGENT_MODEL: 'gpt-4o-mini',
  OPENAI_API_KEY: 'sk-tes...pens',
  HOME: tmp,
  TERM: 'xterm-256color',
};

const ptyProcess = pty.spawn('node', ['/root/huagent/bin/huagent.js'], {
  name: 'xterm-256color',
  cols: 120,
  rows: 40,
  cwd: '/root/huagent',
  env: env as any,
});

let output = '';
ptyProcess.onData((data: string) => { output += data; });
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function typeCmd(text: string) {
  for (const ch of text) {
    ptyProcess.write(ch);
    await wait(15);
  }
}

async function main() {
  await wait(1500);

  // For each Ctrl shortcut, send it and check what picker opens
  const shortcuts = [
    { name: 'Ctrl+P', code: '\x10', expect: 'Switch Provider' },
    { name: 'Ctrl+K', code: '\x0b', expect: 'Command Palette' },
    { name: 'Ctrl+L', code: '\x0c', expect: null },
    { name: 'Ctrl+R', code: '\x12', expect: 'Resume Session' },
    { name: 'Ctrl+T', code: '\x14', expect: 'Switch Model' },
    { name: 'Ctrl+E', code: '\x05', expect: 'Set Scope' },
    { name: 'Ctrl+N', code: '\x0e', expect: null },
    { name: 'Ctrl+M (CR)', code: '\x0d', expect: null },
    { name: 'Ctrl+I (Tab)', code: '\x09', expect: null },
  ];

  for (const s of shortcuts) {
    console.log(`\nTesting ${s.name} (0x${s.code.charCodeAt(0).toString(16)})...`);
    const before = output.length;
    ptyProcess.write(s.code);
    await wait(600);
    const newOutput = output.slice(before);
    const clean = newOutput
      .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')
      .replace(/\r/g, '');
    if (s.expect) {
      const found = clean.includes(s.expect);
      console.log(`  ${found ? '✓' : '✗'} expected "${s.expect}": ${found ? 'found' : 'not found'}`);
      if (!found) {
        // Show what changed
        const lines = clean.split('\n').filter(l => l.trim().length > 0).slice(-3);
        console.log(`  last 3 lines: ${lines.join(' | ')}`);
      }
    } else {
      console.log(`  ${clean.includes('Switch') || clean.includes('Scope') || clean.includes('Permission') ? '✗ unexpected picker' : 'no picker (expected)'}`);
    }
    ptyProcess.write('\x1b');
    await wait(200);
  }

  // Test /help
  await typeCmd('/help');
  await wait(200);
  ptyProcess.write('\r');
  await wait(800);
  const helpShown = output.includes('Slash Commands');
  console.log(`\n  /help → ${helpShown ? '✓' : '✗'}`);

  // Exit
  await typeCmd('/exit');
  await wait(200);
  ptyProcess.write('\r');
  await wait(500);

  ptyProcess.kill();
  writeFileSync(join(tmp, 'raw.txt'), output);
  console.log(`\n  Raw: ${join(tmp, 'raw.txt')}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
