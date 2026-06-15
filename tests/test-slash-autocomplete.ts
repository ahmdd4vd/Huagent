/**
 * test-slash-autocomplete.ts — Unit tests for slash command autocomplete.
 *
 * Run: npx tsx tests/test-slash-autocomplete.ts
 */
import { completeSlashCommand, getCommandMeta } from '../src/slash-commands.js';

let passed = 0;
let failed = 0;

function assertEq<T>(actual: T, expected: T, label: string) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.log(`  ✗ ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    failed++;
  }
}

// ─── Basic prefix matching ─────────────────────────────────────
console.log('\n[Basic prefix matching]');
{
  const r = completeSlashCommand('/pro');
  assertEq(r.length >= 2, true, '"/pro" returns multiple matches');
  assertEq(r.some((c) => c.name === '/provider'), true, '"/pro" includes provider');
  assertEq(r.some((c) => c.name === '/providers'), true, '"/pro" includes providers');
  assertEq(r.every((c) => c.name.startsWith('/pro')), true, 'all matches start with "/pro"');
}

{
  const r = completeSlashCommand('/mod');
  assertEq(r.some((c) => c.name === '/model'), true, '"/mod" includes model');
  assertEq(r.some((c) => c.name === '/models'), true, '"/mod" includes models');
}

{
  const r = completeSlashCommand('/h');
  assertEq(r.some((c) => c.name === '/help'), true, '"/h" includes help');
  assertEq(r.length, 1, '"/h" returns exactly 1 match');
}

// ─── Case insensitive ─────────────────────────────────────────
console.log('\n[Case insensitive]');
{
  const r = completeSlashCommand('/PRO');
  assertEq(r.some((c) => c.name === '/provider'), true, '"/PRO" still matches provider');
  assertEq(r.some((c) => c.name === '/providers'), true, '"/PRO" still matches providers');
}

// ─── No matches returns empty ─────────────────────────────────
console.log('\n[No matches]');
{
  const r = completeSlashCommand('/xyz');
  assertEq(r.length, 0, '"/xyz" returns 0 matches');
}

{
  const r = completeSlashCommand('/');
  assertEq(r.length, 0, '"/" returns 0 (require at least one char to match)');
}

// ─── Top match is the exact-prefix one ────────────────────────
console.log('\n[Top match selection]');
{
  const r = completeSlashCommand('/p');
  const names = r.map((c) => c.name);
  console.log(`  (info: /p matches: ${names.join(', ')})`);
  assertEq(names.length >= 2, true, '"/p" returns multiple matches');
}

// ─── Aliases included ─────────────────────────────────────────
console.log('\n[Aliases]');
{
  const r = completeSlashCommand('/m');
  assertEq(r.some((c) => c.name === '/model'), true, '"/m" matches "model"');
  const r2 = completeSlashCommand('/auto');
  assertEq(r2.some((c) => c.name === '/autonomous'), true, '"/auto" matches "autonomous"');
}

// ─── Top suggestion (first in list) ───────────────────────────
console.log('\n[Top suggestion]');
{
  // "/pro" → top suggestion should be provider (alphabetical)
  const r = completeSlashCommand('/pro');
  assertEq(r[0].name, '/provider', 'top suggestion for /pro is /provider');
}

// ─── getCommandMeta ───────────────────────────────────────────
console.log('\n[getCommandMeta]');
{
  const meta = getCommandMeta('provider');
  assertEq(meta?.name, '/provider', 'gets /provider meta');
  assertEq(meta?.summary.length > 0, true, 'has summary');
  assertEq(meta?.aliases.length > 0, true, 'has aliases');
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
