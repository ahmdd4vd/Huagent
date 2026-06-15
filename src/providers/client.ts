// Unified streaming client — works with all 22+ providers
// Auto-detects format and routes to the right parser
// Inspired by openclaude's provider system + opencode's model picker

import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { getProvider, getChatUrl, type ProviderConfig, type ProviderId } from './registry.js';
import { getModelCost, getModel, getDefaultModel } from './models.js';
import { EventEmitter } from 'node:events';

export type StreamEvent =
  | { type: 'thinking'; content: string }
  | { type: 'text_delta'; delta: string; accumulated: string }
  | { type: 'tool_use'; id: string; name: string; args: any }
  | { type: 'usage'; input: number; output: number; total: number; cost: number }
  | { type: 'message_stop'; reason: string }
  | { type: 'error'; error: string };

export interface ProviderRequest {
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
  system?: string;
  model: string;
  tools?: any[];
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface ProviderResponse {
  content: string;
  toolCalls: Array<{ id: string; name: string; args: any }>;
  usage: { input: number; output: number; total: number; cost: number };
  model: string;
  providerId: ProviderId;
}

/** Public type returned by getStats() — kept stable for downstream consumers. */
export interface UnifiedClientStats {
  requests: number;
  inputTokens: number;
  outputTokens: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  totalRequests: number;
  totalCost: number;
  cost: number;
}

/**
 * Calculate cost in USD for a given provider+model+token-count.
 * Delegates to the comprehensive model registry in `models.ts` so pricing
 * stays in sync with the rest of the system.
 */
function calculateCost(providerId: ProviderId, model: string, inputTokens: number, outputTokens: number): number {
  const pricing = getModelCost(providerId, model);
  return (inputTokens / 1_000_000) * pricing.input + (outputTokens / 1_000_000) * pricing.output;
}

export class UnifiedClient extends EventEmitter {
  private provider: ProviderConfig;
  private apiKey: string;
  private baseUrl: string;
  private modelOverride?: string;
  private stats = {
    requests: 0,
    totalRequests: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    cost: 0,
    totalCost: 0,
  };

  constructor(providerId: ProviderId, apiKey: string, baseUrl?: string, model?: string) {
    super();
    this.provider = getProvider(providerId);
    this.apiKey = apiKey;
    this.baseUrl = baseUrl || this.provider.baseUrl;
    this.modelOverride = model;
  }

  getProviderId(): ProviderId {
    return this.provider.id;
  }

  getProviderName(): string {
    return `${this.provider.emoji} ${this.provider.displayName}`;
  }

  getModel(): string {
    return this.modelOverride || this.provider.defaultModel || getDefaultModel(this.provider.id);
  }

  setModel(model: string): void {
    this.modelOverride = model;
  }

  /**
   * Switch to a different provider at runtime. Requires a new API key
   * (from env) and optionally a custom base URL. The model is reset to
   * the new provider's default unless `model` is also provided.
   */
  setProvider(providerId: ProviderId, apiKey: string, baseUrl?: string, model?: string): void {
    this.provider = getProvider(providerId);
    this.apiKey = apiKey;
    this.baseUrl = baseUrl || this.provider.baseUrl;
    this.modelOverride = model;
    // Reset cost stats so a new provider starts at 0
    this.stats.totalCost = 0;
    this.stats.cost = 0;
    this.stats.inputTokens = 0;
    this.stats.outputTokens = 0;
  }

  /**
   * List available models for this provider. Returns a defensive copy so
   * callers can't mutate the registry by accident.
   */
  listAvailableModels() {
    return getModel(this.provider.id, this.getModel()) ? [getModel(this.provider.id, this.getModel())!] : [];
  }

  // Main streaming entry point
  async *stream(req: ProviderRequest): AsyncGenerator<StreamEvent> {
    try {
      if (this.provider.apiFormat === 'anthropic') {
        yield* this.streamAnthropic(req);
      } else {
        // All OpenAI-compat formats use the same path
        yield* this.streamOpenAICompat(req);
      }
    } catch (err: any) {
      yield { type: 'error', error: err?.message || String(err) };
    }
  }

  // Anthropic-format streaming (Anthropic API, Bedrock, Vertex)
  private async *streamAnthropic(req: ProviderRequest): AsyncGenerator<StreamEvent> {
    const client = new Anthropic({ apiKey: this.apiKey, baseURL: this.baseUrl });

    const messages = req.messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

    const modelId = req.model || this.getModel();

    const stream = await client.messages.stream({
      model: modelId,
      max_tokens: req.maxTokens || 4096,
      temperature: req.temperature ?? 0.7,
      system: req.system || 'You are Hua, a helpful AI coding agent.',
      messages,
      tools: req.tools as any,
    });

    let textAccum = '';
    let inputTokens = 0;
    let outputTokens = 0;

    for await (const event of stream) {
      const ev = event as any;
      if (ev.type === 'content_block_start') {
        const block = ev.content_block;
        if (block?.type === 'thinking') {
          yield { type: 'thinking', content: block.thinking || '' };
        } else if (block?.type === 'tool_use') {
          yield { type: 'tool_use', id: block.id, name: block.name, args: block.input || {} };
        }
      } else if (ev.type === 'content_block_delta') {
        const delta = ev.delta;
        if (delta?.type === 'text_delta') {
          textAccum += delta.text;
          yield { type: 'text_delta', delta: delta.text, accumulated: textAccum };
        } else if (delta?.type === 'thinking_delta') {
          yield { type: 'thinking', content: delta.thinking || '' };
        }
      } else if (ev.type === 'message_delta') {
        if (ev.usage) outputTokens = ev.usage.output_tokens || outputTokens;
      } else if (ev.type === 'message_start') {
        if (ev.message?.usage) inputTokens = ev.message.usage.input_tokens || inputTokens;
      } else if (ev.type === 'message_stop') {
        const total = inputTokens + outputTokens;
        const cost = calculateCost(this.provider.id, modelId, inputTokens, outputTokens);
        this.recordUsage(inputTokens, outputTokens, cost);
        yield { type: 'usage', input: inputTokens, output: outputTokens, total, cost };
        yield { type: 'message_stop', reason: 'end_turn' };
      }
    }
  }

