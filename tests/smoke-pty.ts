#!/usr/bin/env tsx
/**
 * Real PTY smoke test of the huagent TUI binary — v2.
 *
 * Uses node-pty to give huagent a real terminal so ink will render.
 * Sends keystrokes to invoke pickers and captures the actual output.
 */

import * as pty from 'node-pty';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const tmp = mkdtempSync(join(tmpdir(), 'huagent-pty-'));
const env = {
  ...process.env,
  HUAGENT_PROVIDER: 'openai',   // openai has 6 models, mock has 0
  HUAGENT_MODEL: 'gpt-4o-mini',
  OPENAI_API_KEY: 'sk-test-not-real-but-picker-still-opens',
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
  // Wait for banner
  await wait(1500);

  // /model + Enter
  await typeCmd('/model');
  await wait(300);
  ptyProcess.write('\r');
  await wait(800);
  // Esc to close
  ptyProcess.write('\x1b');
  await wait(400);

  // /provider
  await typeCmd('/provider');
  await wait(300);
  ptyProcess.write('\r');
  await wait(800);
  ptyProcess.write('\x1b');
  await wait(400);

  // /scope
  await typeCmd('/scope');
  await wait(300);
  ptyProcess.write('\r');
  await wait(800);
  ptyProcess.write('\x1b');
  await wait(400);

  // /permissions
  await typeCmd('/permissions');
  await wait(300);
  ptyProcess.write('\r');
  await wait(800);
  ptyProcess.write('\x1b');
  await wait(400);

  // /resume
  await typeCmd('/resume');
  await wait(300);
  ptyProcess.write('\r');
  await wait(800);
  ptyProcess.write('\x1b');
  await wait(400);

  // Test Ctrl+P (provider picker shortcut)
  ptyProcess.write('\x10');  // Ctrl+P
  await wait(800);
  ptyProcess.write('\x1b');
  await wait(400);

  // Test Ctrl+M (model picker shortcut)
  ptyProcess.write('\x0d');  // Ctrl+M
  await wait(800);
  ptyProcess.write('\x1b');
  await wait(400);

  // /exit
  await typeCmd('/exit');
  await wait(300);
  ptyProcess.write('\r');
  await wait(500);

  ptyProcess.kill();

  // Save raw
  writeFileSync(join(tmp, 'raw.txt'), output);

  // Strip ANSI for analysis
  const clean = output
    .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')
    .replace(/\x1b\[\?[0-9]+[hl]/g, '')
    .replace(/\x1b\][^\x07]*\x07/g, '')
    .replace(/\r/g, '');

  writeFileSync(join(tmp, 'clean.txt'), clean);

  const checks = [
    { name: 'banner printed', pat: /huagent v\d/ },
    { name: '/model opened picker (Switch Model)', pat: /Switch Model/ },
    { name: '/provider opened picker (Switch Provider)', pat: /Switch Provider/ },
    { name: '/scope opened picker (Set Scope)', pat: /Set Scope/ },
    { name: '/permissions opened picker (Permission Mode)', pat: /Permission Mode/ },
    { name: '/resume opened picker (Resume Session)', pat: /Resume Session/ },
    { name: 'Ctrl+P opened provider picker', pat: /Switch Provider/ },
    { name: 'Ctrl+M opened model picker', pat: /Switch Model/ },
  ];

  let pass = 0, fail = 0;
  const seen = new Set<string>();
  for (const c of checks) {
    if (c.pat.test(clean)) {
      pass++;
      seen.add(c.name);
      console.log(`  ✓ ${c.name}`);
    } else {
      fail++;
      console.log(`  ✗ ${c.name}`);
    }
  }

  // Find lines containing picker titles
  console.log(`\n── Picker opens in output ──`);
  for (const title of ['Switch Model', 'Switch Provider', 'Set Scope', 'Permission Mode', 'Resume Session']) {
    const matches = clean.split('\n').filter(l => l.includes(title));
    console.log(`  "${title}": ${matches.length} occurrences`);
  }

  console.log(`\n── Last 30 non-empty lines of output ──`);
  const lines = clean.split('\n').filter(l => l.trim().length > 0);
  console.log(lines.slice(-30).join('\n'));

  console.log(`\n  Raw:   ${join(tmp, 'raw.txt')}`);
  console.log(`  Clean: ${join(tmp, 'clean.txt')}`);
  console.log(`  ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
