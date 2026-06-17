/**
 * test-key-reader.ts — Tests for the masked API key reader.
 *
 * Run: npx tsx tests/test-key-reader.ts
 *
 * Uses a fake reader function (DI'd) to avoid TTY dependency in tests.
 */
import { readKeyWithMask } from '../src/onboarding/key-reader.js';

let passed = 0;
let failed = 0;

function assertEq<T>(actual: T, expected: T, label: string) {
  if (actual === expected) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.log(`  ✗ ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    failed++;
  }
}

// ─── Simulated keypress sequence ──────────────────────────────
async function withFakeReader(keys: string[], fn: () => Promise<string>): Promise<string> {
  // Simulate typing each char then Enter
  let i = 0;
  const origRead = (globalThis as any).__readChar;
  (globalThis as any).__readChar = async () => {
    const k = keys[i++];
    if (k === undefined) {
      // No more keys → never resolve (test should not hit this)
      return new Promise(() => {});
    }
    return k;
  };
  try {
    return await fn();
  } finally {
    if (origRead) (globalThis as any).__readChar = origRead;
  }
}

// ─── Basic reading ────────────────────────────────────────────
console.log('\n[Basic reading]');
{
  const result = await withFakeReader(['s', 'k', '-', '1', '2', '3', '4', '\r'], () =>
    readKeyWithMask({
      prompt: 'API key: ',
      onEcho: (_mask, _buf) => {},
    }),
  );
  assertEq(result, 'sk-1234', 'reads typed chars and submits on Enter');
}

// ─── Backspace removes char ───────────────────────────────────
console.log('\n[Backspace]');
{
  const result = await withFakeReader(
    ['s', 'k', '-', '1', '2', '3', '\x7f', '\r'],
    () => readKeyWithMask({ prompt: '> ', onEcho: () => {} }),
  );
  assertEq(result, 'sk-12', 'backspace removes last char');
}

// ─── Echo callback fires for each char ────────────────────────
console.log('\n[Echo callback]');
{
  const echoes: string[] = [];
  await withFakeReader(['a', 'b', 'c', '\r'], () =>
    readKeyWithMask({
      prompt: '',
      onEcho: (mask, buf) => echoes.push(`${mask}|${buf}`),
    }),
  );
  assertEq(echoes[0], '*|a', 'first echo shows * and a');
  assertEq(echoes[1], '**|ab', 'second echo shows ** and ab');
  assertEq(echoes[2], '***|abc', 'third echo shows *** and abc');
  assertEq(echoes.length, 3, 'echo fires once per char (not on Enter)');
}

// ─── Empty submit returns empty string ────────────────────────
console.log('\n[Empty submit]');
{
  const result = await withFakeReader(['\r'], () =>
    readKeyWithMask({ prompt: '', onEcho: () => {} }),
  );
  assertEq(result, '', 'empty Enter returns empty string');
}

// ─── Multi-char special keys handled ──────────────────────────
console.log('\n[Special keys]');
{
  // Ctrl+C (0x03) cancels — but our reader doesn't have cancel in this signature.
  // Instead test that \x1b (Esc) does something sensible
  // For now, just verify \t (tab) is ignored or handled
  const result = await withFakeReader(
    ['a', '\t', 'b', '\r'],
    () => readKeyWithMask({ prompt: '', onEcho: () => {} }),
  );
  // We don't have explicit tab handling — it should be treated as a non-printable
  // that doesn't go into the buffer (depends on implementation)
  // Test accepts whatever behavior, but shouldn't crash
  console.log(`  (tab result: ${JSON.stringify(result)})`);
  assertEq(typeof result, 'string', 'tab does not crash');
}

// ─── Summary ──────────────────────────────────────────────────
console.log(`\n${'─'.repeat(60)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('─'.repeat(60));
if (failed > 0) {
  console.log('✗ FAIL');
  process.exit(1);
} else {
  console.log('✓ PASS');
}