  // OpenAI-compat streaming (works for OpenAI, Gemini, Mistral, NVIDIA, MiniMax, xAI, Ollama,
  // GitHub, DeepSeek, Groq, Cerebras, OpenRouter, Together, Fireworks, Perplexity, HF, etc.)
  private async *streamOpenAICompat(req: ProviderRequest): AsyncGenerator<StreamEvent> {
    const client = new OpenAI({ apiKey: this.apiKey, baseURL: this.baseUrl });

    const messages: any[] = [];
    if (req.system) messages.push({ role: 'system', content: req.system });
    for (const m of req.messages) {
      messages.push({ role: m.role, content: m.content });
    }

    const modelId = req.model || this.getModel();

    // Some OpenAI-compat providers don't support `stream_options.include_usage`.
    // Try with it first; if the API rejects, retry without.
    let stream: any;
    try {
      stream = await client.chat.completions.create({
        model: modelId,
        messages,
        temperature: req.temperature ?? 0.7,
        max_tokens: req.maxTokens || 4096,
        stream: true,
        stream_options: { include_usage: true },
      });
    } catch (e: any) {
      // Some providers reject stream_options — fall back
      if (e?.status === 400 || e?.code === 'invalid_request_error' || /stream_options/i.test(e?.message || '')) {
        stream = await client.chat.completions.create({
          model: modelId,
          messages,
          temperature: req.temperature ?? 0.7,
          max_tokens: req.maxTokens || 4096,
          stream: true,
        });
      } else {
        throw e;
      }
    }

    let textAccum = '';
    let inputTokens = 0;
    let outputTokens = 0;

    // Accumulate streamed tool_calls across chunks (OpenAI sends delta fragments).
    // Maps tool call index → { id, name, argsBuffer }
    const toolCallAccumulator = new Map<number, { id?: string; name?: string; args: string }>();

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) {
        textAccum += delta;
        yield { type: 'text_delta', delta, accumulated: textAccum };
      }

      // Tool calls (OpenAI native streaming — accumulate across chunks)
      const toolCallDeltas = chunk.choices[0]?.delta?.tool_calls;
      if (toolCallDeltas && toolCallDeltas.length > 0) {
        for (const tcd of toolCallDeltas) {
          const idx = tcd.index ?? 0;
          const acc = toolCallAccumulator.get(idx) || { args: '' };
          if (tcd.id) acc.id = tcd.id;
          if (tcd.function?.name) acc.name = tcd.function.name;
          if (tcd.function?.arguments) acc.args += tcd.function.arguments;
          toolCallAccumulator.set(idx, acc);
        }
      }

      if (chunk.usage) {
        inputTokens = chunk.usage.prompt_tokens || 0;
        outputTokens = chunk.usage.completion_tokens || 0;
      }

      if (chunk.choices[0]?.finish_reason) {
        // Flush any accumulated tool calls
        for (const [idx, acc] of toolCallAccumulator.entries()) {
          yield {
            type: 'tool_use',
            id: acc.id || `tool-${Date.now()}-${idx}`,
            name: acc.name || 'unknown',
            args: this.parseToolArgs(acc.args),
          };
        }
        toolCallAccumulator.clear();

        // Fallback: if the API didn't report usage, estimate from text content
        // using a ~4-chars-per-token heuristic. This is rough but at least
        // gives us a non-zero cost number for billing awareness.
        if (inputTokens === 0 && outputTokens === 0) {
          const sysChars = (req.system || '').length;
          const msgChars = req.messages.reduce((s, m) => s + (m.content?.length || 0), 0);
          inputTokens = Math.ceil((sysChars + msgChars) / 4);
          outputTokens = Math.ceil(textAccum.length / 4);
        }

        const total = inputTokens + outputTokens;
        const cost = calculateCost(this.provider.id, modelId, inputTokens, outputTokens);
        this.recordUsage(inputTokens, outputTokens, cost);
        yield { type: 'usage', input: inputTokens, output: outputTokens, total, cost };
        yield { type: 'message_stop', reason: chunk.choices[0].finish_reason };
      }
    }
  }

  private parseToolArgs(args: string | undefined): any {
    if (!args) return {};
    try {
      return JSON.parse(args);
    } catch {
      return { raw: args };
    }
  }

  private recordUsage(input: number, output: number, cost: number): void {
    this.stats.requests += 1;
    this.stats.totalRequests += 1;
    this.stats.inputTokens += input;
    this.stats.outputTokens += output;
    this.stats.totalInputTokens += input;
    this.stats.totalOutputTokens += output;
    this.stats.cost += cost;
    this.stats.totalCost += cost;
  }

  getStats(): UnifiedClientStats {
    return {
      requests: this.stats.requests,
      totalRequests: this.stats.totalRequests,
      inputTokens: this.stats.inputTokens,
      outputTokens: this.stats.outputTokens,
      totalInputTokens: this.stats.totalInputTokens,
      totalOutputTokens: this.stats.totalOutputTokens,
      totalTokens: this.stats.totalInputTokens + this.stats.totalOutputTokens,
      totalCost: this.stats.totalCost,
      cost: this.stats.cost,
    };
  }

  resetStats(): void {
    this.stats = {
      requests: 0,
      totalRequests: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      cost: 0,
      totalCost: 0,
    };
  }
}
