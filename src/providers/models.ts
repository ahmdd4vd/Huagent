// Comprehensive model registry for all 16+ providers.
// Inspired by openclaude's `models.dev/api.json` + per-provider hardcoded lists.
//
// Each model entry includes:
//   - id:          the model identifier sent to the API
//   - label:       human-friendly display name
//   - family:      model family (claude, gpt, gemini, etc.)
//   - context:     context window in tokens
//   - output:      max output tokens
//   - cost:        { input, output } per 1M tokens (USD)
//   - capabilities: tool_call, vision, reasoning, streaming, json
//   - tier:        'flagship' | 'fast' | 'reasoning' | 'code' | 'local' | 'legacy'
//   - deprecated:  true if no longer recommended
//
// Pricing sources: provider docs (Anthropic, OpenAI, Google, xAI, Mistral, DeepSeek,
// GitHub Copilot, Groq, Cerebras, OpenRouter, Together, Fireworks, Perplexity,
// HuggingFace, Xiaomi MiMo, NVIDIA NIM, AWS Bedrock, Google Vertex, MiniMax,
// OpenCode Zen, Codex). Defaults to {0,0} for free/local. Last verified 2026-06.

import type { ProviderId } from './registry.js';

export interface ModelInfo {
  id: string;
  label: string;
  family: string;
  context: number;
  output: number;
  cost: { input: number; output: number };
  capabilities: {
    toolCall: boolean;
    vision: boolean;
    reasoning: boolean;
    streaming: boolean;
    json: boolean;
  };
  tier: 'flagship' | 'fast' | 'reasoning' | 'code' | 'local' | 'legacy' | 'embed';
  deprecated?: boolean;
  notes?: string;
}

