#!/usr/bin/env tsx
/**
 * tests/engine.test.ts — Test the unified engine core
 *
 * Tests cover:
 *   1. Task classification (regex)
 *   2. Complexity detection
 *   3. Tool result formatting
 *   4. Memory tool handling
 *
 * 20+ test cases. No external deps (uses mocks).
 */

import { Engine } from "../src/engine/core.js";

let pass = 0;
let fail = 0;

function test(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ': ' + detail : ''}`); }
}

function section(name: string) {
  console.log(`\n── ${name} ──`);
}

// Mock dependencies
const mockClient = {
  getModel: () => 'MiniMax-M3',
  setModel: () => {},
  stream: async function*() {},
  getStats: () => ({ totalTokens: 0, totalCost: 0 }),
} as any;

const mockMemory = {
  recall: () => [],
  recordEpisode: () => {},
  saveProjectFact: () => {},
  recordPattern: () => {},
  stats: () => ({ memories: 0, skills: 0 }),
} as any;

const mockTools = {
  list: () => [
    { name: 'read', description: 'Read a file' },
    { name: 'write', description: 'Write a file' },
    { name: 'edit', description: 'Edit a file' },
    { name: 'bash', description: 'Run bash command' },
  ],
  execute: async () => ({}),
  getPermissionMode: () => 'workspace-write',
} as any;

const mockSessions = {
  startSession: () => 'test-session-id',
  endSession: () => {},
} as any;

const engine = new Engine(mockClient, mockMemory, mockTools, mockSessions);

// ─── 1. Task Classification (Regex) ──────────────────────────────────────
section("1. Task Classification (Regex)");
{
  test("fix bug → code_fix", (engine as any).detectTaskTypeRegex('fix the login bug') === 'code_fix');
  test("read file → code_read", (engine as any).detectTaskTypeRegex('read the auth file') === 'code_read');
  test("refactor → code_refactor", (engine as any).detectTaskTypeRegex('refactor the database') === 'code_refactor');
  test("run tests → action", (engine as any).detectTaskTypeRegex('run the test suite') === 'action');
  test("what is → question", (engine as any).detectTaskTypeRegex('what is JavaScript') === 'question');
  test("hello there → unknown", (engine as any).detectTaskTypeRegex('hello there') === 'unknown');
  test("explain code → code_read", (engine as any).detectTaskTypeRegex('explain this function') === 'code_read');
  test("debug error → code_fix", (engine as any).detectTaskTypeRegex('debug this error') === 'code_fix');
}

// ─── 2. Complexity Detection ──────────────────────────────────────
section("2. Complexity Detection");
{
  test("trivial (short question)", (engine as any).detectComplexity('what is JS', 'question') === 'trivial');
  test("simple (short message)", (engine as any).detectComplexity('fix bug', 'code_fix') === 'simple');
  test("moderate (medium message)", (engine as any).detectComplexity('fix the login bug in the authentication module that causes users to get logged out randomly', 'code_fix') === 'moderate');
  test("complex (long message)", (engine as any).detectComplexity('a '.repeat(50), 'code_write') === 'complex');
  test("trivial boundary (< 30 chars)", (engine as any).detectComplexity('what is TypeScript?', 'question') === 'trivial');
  test("simple boundary (< 8 words)", (engine as any).detectComplexity('fix the bug please', 'code_fix') === 'simple');
}

// ─── 3. Tool Result Formatting ──────────────────────────────────────
section("3. Tool Result Formatting");
{
  test("format string result", (engine as any).formatToolResult('read', 'file content') === 'file content');
  test("format error result", (engine as any).formatToolResult('read', { error: 'File not found' }) === 'ERROR: File not found');
  test("format object with content", (engine as any).formatToolResult('bash', { content: 'output' }) === 'output');
  test("format object with stdout", (engine as any).formatToolResult('bash', { stdout: 'command output' }) === 'command output');
  test("truncate long results to 500 chars", (engine as any).formatToolResult('read', 'a'.repeat(1000)).length === 500);
  test("format null result", (engine as any).formatToolResult('read', null) === 'no result');
  test("format empty object", (engine as any).formatToolResult('bash', {}) === '{}');
}

// ─── 4. Memory Tool Handling ──────────────────────────────────────
section("4. Memory Tool Handling");
{
  // handleMemoryTool is async (recall may await on WikiMemory). Use top-level await.
  const saveResult = await (engine as any).handleMemoryTool({ action: 'save', content: 'test memory', type: 'episodic' });
  test("save action returns ok", saveResult.status === 'ok');
  test("save action returns message", saveResult.message === 'Memory saved');

  const recallResult = await (engine as any).handleMemoryTool({ action: 'recall', query: 'test query' });
  test("recall action returns ok", recallResult.status === 'ok');
  test("recall action returns memories array", Array.isArray(recallResult.memories));

  const factResult = await (engine as any).handleMemoryTool({ action: 'fact', key: 'test-key', value: 'test-value' });
  test("fact action returns ok", factResult.status === 'ok');
  test("fact action returns message", factResult.message === 'Fact saved: test-key');

  const skillResult = await (engine as any).handleMemoryTool({ action: 'skill', name: 'test-skill', description: 'test desc', pattern: 'test pattern' });
  test("skill action returns ok", skillResult.status === 'ok');
  test("skill action returns message", skillResult.message === 'Skill learned: test-skill');

  const unknownResult = await (engine as any).handleMemoryTool({ action: 'unknown' });
  test("unknown action returns error", unknownResult.status === 'error');
  test("unknown action returns message", typeof unknownResult.message === 'string' && unknownResult.message.includes('Unknown memory action'));
}

// ─── 5. Engine State ──────────────────────────────────────
section("5. Engine State");
{
  test("engine has reset method", typeof (engine as any).reset === 'function');
  test("engine has process method", typeof (engine as any).process === 'function');
  test("engine has detectTaskTypeRegex method", typeof (engine as any).detectTaskTypeRegex === 'function');
  test("engine has detectComplexity method", typeof (engine as any).detectComplexity === 'function');
  test("engine has formatToolResult method", typeof (engine as any).formatToolResult === 'function');
  test("engine has handleMemoryTool method", typeof (engine as any).handleMemoryTool === 'function');
  
  // Test reset
  (engine as any).reset();
  test("reset doesn't throw", true);
}

// ─── Summary ──────────────────────────────────────
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
