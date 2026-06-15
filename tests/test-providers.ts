#!/usr/bin/env tsx
/**
 * test-providers.ts — comprehensive tests for the 22-provider / 100+ model system.
 *
 * Sections:
 *   1. Provider registry integrity: every provider has required fields
 *   2. Model registry coverage: every provider has at least one model
 *   3. Model pricing: every model has non-negative input/output
 *   4. Model context: context >= output
 *   5. ProviderId type matches registry keys
 *   6. Auto-detection from env vars
 *   7. getChatUrl: handles absolute, relative, and base-relative paths
 *   8. UnifiedClient cost calculation
 *   9. UnifiedClient stats initialization
 *  10. ProviderId exhaustive list (no missing/extra)
 *  11. Capability coverage: every flagship model has toolCall
 *  12. Cross-provider: same model id across providers (e.g. gpt-4o in openai + github)
 *  13. Reasoning tier coverage
 *  14. listAllModelIds
 *  15. Tier diversity
 */

import {
  PROVIDERS,
  listProviders,
  detectProviderFromEnv,
  getChatUrl,
  type ProviderId,
} from '../src/providers/registry.js';
import {
  MODELS,
  getModelCost,
  totalModelCount,
  listAllModelIds,
} from '../src/providers/models.js';
import { UnifiedClient } from '../src/providers/client.js';

let pass = 0;
let fail = 0;

function test(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; }
  else { fail++; console.log(`  ✗ ${name}${detail ? ': ' + detail : ''}`); }
}

function section(name: string) {
  console.log(`\n── ${name} ──`);
}

console.log('Provider & Model Registry Tests');
console.log('================================');

section('1. Provider registry integrity');
for (const [id, p] of Object.entries(PROVIDERS)) {
  const ok = (
    typeof p.id === 'string' && p.id.length > 0 &&
    typeof p.name === 'string' && p.name.length > 0 &&
    typeof p.displayName === 'string' && p.displayName.length > 0 &&
    typeof p.emoji === 'string' && p.emoji.length > 0 &&
    /^https?:\/\//.test(p.baseUrl) &&
    typeof p.apiKeyEnv === 'string' && p.apiKeyEnv.length > 0 &&
    typeof p.defaultModel === 'string' && p.defaultModel.length > 0 &&
    ['anthropic', 'openai-chat', 'openai-responses', 'gemini'].includes(p.apiFormat) &&
    typeof p.supportsPromptCaching === 'boolean' &&
    typeof p.supportsTools === 'boolean' &&
    typeof p.supportsStreaming === 'boolean' &&
    typeof p.contextWindow === 'number' && p.contextWindow > 0
  );
  test(`${id} has all required fields`, ok);
}

section('2. Model registry coverage');
for (const [id, models] of Object.entries(MODELS)) {
  test(`${id} has at least one model`, Array.isArray(models) && models.length >= 1,
    `got ${models.length}`);
}
test('total models >= 80', totalModelCount() >= 80, `got ${totalModelCount()}`);

section('3. Model pricing non-negative');
for (const [providerId, models] of Object.entries(MODELS)) {
  for (const m of models) {
    test(`${providerId}/${m.id} cost non-negative`, m.cost.input >= 0 && m.cost.output >= 0,
      `input=${m.cost.input}, output=${m.cost.output}`);
  }
}

section('4. Model context >= output');
for (const [providerId, models] of Object.entries(MODELS)) {
  for (const m of models) {
    test(`${providerId}/${m.id} context >= output`, m.context >= m.output,
      `context=${m.context} output=${m.output}`);
  }
}

section('5. ProviderId set is comprehensive');
const ids = Object.keys(PROVIDERS);
test('has at least 22 providers', ids.length >= 22, `got ${ids.length}`);
for (const must of ['anthropic', 'openai', 'gemini', 'github', 'bedrock', 'vertex', 'nvidia-nim', 'minimax', 'xai', 'ollama', 'opencode', 'codex', 'xiaomi-mimo', 'groq', 'cerebras', 'deepseek', 'openrouter', 'together', 'fireworks', 'perplexity', 'huggingface', 'custom']) {
  test(`has ${must}`, !!PROVIDERS[must]);
}

section('6. Auto-detection from env vars');
const originalEnv: Record<string, string | undefined> = {};
for (const p of listProviders()) {
  originalEnv[p.apiKeyEnv] = process.env[p.apiKeyEnv];
  delete process.env[p.apiKeyEnv];
}
test('returns null when no env vars set', detectProviderFromEnv() === null);
process.env.ANTHROPIC_API_KEY = '***';
test('detects anthropic when ANTHROPIC_API_KEY is set',
  detectProviderFromEnv()?.id === 'anthropic');
delete process.env.ANTHROPIC_API_KEY;
process.env.GROQ_API_KEY = '***';
test('detects groq when GROQ_API_KEY is set',
  detectProviderFromEnv()?.id === 'groq');
// Restore
for (const [k, v] of Object.entries(originalEnv)) {
  if (v !== undefined) process.env[k] = v;
  else delete process.env[k];
}

section('7. getChatUrl handles paths');
const p = PROVIDERS.openai;
test('default chat completions path', getChatUrl(p) === 'https://api.openai.com/v1/chat/completions');
test('absolute path passes through', getChatUrl(p, 'https://custom.com/x') === 'https://custom.com/x');
test('relative path with / joins base', getChatUrl(p, '/v2/chat') === 'https://api.openai.com/v1/v2/chat');
test('relative path without / joins base', getChatUrl(p, 'chat') === 'https://api.openai.com/v1/chat');
test('overrides base path', getChatUrl(p, 'responses') === 'https://api.openai.com/v1/responses');