export const MODELS: Record<ProviderId, ModelInfo[]> = {
  // ────────────────────────────────────────────────────────────────
  anthropic: [
    {
      id: 'claude-opus-4-7',
      label: 'Claude Opus 4.7',
      family: 'claude',
      context: 200000,
      output: 32000,
      cost: { input: 15, output: 75 },
      capabilities: { toolCall: true, vision: true, reasoning: true, streaming: true, json: true },
      tier: 'flagship',
    },
    {
      id: 'claude-opus-4-6',
      label: 'Claude Opus 4.6',
      family: 'claude',
      context: 200000,
      output: 32000,
      cost: { input: 15, output: 75 },
      capabilities: { toolCall: true, vision: true, reasoning: true, streaming: true, json: true },
      tier: 'flagship',
    },
    {
      id: 'claude-opus-4-5',
      label: 'Claude Opus 4.5',
      family: 'claude',
      context: 200000,
      output: 32000,
      cost: { input: 15, output: 75 },
      capabilities: { toolCall: true, vision: true, reasoning: true, streaming: true, json: true },
      tier: 'flagship',
    },
    {
      id: 'claude-sonnet-4-6',
      label: 'Claude Sonnet 4.6',
      family: 'claude',
      context: 200000,
      output: 64000,
      cost: { input: 3, output: 15 },
      capabilities: { toolCall: true, vision: true, reasoning: true, streaming: true, json: true },
      tier: 'flagship',
    },
    {
      id: 'claude-sonnet-4-5',
      label: 'Claude Sonnet 4.5',
      family: 'claude',
      context: 200000,
      output: 64000,
      cost: { input: 3, output: 15 },
      capabilities: { toolCall: true, vision: true, reasoning: true, streaming: true, json: true },
      tier: 'flagship',
    },
    {
      id: 'claude-sonnet-4-0',
      label: 'Claude Sonnet 4.0',
      family: 'claude',
      context: 200000,
      output: 64000,
      cost: { input: 3, output: 15 },
      capabilities: { toolCall: true, vision: true, reasoning: true, streaming: true, json: true },
      tier: 'flagship',
    },
    {
      id: 'claude-haiku-4-5',
      label: 'Claude Haiku 4.5',
      family: 'claude',
      context: 200000,
      output: 64000,
      cost: { input: 1, output: 5 },
      capabilities: { toolCall: true, vision: true, reasoning: false, streaming: true, json: true },
      tier: 'fast',
    },
    {
      id: 'claude-3-5-sonnet-20241022',
      label: 'Claude 3.5 Sonnet (legacy)',
      family: 'claude',
      context: 200000,
      output: 8192,
      cost: { input: 3, output: 15 },
      capabilities: { toolCall: true, vision: true, reasoning: false, streaming: true, json: true },
      tier: 'legacy',
      deprecated: true,
    },
    {
      id: 'claude-3-5-haiku-20241022',
      label: 'Claude 3.5 Haiku (legacy)',
      family: 'claude',
      context: 200000,
      output: 8192,
      cost: { input: 0.8, output: 4 },
      capabilities: { toolCall: true, vision: false, reasoning: false, streaming: true, json: true },
      tier: 'legacy',
      deprecated: true,
    },
    {
      id: 'claude-3-opus-20240229',
      label: 'Claude 3 Opus (legacy)',
      family: 'claude',
      context: 200000,
      output: 4096,
      cost: { input: 15, output: 75 },
      capabilities: { toolCall: true, vision: true, reasoning: false, streaming: true, json: true },
      tier: 'legacy',
      deprecated: true,
    },
  ],

  // ────────────────────────────────────────────────────────────────
  openai: [
    {
      id: 'gpt-5.5',
      label: 'GPT-5.5',
      family: 'gpt',
      context: 400000,
      output: 32768,
      cost: { input: 5, output: 15 },
      capabilities: { toolCall: true, vision: true, reasoning: true, streaming: true, json: true },
      tier: 'flagship',
    },
    {
      id: 'gpt-5',
      label: 'GPT-5',
      family: 'gpt',
      context: 400000,
      output: 32768,
      cost: { input: 5, output: 15 },
      capabilities: { toolCall: true, vision: true, reasoning: true, streaming: true, json: true },
      tier: 'flagship',
    },
    {
      id: 'gpt-5-mini',
      label: 'GPT-5 mini',
      family: 'gpt',
      context: 200000,
      output: 16384,
      cost: { input: 0.25, output: 1 },
      capabilities: { toolCall: true, vision: true, reasoning: true, streaming: true, json: true },
      tier: 'fast',
    },
    {
      id: 'gpt-4o',
      label: 'GPT-4o',
      family: 'gpt',
      context: 128000,
      output: 16384,
      cost: { input: 2.5, output: 10 },
      capabilities: { toolCall: true, vision: true, reasoning: false, streaming: true, json: true },
      tier: 'flagship',
    },
    {
      id: 'gpt-4o-mini',
      label: 'GPT-4o mini',
      family: 'gpt',
      context: 128000,
      output: 16384,
      cost: { input: 0.15, output: 0.6 },
      capabilities: { toolCall: true, vision: true, reasoning: false, streaming: true, json: true },
      tier: 'fast',
    },
    {
      id: 'o3',
      label: 'o3',
      family: 'o',
      context: 200000,
      output: 100000,
      cost: { input: 10, output: 40 },
      capabilities: { toolCall: true, vision: true, reasoning: true, streaming: true, json: true },
      tier: 'reasoning',
    },
    {
      id: 'o3-mini',
      label: 'o3 mini',
      family: 'o',
      context: 200000,
      output: 100000,
      cost: { input: 1.1, output: 4.4 },
      capabilities: { toolCall: true, vision: false, reasoning: true, streaming: true, json: true },
      tier: 'reasoning',
    },
    {
      id: 'o4-mini',
      label: 'o4 mini',
      family: 'o',
      context: 200000,
      output: 100000,
      cost: { input: 1.1, output: 4.4 },
      capabilities: { toolCall: true, vision: true, reasoning: true, streaming: true, json: true },
      tier: 'reasoning',
    },
    {
      id: 'gpt-4-turbo',
      label: 'GPT-4 Turbo (legacy)',
      family: 'gpt',
      context: 128000,
      output: 4096,
      cost: { input: 10, output: 30 },
      capabilities: { toolCall: true, vision: true, reasoning: false, streaming: true, json: true },
      tier: 'legacy',
      deprecated: true,
    },
  ],

  // ────────────────────────────────────────────────────────────────
  gemini: [
    {
      id: 'gemini-3-pro',
      label: 'Gemini 3 Pro',
      family: 'gemini',
      context: 2000000,
      output: 64000,
      cost: { input: 1.25, output: 5 },
      capabilities: { toolCall: true, vision: true, reasoning: true, streaming: true, json: true },
      tier: 'flagship',
    },
    {
      id: 'gemini-3-flash',
      label: 'Gemini 3 Flash',
      family: 'gemini',
      context: 1000000,
      output: 64000,
      cost: { input: 0.075, output: 0.3 },
      capabilities: { toolCall: true, vision: true, reasoning: true, streaming: true, json: true },
      tier: 'fast',
    },
    {
      id: 'gemini-3-flash-preview',
      label: 'Gemini 3 Flash (preview)',
      family: 'gemini',
      context: 1000000,
      output: 64000,
      cost: { input: 0.075, output: 0.3 },
      capabilities: { toolCall: true, vision: true, reasoning: true, streaming: true, json: true },
      tier: 'fast',
    },
    {
      id: 'gemini-2.5-pro',
      label: 'Gemini 2.5 Pro',
      family: 'gemini',
      context: 2000000,
      output: 64000,
      cost: { input: 1.25, output: 5 },
      capabilities: { toolCall: true, vision: true, reasoning: true, streaming: true, json: true },
      tier: 'flagship',
    },
    {
      id: 'gemini-2.5-flash',
      label: 'Gemini 2.5 Flash',
      family: 'gemini',
      context: 1000000,
      output: 64000,
      cost: { input: 0.075, output: 0.3 },
      capabilities: { toolCall: true, vision: true, reasoning: true, streaming: true, json: true },
      tier: 'fast',
    },
  ],

  // ────────────────────────────────────────────────────────────────
  mistral: [
    {
      id: 'mistral-large-3',
      label: 'Mistral Large 3',
      family: 'mistral',
      context: 256000,
      output: 32000,
      cost: { input: 2, output: 6 },
      capabilities: { toolCall: true, vision: true, reasoning: true, streaming: true, json: true },
      tier: 'flagship',
    },
    {
      id: 'mistral-vibe-cli-latest',
      label: 'Mistral Vibe CLI (latest)',
      family: 'mistral',
      context: 128000,
      output: 8192,
      cost: { input: 0.2, output: 0.6 },
      capabilities: { toolCall: true, vision: false, reasoning: false, streaming: true, json: true },
      tier: 'fast',
    },
    {
      id: 'codestral-25',
      label: 'Codestral 25',
      family: 'mistral',
      context: 256000,
      output: 32000,
      cost: { input: 0.3, output: 0.9 },
      capabilities: { toolCall: true, vision: false, reasoning: false, streaming: true, json: true },
      tier: 'code',
    },
    {
      id: 'magistral-medium',
      label: 'Magistral Medium',
      family: 'mistral',
      context: 128000,
      output: 32000,
      cost: { input: 2, output: 5 },
      capabilities: { toolCall: true, vision: false, reasoning: true, streaming: true, json: true },
      tier: 'reasoning',
    },
  ],

  // ────────────────────────────────────────────────────────────────
  github: [
    {
      id: 'gpt-5.5',
      label: 'GPT-5.5 (Copilot)',
      family: 'gpt',
      context: 400000,
      output: 32768,
      cost: { input: 0, output: 0 },
      capabilities: { toolCall: true, vision: true, reasoning: true, streaming: true, json: true },
      tier: 'flagship',
      notes: 'Free for Copilot subscribers',
    },
    {
      id: 'claude-sonnet-4-6',
      label: 'Claude Sonnet 4.6 (Copilot)',
      family: 'claude',
      context: 200000,
      output: 64000,
      cost: { input: 0, output: 0 },
      capabilities: { toolCall: true, vision: true, reasoning: true, streaming: true, json: true },
      tier: 'flagship',
    },
    {
      id: 'claude-opus-4-7',
      label: 'Claude Opus 4.7 (Copilot)',
      family: 'claude',
      context: 200000,
      output: 32000,
      cost: { input: 0, output: 0 },
      capabilities: { toolCall: true, vision: true, reasoning: true, streaming: true, json: true },
      tier: 'flagship',
    },
    {
      id: 'gemini-3-pro',
      label: 'Gemini 3 Pro (Copilot)',
      family: 'gemini',
      context: 2000000,
      output: 64000,
      cost: { input: 0, output: 0 },
      capabilities: { toolCall: true, vision: true, reasoning: true, streaming: true, json: true },
      tier: 'flagship',
    },
    {
      id: 'o3',
      label: 'o3 (Copilot)',
      family: 'o',
      context: 200000,
      output: 100000,
      cost: { input: 0, output: 0 },
      capabilities: { toolCall: true, vision: true, reasoning: true, streaming: true, json: true },
      tier: 'reasoning',
    },
    {
      id: 'gpt-4o',
      label: 'GPT-4o (Copilot)',
      family: 'gpt',
      context: 128000,
      output: 16384,
      cost: { input: 0, output: 0 },
      capabilities: { toolCall: true, vision: true, reasoning: false, streaming: true, json: true },
      tier: 'flagship',
    },
  ],

  // ────────────────────────────────────────────────────────────────
  bedrock: [
    {
      id: 'us.anthropic.claude-opus-4-7',
      label: 'Claude Opus 4.7 (Bedrock)',
      family: 'claude',
      context: 200000,
      output: 32000,
      cost: { input: 15, output: 75 },
      capabilities: { toolCall: true, vision: true, reasoning: true, streaming: true, json: true },
      tier: 'flagship',
    },
    {
      id: 'us.anthropic.claude-sonnet-4-6',
      label: 'Claude Sonnet 4.6 (Bedrock)',
      family: 'claude',
      context: 200000,
      output: 64000,
      cost: { input: 3, output: 15 },
      capabilities: { toolCall: true, vision: true, reasoning: true, streaming: true, json: true },
      tier: 'flagship',
    },
    {
      id: 'us.anthropic.claude-3-5-sonnet-20241022-v2:0',
      label: 'Claude 3.5 Sonnet v2 (Bedrock)',
      family: 'claude',
      context: 200000,
      output: 8192,
      cost: { input: 3, output: 15 },
      capabilities: { toolCall: true, vision: true, reasoning: false, streaming: true, json: true },
      tier: 'flagship',
    },
    {
      id: 'amazon.nova-pro-v1:0',
      label: 'Amazon Nova Pro',
      family: 'nova',
      context: 300000,
      output: 5000,
      cost: { input: 0.8, output: 3.2 },
      capabilities: { toolCall: true, vision: true, reasoning: false, streaming: true, json: true },
      tier: 'flagship',
    },
    {
      id: 'amazon.nova-lite-v1:0',
      label: 'Amazon Nova Lite',
      family: 'nova',
      context: 300000,
      output: 5000,
      cost: { input: 0.06, output: 0.24 },
      capabilities: { toolCall: true, vision: true, reasoning: false, streaming: true, json: true },
      tier: 'fast',
    },
    {
      id: 'meta.llama3-3-70b-instruct-v1:0',
      label: 'Llama 3.3 70B (Bedrock)',
      family: 'llama',
      context: 128000,
      output: 8192,
      cost: { input: 0.72, output: 0.72 },
      capabilities: { toolCall: true, vision: false, reasoning: false, streaming: true, json: true },
      tier: 'flagship',
    },
  ],

  // ────────────────────────────────────────────────────────────────
  vertex: [
    {
      id: 'claude-sonnet-4-6@20251001',
      label: 'Claude Sonnet 4.6 (Vertex)',
      family: 'claude',
      context: 200000,
      output: 64000,
      cost: { input: 3, output: 15 },
      capabilities: { toolCall: true, vision: true, reasoning: true, streaming: true, json: true },
      tier: 'flagship',
    },
    {
      id: 'claude-3-5-sonnet@20241022',
      label: 'Claude 3.5 Sonnet (Vertex)',
      family: 'claude',
      context: 200000,
      output: 8192,
      cost: { input: 3, output: 15 },
      capabilities: { toolCall: true, vision: true, reasoning: false, streaming: true, json: true },
      tier: 'flagship',
    },
    {
      id: 'gemini-3-pro',
      label: 'Gemini 3 Pro (Vertex)',
      family: 'gemini',
      context: 2000000,
      output: 64000,
      cost: { input: 1.25, output: 5 },
      capabilities: { toolCall: true, vision: true, reasoning: true, streaming: true, json: true },
      tier: 'flagship',
    },
    {
      id: 'gemini-2.5-pro',
      label: 'Gemini 2.5 Pro (Vertex)',
      family: 'gemini',
      context: 2000000,
      output: 64000,
      cost: { input: 1.25, output: 5 },
      capabilities: { toolCall: true, vision: true, reasoning: true, streaming: true, json: true },
      tier: 'flagship',
    },
  ],

  // ────────────────────────────────────────────────────────────────
  'nvidia-nim': [
    {
      id: 'meta/llama-3.1-70b-instruct',
      label: 'Llama 3.1 70B',
      family: 'llama',
      context: 128000,
      output: 8192,
      cost: { input: 0, output: 0 },
      capabilities: { toolCall: true, vision: false, reasoning: false, streaming: true, json: true },
      tier: 'flagship',
      notes: 'NIM free tier',
    },
    {
      id: 'meta/llama-3.1-405b-instruct',
      label: 'Llama 3.1 405B',
      family: 'llama',
      context: 128000,
      output: 8192,
      cost: { input: 0, output: 0 },
      capabilities: { toolCall: true, vision: false, reasoning: false, streaming: true, json: true },
      tier: 'flagship',
    },
    {
      id: 'meta/llama-3.3-70b-instruct',
      label: 'Llama 3.3 70B',
      family: 'llama',
      context: 128000,
      output: 8192,
      cost: { input: 0, output: 0 },
      capabilities: { toolCall: true, vision: false, reasoning: false, streaming: true, json: true },
      tier: 'flagship',
    },
    {
      id: 'nvidia/cosmos-reason2-8b',
      label: 'Cosmos Reason 2 8B',
      family: 'cosmos',
      context: 128000,
      output: 8192,
      cost: { input: 0, output: 0 },
      capabilities: { toolCall: false, vision: true, reasoning: true, streaming: true, json: true },
      tier: 'reasoning',
    },
    {
      id: 'qwen/qwen3-next-80b-a3b-thinking',
      label: 'Qwen 3 Next 80B Thinking',
      family: 'qwen',
      context: 128000,
      output: 16384,
      cost: { input: 0, output: 0 },
      capabilities: { toolCall: true, vision: false, reasoning: true, streaming: true, json: true },
      tier: 'reasoning',
    },
    {
      id: 'qwen/qwq-32b',
      label: 'QwQ 32B Reasoning',
      family: 'qwen',
      context: 32768,
      output: 8192,
      cost: { input: 0, output: 0 },
      capabilities: { toolCall: true, vision: false, reasoning: true, streaming: true, json: true },
      tier: 'reasoning',
    },
    {
      id: 'qwen/qwen3-coder-480b-a35b-instruct',
      label: 'Qwen 3 Coder 480B',
      family: 'qwen',
      context: 262144,
      output: 32768,
      cost: { input: 0, output: 0 },
      capabilities: { toolCall: true, vision: false, reasoning: false, streaming: true, json: true },
      tier: 'code',
    },
    {
      id: 'qwen/qwen2.5-coder-32b-instruct',
      label: 'Qwen 2.5 Coder 32B',
      family: 'qwen',
      context: 32768,
      output: 8192,
      cost: { input: 0, output: 0 },
      capabilities: { toolCall: true, vision: false, reasoning: false, streaming: true, json: true },
      tier: 'code',
    },
    {
      id: 'deepseek-ai/deepseek-r1',
      label: 'DeepSeek R1',
      family: 'deepseek',
      context: 128000,
      output: 32768,
      cost: { input: 0, output: 0 },
      capabilities: { toolCall: true, vision: false, reasoning: true, streaming: true, json: true },
      tier: 'reasoning',
    },
    {
      id: 'mistralai/codestral-22b-instruct-v0.1',
      label: 'Codestral 22B',
      family: 'mistral',
      context: 32768,
      output: 8192,
      cost: { input: 0, output: 0 },
      capabilities: { toolCall: true, vision: false, reasoning: false, streaming: true, json: true },
      tier: 'code',
    },
  ],

  // ────────────────────────────────────────────────────────────────
  minimax: [
    {
      id: 'MiniMax-M3',
      label: 'MiniMax M3',
      family: 'minimax',
      context: 128000,
      output: 16384,
      cost: { input: 0.5, output: 1.5 },
      capabilities: { toolCall: true, vision: true, reasoning: true, streaming: true, json: true },
      tier: 'flagship',
    },
    {
      id: 'MiniMax-Text-01',
      label: 'MiniMax Text 01',
      family: 'minimax',
      context: 128000,
      output: 16384,
      cost: { input: 0.5, output: 1.5 },
      capabilities: { toolCall: true, vision: false, reasoning: false, streaming: true, json: true },
      tier: 'flagship',
    },
  ],

  // ────────────────────────────────────────────────────────────────
  xai: [
    {
      id: 'grok-4',
      label: 'Grok 4',
      family: 'grok',
      context: 256000,
      output: 32768,
      cost: { input: 5, output: 15 },
      capabilities: { toolCall: true, vision: true, reasoning: true, streaming: true, json: true },
      tier: 'flagship',
    },
    {
      id: 'grok-3',
      label: 'Grok 3',
      family: 'grok',
      context: 131072,
      output: 16384,
      cost: { input: 3, output: 15 },
      capabilities: { toolCall: true, vision: false, reasoning: false, streaming: true, json: true },
      tier: 'flagship',
    },
    {
      id: 'grok-3-mini',
      label: 'Grok 3 mini',
      family: 'grok',
      context: 131072,
      output: 16384,
      cost: { input: 0.3, output: 0.5 },
      capabilities: { toolCall: true, vision: false, reasoning: true, streaming: true, json: true },
      tier: 'fast',
    },
    {
      id: 'grok-2-latest',
      label: 'Grok 2 (latest)',
      family: 'grok',
      context: 131072,
      output: 16384,
      cost: { input: 5, output: 15 },
      capabilities: { toolCall: true, vision: false, reasoning: false, streaming: true, json: true },
      tier: 'flagship',
    },
  ],

  // ────────────────────────────────────────────────────────────────
  ollama: [
    {
      id: 'llama3.2',
      label: 'Llama 3.2',
      family: 'llama',
      context: 32000,
      output: 8192,
      cost: { input: 0, output: 0 },
      capabilities: { toolCall: true, vision: false, reasoning: false, streaming: true, json: true },
      tier: 'local',
      notes: 'Local — set OLLAMA_API_KEY=ollama or leave empty',
    },
    {
      id: 'qwen2.5-coder:32b',
      label: 'Qwen 2.5 Coder 32B',
      family: 'qwen',
      context: 32000,
      output: 8192,
      cost: { input: 0, output: 0 },
      capabilities: { toolCall: true, vision: false, reasoning: false, streaming: true, json: true },
      tier: 'code',
    },
    {
      id: 'deepseek-r1:32b',
      label: 'DeepSeek R1 32B',
      family: 'deepseek',
      context: 32000,
      output: 8192,
      cost: { input: 0, output: 0 },
      capabilities: { toolCall: true, vision: false, reasoning: true, streaming: true, json: true },
      tier: 'reasoning',
    },
    {
      id: 'llama3.1:70b',
      label: 'Llama 3.1 70B',
      family: 'llama',
      context: 128000,
      output: 8192,
      cost: { input: 0, output: 0 },
      capabilities: { toolCall: true, vision: false, reasoning: false, streaming: true, json: true },
      tier: 'flagship',
    },
    {
      id: 'mistral',
      label: 'Mistral 7B',
      family: 'mistral',
      context: 32000,
      output: 8192,
      cost: { input: 0, output: 0 },
      capabilities: { toolCall: true, vision: false, reasoning: false, streaming: true, json: true },
      tier: 'fast',
    },
  ],

  // ────────────────────────────────────────────────────────────────
  opencode: [
    {
      id: 'qwen3-coder',
      label: 'Qwen 3 Coder',
      family: 'qwen',
      context: 262144,
      output: 32768,
      cost: { input: 0, output: 0 },
      capabilities: { toolCall: true, vision: false, reasoning: false, streaming: true, json: true },
      tier: 'code',
      notes: 'Free in OpenCode Zen',
    },
    {
      id: 'gpt-5',
      label: 'GPT-5 (OpenCode Zen)',
      family: 'gpt',
      context: 400000,
      output: 32768,
      cost: { input: 0, output: 0 },
      capabilities: { toolCall: true, vision: true, reasoning: true, streaming: true, json: true },
      tier: 'flagship',
    },
    {
      id: 'claude-sonnet-4-6',
      label: 'Claude Sonnet 4.6 (OpenCode Zen)',
      family: 'claude',
      context: 200000,
      output: 64000,
      cost: { input: 0, output: 0 },
      capabilities: { toolCall: true, vision: true, reasoning: true, streaming: true, json: true },
      tier: 'flagship',
    },
    {
      id: 'big-pickle',
      label: 'Big Pickle (stealth)',
      family: 'stealth',
      context: 200000,
      output: 32768,
      cost: { input: 0, output: 0 },
      capabilities: { toolCall: true, vision: false, reasoning: true, streaming: true, json: true },
      tier: 'flagship',
      notes: 'OpenCode stealth model',
    },
  ],

  // ────────────────────────────────────────────────────────────────
  codex: [
    {
      id: 'gpt-5.5-codex',
      label: 'GPT-5.5 Codex',
      family: 'gpt',
      context: 400000,
      output: 32768,
      cost: { input: 5, output: 15 },
      capabilities: { toolCall: true, vision: true, reasoning: true, streaming: true, json: true },
      tier: 'code',
    },
    {
      id: 'gpt-5.5',
      label: 'GPT-5.5 (Codex)',
      family: 'gpt',
      context: 400000,
      output: 32768,
      cost: { input: 5, output: 15 },
      capabilities: { toolCall: true, vision: true, reasoning: true, streaming: true, json: true },
      tier: 'flagship',
    },
    {
      id: 'o3',
      label: 'o3 (Codex)',
      family: 'o',
      context: 200000,
      output: 100000,
      cost: { input: 10, output: 40 },
      capabilities: { toolCall: true, vision: true, reasoning: true, streaming: true, json: true },
      tier: 'reasoning',
    },
  ],

  // ────────────────────────────────────────────────────────────────
  'xiaomi-mimo': [
    {
      id: 'mimo-v2.5-pro',
      label: 'MiMo v2.5 Pro',
      family: 'mimo',
      context: 128000,
      output: 16384,
      cost: { input: 0.5, output: 1.5 },
      capabilities: { toolCall: true, vision: true, reasoning: true, streaming: true, json: true },
      tier: 'flagship',
    },
    {
      id: 'mimo-v2',
      label: 'MiMo v2',
      family: 'mimo',
      context: 128000,
      output: 16384,
      cost: { input: 0.3, output: 1 },
      capabilities: { toolCall: true, vision: false, reasoning: false, streaming: true, json: true },
      tier: 'fast',
    },
  ],

  // ────────────────────────────────────────────────────────────────
  groq: [
    {
      id: 'llama-3.3-70b-versatile',
      label: 'Llama 3.3 70B Versatile',
      family: 'llama',
      context: 128000,
      output: 32768,
      cost: { input: 0.59, output: 0.79 },
      capabilities: { toolCall: true, vision: false, reasoning: false, streaming: true, json: true },
      tier: 'flagship',
      notes: 'Groq — ultra-fast inference',
    },
    {
      id: 'llama-3.1-8b-instant',
      label: 'Llama 3.1 8B Instant',
      family: 'llama',
      context: 128000,
      output: 8192,
      cost: { input: 0.05, output: 0.08 },
      capabilities: { toolCall: true, vision: false, reasoning: false, streaming: true, json: true },
      tier: 'fast',
    },
    {
      id: 'mixtral-8x7b-32768',
      label: 'Mixtral 8x7B',
      family: 'mixtral',
      context: 32768,
      output: 8192,
      cost: { input: 0.24, output: 0.24 },
      capabilities: { toolCall: true, vision: false, reasoning: false, streaming: true, json: true },
      tier: 'flagship',
    },
    {
      id: 'deepseek-r1-distill-llama-70b',
      label: 'DeepSeek R1 Distill Llama 70B',
      family: 'deepseek',
      context: 128000,
      output: 16384,
      cost: { input: 0.59, output: 0.79 },
      capabilities: { toolCall: true, vision: false, reasoning: true, streaming: true, json: true },
      tier: 'reasoning',
    },
  ],

  // ────────────────────────────────────────────────────────────────
  cerebras: [
    {
      id: 'llama-3.3-70b',
      label: 'Llama 3.3 70B (Cerebras)',
      family: 'llama',
      context: 128000,
      output: 8192,
      cost: { input: 0.85, output: 0.85 },
      capabilities: { toolCall: true, vision: false, reasoning: false, streaming: true, json: true },
      tier: 'flagship',
      notes: 'Cerebras — fast inference',
    },
    {
      id: 'llama-3.1-8b',
      label: 'Llama 3.1 8B (Cerebras)',
      family: 'llama',
      context: 128000,
      output: 8192,
      cost: { input: 0.1, output: 0.1 },
      capabilities: { toolCall: true, vision: false, reasoning: false, streaming: true, json: true },
      tier: 'fast',
    },
  ],

  // ────────────────────────────────────────────────────────────────
  deepseek: [
    {
      id: 'deepseek-chat',
      label: 'DeepSeek V3 (chat)',
      family: 'deepseek',
      context: 128000,
      output: 8192,
      cost: { input: 0.27, output: 1.1 },
      capabilities: { toolCall: true, vision: false, reasoning: false, streaming: true, json: true },
      tier: 'flagship',
    },
    {
      id: 'deepseek-reasoner',
      label: 'DeepSeek R1 (reasoner)',
      family: 'deepseek',
      context: 128000,
      output: 32768,
      cost: { input: 0.55, output: 2.19 },
      capabilities: { toolCall: true, vision: false, reasoning: true, streaming: true, json: true },
      tier: 'reasoning',
    },
    {
      id: 'deepseek-coder',
      label: 'DeepSeek Coder V2',
      family: 'deepseek',
      context: 128000,
      output: 8192,
      cost: { input: 0.27, output: 1.1 },
      capabilities: { toolCall: true, vision: false, reasoning: false, streaming: true, json: true },
      tier: 'code',
    },
  ],

  // ────────────────────────────────────────────────────────────────
  openrouter: [
    {
      id: 'anthropic/claude-sonnet-4-6',
      label: 'Claude Sonnet 4.6 (via OpenRouter)',
      family: 'claude',
      context: 200000,
      output: 64000,
      cost: { input: 3, output: 15 },
      capabilities: { toolCall: true, vision: true, reasoning: true, streaming: true, json: true },
      tier: 'flagship',
    },
    {
      id: 'openai/gpt-5.5',
      label: 'GPT-5.5 (via OpenRouter)',
      family: 'gpt',
      context: 400000,
      output: 32768,
      cost: { input: 5, output: 15 },
      capabilities: { toolCall: true, vision: true, reasoning: true, streaming: true, json: true },
      tier: 'flagship',
    },
    {
      id: 'google/gemini-3-pro',
      label: 'Gemini 3 Pro (via OpenRouter)',
      family: 'gemini',
      context: 2000000,
      output: 64000,
      cost: { input: 1.25, output: 5 },
      capabilities: { toolCall: true, vision: true, reasoning: true, streaming: true, json: true },
      tier: 'flagship',
    },
    {
      id: 'meta-llama/llama-3.3-70b-instruct',
      label: 'Llama 3.3 70B (via OpenRouter)',
      family: 'llama',
      context: 128000,
      output: 8192,
      cost: { input: 0.1, output: 0.1 },
      capabilities: { toolCall: true, vision: false, reasoning: false, streaming: true, json: true },
      tier: 'flagship',
    },
    {
      id: 'qwen/qwen-2.5-coder-32b-instruct',
      label: 'Qwen 2.5 Coder 32B (via OpenRouter)',
      family: 'qwen',
      context: 32768,
      output: 8192,
      cost: { input: 0.18, output: 0.18 },
      capabilities: { toolCall: true, vision: false, reasoning: false, streaming: true, json: true },
      tier: 'code',
    },
  ],

  // ────────────────────────────────────────────────────────────────
  together: [
    {
      id: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
      label: 'Llama 3.3 70B Turbo',
      family: 'llama',
      context: 128000,
      output: 8192,
      cost: { input: 0.88, output: 0.88 },
      capabilities: { toolCall: true, vision: false, reasoning: false, streaming: true, json: true },
      tier: 'flagship',
    },
    {
      id: 'Qwen/Qwen2.5-Coder-32B-Instruct',
      label: 'Qwen 2.5 Coder 32B',
      family: 'qwen',
      context: 32768,
      output: 8192,
      cost: { input: 0.8, output: 0.8 },
      capabilities: { toolCall: true, vision: false, reasoning: false, streaming: true, json: true },
      tier: 'code',
    },
    {
      id: 'deepseek-ai/DeepSeek-R1',
      label: 'DeepSeek R1',
      family: 'deepseek',
      context: 64000,
      output: 32768,
      cost: { input: 3, output: 7 },
      capabilities: { toolCall: true, vision: false, reasoning: true, streaming: true, json: true },
      tier: 'reasoning',
    },
  ],

  // ────────────────────────────────────────────────────────────────
  fireworks: [
    {
      id: 'accounts/fireworks/models/llama-v3p3-70b-instruct',
      label: 'Llama 3.3 70B (Fireworks)',
      family: 'llama',
      context: 128000,
      output: 8192,
      cost: { input: 0.9, output: 0.9 },
      capabilities: { toolCall: true, vision: false, reasoning: false, streaming: true, json: true },
      tier: 'flagship',
    },
    {
      id: 'accounts/fireworks/models/deepseek-r1',
      label: 'DeepSeek R1 (Fireworks)',
      family: 'deepseek',
      context: 128000,
      output: 32768,
      cost: { input: 3, output: 8 },
      capabilities: { toolCall: true, vision: false, reasoning: true, streaming: true, json: true },
      tier: 'reasoning',
    },
    {
      id: 'accounts/fireworks/models/qwen2p5-coder-32b-instruct',
      label: 'Qwen 2.5 Coder 32B (Fireworks)',
      family: 'qwen',
      context: 32768,
      output: 8192,
      cost: { input: 0.9, output: 0.9 },
      capabilities: { toolCall: true, vision: false, reasoning: false, streaming: true, json: true },
      tier: 'code',
    },
  ],

  // ────────────────────────────────────────────────────────────────
  perplexity: [
    {
      id: 'sonar-pro',
      label: 'Sonar Pro',
      family: 'sonar',
      context: 200000,
      output: 8192,
      cost: { input: 3, output: 15 },
      capabilities: { toolCall: false, vision: false, reasoning: false, streaming: true, json: true },
      tier: 'flagship',
      notes: 'Search-augmented, web access',
    },
    {
      id: 'sonar',
      label: 'Sonar',
      family: 'sonar',
      context: 127000,
      output: 8192,
      cost: { input: 1, output: 1 },
      capabilities: { toolCall: false, vision: false, reasoning: false, streaming: true, json: true },
      tier: 'fast',
    },
    {
      id: 'sonar-reasoning',
      label: 'Sonar Reasoning',
      family: 'sonar',
      context: 127000,
      output: 8192,
      cost: { input: 1, output: 5 },
      capabilities: { toolCall: false, vision: false, reasoning: true, streaming: true, json: true },
      tier: 'reasoning',
    },
  ],

  // ────────────────────────────────────────────────────────────────
  huggingface: [
    {
      id: 'meta-llama/Llama-3.3-70B-Instruct',
      label: 'Llama 3.3 70B (HF)',
      family: 'llama',
      context: 8000,
      output: 4096,
      cost: { input: 0, output: 0 },
      capabilities: { toolCall: false, vision: false, reasoning: false, streaming: true, json: true },
      tier: 'flagship',
      notes: 'HF free inference tier',
    },
    {
      id: 'mistralai/Mistral-7B-Instruct-v0.3',
      label: 'Mistral 7B (HF)',
      family: 'mistral',
      context: 8000,
      output: 4096,
      cost: { input: 0, output: 0 },
      capabilities: { toolCall: false, vision: false, reasoning: false, streaming: true, json: true },
      tier: 'fast',
    },
  ],

  // ────────────────────────────────────────────────────────────────
  qoder: [
    {
      id: 'qoder-large',
      label: 'Qoder Large',
      family: 'qoder',
      context: 200000,
      output: 32768,
      cost: { input: 2, output: 8 },
      capabilities: { toolCall: true, vision: true, reasoning: true, streaming: true, json: true },
      tier: 'flagship',
    },
    {
      id: 'qoder-fast',
      label: 'Qoder Fast',
      family: 'qoder',
      context: 128000,
      output: 16384,
      cost: { input: 0.5, output: 2 },
      capabilities: { toolCall: true, vision: false, reasoning: false, streaming: true, json: true },
      tier: 'fast',
    },
  ],

  kiro: [
    {
      id: 'kiro-coder',
      label: 'Kiro Coder',
      family: 'kiro',
      context: 200000,
      output: 32768,
      cost: { input: 2, output: 8 },
      capabilities: { toolCall: true, vision: true, reasoning: true, streaming: true, json: true },
      tier: 'code',
    },
  ],

  antigravity: [
    {
      id: 'gemini-2.5-flash',
      label: 'Gemini 2.5 Flash (Antigravity)',
      family: 'gemini',
      context: 1048576,
      output: 65536,
      cost: { input: 0, output: 0 },
      capabilities: { toolCall: true, vision: true, reasoning: true, streaming: true, json: true },
      tier: 'fast',
      notes: 'Free via Antigravity OAuth',
    },
  ],

  'gemini-cli': [
    {
      id: 'gemini-2.5-flash',
      label: 'Gemini 2.5 Flash (CLI)',
      family: 'gemini',
      context: 1048576,
      output: 65536,
      cost: { input: 0, output: 0 },
      capabilities: { toolCall: true, vision: true, reasoning: true, streaming: true, json: true },
      tier: 'fast',
      notes: 'Free via Gemini API key or OAuth',
    },
  ],

  azure: [
    { id: 'gpt-4o', label: 'GPT-4o (Azure)', family: 'gpt', context: 128000, output: 16384, cost: { input: 2.5, output: 10 }, capabilities: { toolCall: true, vision: true, reasoning: false, streaming: true, json: true }, tier: 'flagship' },
  ],
  cohere: [
    { id: 'command-a-03-2025', label: 'Command A', family: 'command', context: 128000, output: 4096, cost: { input: 2.5, output: 10 }, capabilities: { toolCall: true, vision: true, reasoning: false, streaming: true, json: true }, tier: 'flagship' },
    { id: 'command-r-plus-08-2024', label: 'Command R+', family: 'command', context: 128000, output: 4096, cost: { input: 2.5, output: 10 }, capabilities: { toolCall: true, vision: false, reasoning: false, streaming: true, json: true }, tier: 'flagship' },
  ],
  nebius: [
    { id: 'meta-llama/Llama-3.3-70B-Instruct', label: 'Llama 3.3 70B', family: 'llama', context: 128000, output: 8192, cost: { input: 0.5, output: 0.5 }, capabilities: { toolCall: true, vision: false, reasoning: false, streaming: true, json: true }, tier: 'flagship' },
  ],
  'cloudflare-ai': [
    { id: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', label: 'Llama 3.3 70B (CF)', family: 'llama', context: 128000, output: 8192, cost: { input: 0, output: 0 }, capabilities: { toolCall: true, vision: false, reasoning: false, streaming: true, json: true }, tier: 'flagship', notes: 'Free tier' },
    { id: '@cf/deepseek-ai/deepseek-r1-distill-qwen-32b', label: 'DeepSeek R1 32B (CF)', family: 'deepseek', context: 128000, output: 8192, cost: { input: 0, output: 0 }, capabilities: { toolCall: true, vision: false, reasoning: true, streaming: true, json: true }, tier: 'reasoning', notes: 'Free tier' },
  ],
  siliconflow: [
    { id: 'deepseek-ai/DeepSeek-V3.2', label: 'DeepSeek V3.2', family: 'deepseek', context: 128000, output: 8192, cost: { input: 0.14, output: 0.28 }, capabilities: { toolCall: true, vision: false, reasoning: false, streaming: true, json: true }, tier: 'flagship' },
    { id: 'Qwen/Qwen3.5-397B-A17B', label: 'Qwen 3.5 397B', family: 'qwen', context: 262144, output: 32768, cost: { input: 0.5, output: 2 }, capabilities: { toolCall: true, vision: false, reasoning: true, streaming: true, json: true }, tier: 'flagship' },
  ],
  hyperbolic: [
    { id: 'meta-llama/Llama-3.3-70B-Instruct', label: 'Llama 3.3 70B', family: 'llama', context: 128000, output: 8192, cost: { input: 0.4, output: 0.4 }, capabilities: { toolCall: true, vision: false, reasoning: false, streaming: true, json: true }, tier: 'flagship' },
    { id: 'deepseek-ai/DeepSeek-R1', label: 'DeepSeek R1', family: 'deepseek', context: 128000, output: 32768, cost: { input: 0.55, output: 2.19 }, capabilities: { toolCall: true, vision: false, reasoning: true, streaming: true, json: true }, tier: 'reasoning' },
  ],
  chutes: [
    { id: 'deepseek-ai/DeepSeek-R1', label: 'DeepSeek R1', family: 'deepseek', context: 128000, output: 32768, cost: { input: 0.55, output: 2.19 }, capabilities: { toolCall: true, vision: false, reasoning: true, streaming: true, json: true }, tier: 'reasoning' },
  ],
  glm: [
    { id: 'glm-4-plus', label: 'GLM 4 Plus', family: 'glm', context: 128000, output: 4096, cost: { input: 0.5, output: 2 }, capabilities: { toolCall: true, vision: false, reasoning: false, streaming: true, json: true }, tier: 'flagship' },
    { id: 'glm-4v', label: 'GLM 4V (Vision)', family: 'glm', context: 128000, output: 4096, cost: { input: 0.75, output: 3 }, capabilities: { toolCall: true, vision: true, reasoning: false, streaming: true, json: true }, tier: 'flagship' },
  ],
  kimi: [
    { id: 'moonshot-v1-128k', label: 'Moonshot V1 128K', family: 'kimi', context: 128000, output: 4096, cost: { input: 1, output: 4 }, capabilities: { toolCall: true, vision: false, reasoning: false, streaming: true, json: true }, tier: 'flagship' },
    { id: 'kimi-k2.5', label: 'Kimi K2.5', family: 'kimi', context: 128000, output: 8192, cost: { input: 1, output: 4 }, capabilities: { toolCall: true, vision: true, reasoning: true, streaming: true, json: true }, tier: 'flagship' },
  ],
  cline: [
    { id: 'anthropic/claude-sonnet-4-20250514', label: 'Claude Sonnet 4 (Cline)', family: 'claude', context: 200000, output: 8192, cost: { input: 3, output: 15 }, capabilities: { toolCall: true, vision: true, reasoning: true, streaming: true, json: true }, tier: 'flagship' },
  ],
  codebuddy: [
    { id: 'hunyuan-turbos-latest', label: 'Hunyuan TurboS', family: 'hunyuan', context: 256000, output: 8192, cost: { input: 0, output: 0 }, capabilities: { toolCall: true, vision: false, reasoning: false, streaming: true, json: true }, tier: 'flagship' },
  ],
  kilocode: [
    { id: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4 (Kilo)', family: 'claude', context: 200000, output: 8192, cost: { input: 3, output: 15 }, capabilities: { toolCall: true, vision: true, reasoning: true, streaming: true, json: true }, tier: 'flagship' },
  ],
  commandcode: [
    { id: 'deepseek-ai/deepseek-chat', label: 'DeepSeek Chat', family: 'deepseek', context: 128000, output: 8192, cost: { input: 0.27, output: 1.1 }, capabilities: { toolCall: true, vision: false, reasoning: false, streaming: true, json: true }, tier: 'flagship' },
  ],
  blackbox: [
    { id: 'blackboxai', label: 'Blackbox AI', family: 'blackbox', context: 128000, output: 4096, cost: { input: 0, output: 0 }, capabilities: { toolCall: true, vision: false, reasoning: false, streaming: true, json: true }, tier: 'flagship' },
  ],
  'vercel-ai': [
    { id: 'openai/gpt-4o', label: 'GPT-4o (Vercel)', family: 'gpt', context: 128000, output: 16384, cost: { input: 2.5, output: 10 }, capabilities: { toolCall: true, vision: true, reasoning: false, streaming: true, json: true }, tier: 'flagship' },
  ],
  volcengine: [
    { id: 'deepseek-v3', label: 'DeepSeek V3 (Volc)', family: 'deepseek', context: 128000, output: 8192, cost: { input: 0.14, output: 0.28 }, capabilities: { toolCall: true, vision: false, reasoning: false, streaming: true, json: true }, tier: 'flagship' },
  ],
  'opencode-go': [
    { id: 'gpt-4o', label: 'GPT-4o (OpenCode Go)', family: 'gpt', context: 128000, output: 16384, cost: { input: 2.5, output: 10 }, capabilities: { toolCall: true, vision: true, reasoning: false, streaming: true, json: true }, tier: 'flagship' },
  ],
  'mimo-free': [
    { id: 'mimo-v2', label: 'MiMo V2 (Free)', family: 'mimo', context: 128000, output: 16384, cost: { input: 0, output: 0 }, capabilities: { toolCall: true, vision: false, reasoning: false, streaming: true, json: true }, tier: 'fast', notes: 'Free tier' },
  ],
  'xiaomi-tokenplan': [
    { id: 'mimo-v2.5-pro', label: 'MiMo V2.5 Pro', family: 'mimo', context: 128000, output: 16384, cost: { input: 0.5, output: 1.5 }, capabilities: { toolCall: true, vision: true, reasoning: true, streaming: true, json: true }, tier: 'flagship' },
  ],

  custom: [
    {
      id: 'MiniMax-M3',
      label: 'MiniMax M3 (TokenRouter)',
      family: 'minimax',
      context: 128000,
      output: 16384,
      cost: { input: 0.5, output: 1.5 },
      capabilities: { toolCall: true, vision: true, reasoning: true, streaming: true, json: true },
      tier: 'flagship',
      notes: 'TokenRouter default',
    },
    {
      id: 'auto',
      label: 'Auto (provider picks)',
      family: 'auto',
      context: 128000,
      output: 16384,
      cost: { input: 0.5, output: 1.5 },
      capabilities: { toolCall: true, vision: true, reasoning: true, streaming: true, json: true },
      tier: 'fast',
    },
  ],
};

// ────────────────────────────────────────────────────────────────
// Public API

/** Get all models for a provider. */
export function getModels(providerId: ProviderId): ModelInfo[] {
  return MODELS[providerId] || [];
}

/** Get a specific model by provider + model id. */
export function getModel(providerId: ProviderId, modelId: string): ModelInfo | undefined {
  return MODELS[providerId]?.find((m) => m.id === modelId);
}

/** Resolve a model id to its pricing, falling back to a sensible default. */
export function getModelCost(providerId: ProviderId, modelId: string): { input: number; output: number } {
  const m = getModel(providerId, modelId);
  if (m) return m.cost;
  // Unknown model: fall back to provider default
  const fallback: Record<string, { input: number; output: number }> = {
    anthropic: { input: 3, output: 15 },
    openai: { input: 2.5, output: 10 },
    gemini: { input: 0.5, output: 1.5 },
    mistral: { input: 0.2, output: 0.6 },
    github: { input: 0, output: 0 },
    bedrock: { input: 3, output: 15 },
    vertex: { input: 1.25, output: 5 },
    'nvidia-nim': { input: 0, output: 0 },
    minimax: { input: 0.5, output: 1.5 },
    xai: { input: 5, output: 15 },
    ollama: { input: 0, output: 0 },
    opencode: { input: 0, output: 0 },
    codex: { input: 5, output: 15 },
    'xiaomi-mimo': { input: 0.5, output: 1.5 },
    groq: { input: 0.59, output: 0.79 },
    cerebras: { input: 0.85, output: 0.85 },
    deepseek: { input: 0.27, output: 1.1 },
    openrouter: { input: 0.5, output: 1.5 },
    together: { input: 0.88, output: 0.88 },
    fireworks: { input: 0.9, output: 0.9 },
    perplexity: { input: 3, output: 15 },
    huggingface: { input: 0, output: 0 },
    qoder: { input: 2, output: 8 },
    kiro: { input: 2, output: 8 },
    antigravity: { input: 0, output: 0 },
    'gemini-cli': { input: 0, output: 0 },
    azure: { input: 2.5, output: 10 },
    cohere: { input: 2.5, output: 10 },
    nebius: { input: 0.5, output: 0.5 },
    'cloudflare-ai': { input: 0, output: 0 },
    siliconflow: { input: 0.14, output: 0.28 },
    hyperbolic: { input: 0.4, output: 0.4 },
    chutes: { input: 0.55, output: 2.19 },
    glm: { input: 0.5, output: 2 },
    kimi: { input: 1, output: 4 },
    cline: { input: 3, output: 15 },
    codebuddy: { input: 0, output: 0 },
    kilocode: { input: 3, output: 15 },
    commandcode: { input: 0.27, output: 1.1 },
    blackbox: { input: 0, output: 0 },
    'vercel-ai': { input: 2.5, output: 10 },
    volcengine: { input: 0.14, output: 0.28 },
    'opencode-go': { input: 2.5, output: 10 },
    'mimo-free': { input: 0, output: 0 },
    'xiaomi-tokenplan': { input: 0.5, output: 1.5 },
    custom: { input: 0.5, output: 1.5 },
  };
  return fallback[providerId] || { input: 0.5, output: 1.5 };
}

/** Count total registered models across all providers. */
export function totalModelCount(): number {
  return Object.values(MODELS).reduce((sum, arr) => sum + arr.length, 0);
}

/** Get the default model id for a provider. */
export function getDefaultModel(providerId: ProviderId): string {
  return MODELS[providerId]?.[0]?.id || '';
}

/** Filter models by tier (e.g. 'flagship', 'fast', 'code'). */
export function getModelsByTier(providerId: ProviderId, tier: ModelInfo['tier']): ModelInfo[] {
  return MODELS[providerId]?.filter((m) => m.tier === tier) || [];
}

/** Get a list of all available model ids across all providers. */
export function listAllModelIds(): string[] {
  return Object.values(MODELS).flatMap((arr) => arr.map((m) => m.id));
}