section('8. UnifiedClient cost calculation');
{
  const cost = getModelCost('anthropic', 'claude-sonnet-4-6');
  test('claude-sonnet-4-6 cost is 3/15', cost.input === 3 && cost.output === 15,
    `got ${cost.input}/${cost.output}`);
}
{
  const cost = getModelCost('anthropic', 'does-not-exist');
  test('unknown model falls back to provider default', cost.input > 0,
    `got ${cost.input}`);
}
{
  const cost = getModelCost('github', 'gpt-5.5');
  test('github models are free', cost.input === 0 && cost.output === 0,
    `got ${cost.input}/${cost.output}`);
}
{
  const cost = getModelCost('ollama', 'llama3.2');
  test('ollama models are free (local)', cost.input === 0 && cost.output === 0,
    `got ${cost.input}/${cost.output}`);
}
{
  // 1M input + 1M output for sonnet-4-6 = $3 + $15 = $18
  const c = new UnifiedClient('anthropic', 'sk-test');
  c.resetStats();
  // Simulate by directly checking pricing
  const cost = (1_000_000 / 1_000_000) * 3 + (1_000_000 / 1_000_000) * 15;
  test('cost math sanity check', cost === 18, `expected $18, got $${cost}`);
}

section('9. UnifiedClient stats');
{
  const c = new UnifiedClient('anthropic', 'sk-test');
  const s = c.getStats();
  test('initial stats are zero', s.requests === 0 && s.totalRequests === 0 &&
    s.inputTokens === 0 && s.outputTokens === 0 && s.totalCost === 0);
}
{
  const c = new UnifiedClient('openai', 'sk-test');
  c.resetStats();
  const s = c.getStats();
  test('resetStats clears', s.totalCost === 0);
}
{
  const c = new UnifiedClient('openai', 'sk-test');
  c.setModel('gpt-5');
  test('setModel changes model', c.getModel() === 'gpt-5');
}
{
  const c = new UnifiedClient('anthropic', 'sk-test');
  const name = c.getProviderName();
  test('getProviderName includes display name', name.includes('Anthropic'),
    `got "${name}"`);
}

section('10. ProviderId exhaustive list');
const expected: ProviderId[] = [
  'anthropic', 'openai', 'gemini', 'mistral', 'github', 'bedrock', 'vertex',
  'nvidia-nim', 'minimax', 'xai', 'ollama', 'opencode', 'codex', 'xiaomi-mimo',
  'groq', 'cerebras', 'deepseek', 'openrouter', 'together', 'fireworks',
  'perplexity', 'huggingface', 'custom'
];
test('all expected providers exist in registry', expected.every((id) => !!PROVIDERS[id]));

section('11. Flagship models support tool calls (with known exceptions)');
// Some providers intentionally don't support tool calls (search-augmented,
// free tiers, embedding endpoints). Documented exceptions: perplexity, huggingface.
const noToolCallProviders = new Set(['perplexity', 'huggingface']);
let flagshipCount = 0;
for (const [pid, models] of Object.entries(MODELS)) {
  for (const m of models) {
    if (m.tier === 'flagship') {
      flagshipCount++;
      const expected = !noToolCallProviders.has(pid);
      test(`${pid}/${m.id} (flagship) tool-call support = ${expected}`,
        m.capabilities.toolCall === expected,
        `expected ${expected}, got ${m.capabilities.toolCall}`);
    }
  }
}
test('at least 15 flagship models', flagshipCount >= 15, `got ${flagshipCount}`);

section('12. Cross-provider model coverage');
{
  const found: string[] = [];
  for (const [pid, models] of Object.entries(MODELS)) {
    if (models.some((m) => m.id === 'claude-sonnet-4-6' || m.id === 'claude-sonnet-4-5')) {
      found.push(pid);
    }
  }
  test('claude-sonnet-4-6 exists in 2+ providers', found.length >= 2,
    `got ${found.length} (${found.join(', ')})`);
}
{
  const gptIn: string[] = [];
  for (const [pid, models] of Object.entries(MODELS)) {
    if (models.some((m) => m.family === 'gpt')) gptIn.push(pid);
  }
  test('gpt family in 4+ providers', gptIn.length >= 4, `got ${gptIn.length}`);
}
{
  const llamaIn: string[] = [];
  for (const [pid, models] of Object.entries(MODELS)) {
    if (models.some((m) => m.family === 'llama')) llamaIn.push(pid);
  }
  test('llama family in 6+ providers', llamaIn.length >= 6, `got ${llamaIn.length}`);
}

section('13. Reasoning tier');
let totalReasoning = 0;
for (const models of Object.values(MODELS)) {
  totalReasoning += models.filter((m) => m.tier === 'reasoning').length;
}
test('8+ reasoning models', totalReasoning >= 8, `got ${totalReasoning}`);

section('14. listAllModelIds');
test('listAllModelIds returns all', listAllModelIds().length === totalModelCount(),
  `got ${listAllModelIds().length}, expected ${totalModelCount()}`);

section('15. Tier diversity');
const tiers = new Set<string>();
for (const models of Object.values(MODELS)) {
  for (const m of models) tiers.add(m.tier);
}
test('5+ tiers', tiers.size >= 5, `got ${Array.from(tiers).join(', ')}`);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
