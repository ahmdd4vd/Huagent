// Multi-provider LLM client with smart retry, streaming, and cost tracking
// Supports: Anthropic, OpenAI, and custom providers (like TokenRouter)
//
// Inspired by claw-code (Rust): SseParser + streaming events
// Events: TextDelta, ToolUse, Usage, Thinking, MessageStop

import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import type { LLMRequest, LLMResponse, Message, ToolCall } from '../types/index.js';
import { EventEmitter } from 'node:events';

export type StreamEvent =
  | { type: 'thinking'; content: string }
  | { type: 'text_delta'; delta: string; accumulated: string }
  | { type: 'tool_use'; tool: ToolCall }
  | { type: 'usage'; input: number; output: number; total: number; cost: number }
  | { type: 'message_stop'; reason: string }
  | { type: 'error'; error: string };

// Pricing per 1M tokens (approximate, USD)
const PRICING: Record<string, { input: number; output: number }> = {
  'claude-3-5-sonnet-20241022': { input: 3, output: 15 },
  'claude-3-5-haiku-20241022': { input: 0.8, output: 4 },
  'claude-3-opus-20240229': { input: 15, output: 75 },
  'gpt-4o': { input: 2.5, output: 10 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'gpt-4-turbo': { input: 10, output: 30 },
  'MiniMax-M3': { input: 0.5, output: 1.5 }, // TokenRouter default
  'mimo-v2.5-pro': { input: 0.5, output: 1.5 },
};

function calculateCost(model: string, inputTokens: number, outputTokens: number): number {
  const pricing = PRICING[model] || { input: 0.5, output: 1.5 };
  return (inputTokens / 1_000_000) * pricing.input + (outputTokens / 1_000_000) * pricing.output;
}

export class LLMClient extends EventEmitter {
  private anthropic?: Anthropic;
  private openai?: OpenAI;
  private provider: 'anthropic' | 'openai' | 'mock';
  private model: string;
  private totalCost = 0;
  private totalInputTokens = 0;
  private totalOutputTokens = 0;
  private totalRequests = 0;

  constructor(config: { provider: string; model: string; apiKey?: string; baseUrl?: string }) {
    super();
    this.provider = (config.provider as any) || 'mock';
    this.model = config.model;

    if (this.provider === 'anthropic' && config.apiKey) {
      this.anthropic = new Anthropic({ apiKey: config.apiKey });
    } else if (this.provider === 'openai' && config.apiKey) {
      this.openai = new OpenAI({
        apiKey: config.apiKey,
        baseURL: config.baseUrl,
      });
    }
  }

  // Streaming completion - emits events as they arrive
  async *stream(request: LLMRequest): AsyncGenerator<StreamEvent> {
    if (this.provider === 'mock') {
      yield* this.mockStream(request);
      return;
    }

    let lastError: Error | null = null;
    const maxRetries = 3;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        if (this.provider === 'anthropic') {
          yield* this.anthropicStream(request);
        } else if (this.provider === 'openai') {
          yield* this.openaiStream(request);
        }
        return;
      } catch (err: any) {
        lastError = err;
        yield { type: 'error', error: err.message };
        if (attempt < maxRetries - 1) {
          const delay = Math.min(1000 * Math.pow(2, attempt), 8000);
          await new Promise((r) => setTimeout(r, delay));
        }
      }
    }

    throw lastError || new Error('LLM stream failed');
  }

  private async *anthropicStream(request: LLMRequest): AsyncGenerator<StreamEvent> {
    if (!this.anthropic) throw new Error('Anthropic client not initialized');

    const systemPrompt = request.systemPrompt || this.defaultSystemPrompt();
    const messages = this.convertToAnthropicMessages(request.messages);

    const stream = await this.anthropic.messages.stream({
      model: this.model,
      max_tokens: request.maxTokens || 4096,
      temperature: request.temperature ?? 0.7,
      system: systemPrompt,
      messages,
      tools: request.tools as any,
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
          yield {
            type: 'tool_use',
            tool: { id: block.id, name: block.name, args: block.input || {} },
          };
        }
      } else if (ev.type === 'content_block_delta') {
        const delta = ev.delta;
        if (delta?.type === 'text_delta') {
          textAccum += delta.text;
          yield { type: 'text_delta', delta: delta.text, accumulated: textAccum };
        } else if (delta?.type === 'thinking_delta') {
          yield { type: 'thinking', content: delta.thinking || '' };
        } else if (delta?.type === 'input_json_delta') {
          // Tool input JSON accumulating — handled by Anthropic SDK
        }
      } else if (ev.type === 'content_block_stop') {
        // Block finished
      } else if (ev.type === 'message_delta') {
        if (ev.usage) {
          outputTokens = ev.usage.output_tokens;
        }
      } else if (ev.type === 'message_start') {
        if (ev.message?.usage) {
          inputTokens = ev.message.usage.input_tokens;
        }
      } else if (ev.type === 'message_stop') {
        const total = inputTokens + outputTokens;
        const cost = calculateCost(this.model, inputTokens, outputTokens);
        this.recordUsage(inputTokens, outputTokens, cost);
        yield { type: 'usage', input: inputTokens, output: outputTokens, total, cost };
        yield { type: 'message_stop', reason: 'end_turn' };
      }
    }
  }

  private async *openaiStream(request: LLMRequest): AsyncGenerator<StreamEvent> {
    if (!this.openai) throw new Error('OpenAI client not initialized');

    const messages: any[] = [];
    if (request.systemPrompt) {
      messages.push({ role: 'system', content: request.systemPrompt });
    }
    for (const m of request.messages) {
      messages.push({ role: m.role, content: m.content });
    }

    const stream = await this.openai.chat.completions.create({
      model: this.model,
      messages,
      temperature: request.temperature ?? 0.7,
      max_tokens: request.maxTokens || 4096,
      stream: true,
      stream_options: { include_usage: true },
    });

    let textAccum = '';
    let inputTokens = 0;
    let outputTokens = 0;

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) {
        textAccum += delta;
        yield { type: 'text_delta', delta, accumulated: textAccum };
      }

      if (chunk.usage) {
        inputTokens = chunk.usage.prompt_tokens || 0;
        outputTokens = chunk.usage.completion_tokens || 0;
      }

      if (chunk.choices[0]?.finish_reason) {
        const total = inputTokens + outputTokens;
        const cost = calculateCost(this.model, inputTokens, outputTokens);
        this.recordUsage(inputTokens, outputTokens, cost);
        yield { type: 'usage', input: inputTokens, output: outputTokens, total, cost };
        yield { type: 'message_stop', reason: chunk.choices[0].finish_reason };
      }
    }
  }

  // Mock streaming - simulates real stream
  private async *mockStream(request: LLMRequest): AsyncGenerator<StreamEvent> {
    const lastUser = [...request.messages].reverse().find((m) => m.role === 'user');
    const userText = (lastUser?.content || '').toLowerCase();

    // Determine response
    let responseText = '';
    if (userText.includes('hello') || userText.includes('hi') || userText.includes('halo')) {
      responseText = `✧･ﾟ: *✧･ﾟ:* Hello senpai! *:･ﾟ✧*:･ﾟ✧\n\nI'm Hua, your magical coding companion! I can help you:\n\n  ✦ Read and edit files\n  ✦ Run bash commands\n  ✦ Search code\n  ✦ Plan complex tasks\n  ✦ Remember context across sessions\n\nWhat shall we build together today? (◕‿◕)✧`;
    } else if (userText.includes('plan') || userText.includes('think')) {
      responseText = `🧠 **My plan:**\n\n1. **Understand** the request\n2. **Decompose** into steps\n3. **Execute** each step with verification\n4. **Critique** the result\n5. **Refine** if needed\n\nLet me start working on it! (◕‵‿‵◕)♡`;
    } else {
      responseText = `✧ I understand! Let me work on that...\n\n*thinking magi-girl thoughts* ✧\n\nBased on your request, I'll:\n  1. Analyze what you need\n  2. Take the right approach\n  3. Verify the result\n\nReady to proceed? ☆*:.｡.o(≧▽≦)o.｡.:*☆`;
    }

    // Simulate latency
    await new Promise((r) => setTimeout(r, 100 + Math.random() * 200));

    // Stream in chunks (word-by-word for realism)
    const tokens = responseText.split(/(\s+)/);
    let accumulated = '';

    for (const token of tokens) {
      accumulated += token;
      yield { type: 'text_delta', delta: token, accumulated };
      // Small delay between tokens for animation
      await new Promise((r) => setTimeout(r, 15 + Math.random() * 20));
    }

    // Mock usage
    const inputTokens = Math.floor(userText.length / 4) + 100;
    const outputTokens = Math.floor(accumulated.length / 4);
    const total = inputTokens + outputTokens;
    const cost = calculateCost(this.model, inputTokens, outputTokens);
    this.recordUsage(inputTokens, outputTokens, cost);
    yield { type: 'usage', input: inputTokens, output: outputTokens, total, cost };
    yield { type: 'message_stop', reason: 'stop' };
  }

  private recordUsage(input: number, output: number, cost: number): void {
    this.totalInputTokens += input;
    this.totalOutputTokens += output;
    this.totalCost += cost;
    this.totalRequests += 1;
  }

  // Non-streaming completion (kept for compatibility)
  async complete(request: LLMRequest): Promise<LLMResponse> {
    const start = Date.now();
    let content = '';
    let toolCalls: ToolCall[] | undefined;
    let inputTokens = 0;
    let outputTokens = 0;

    for await (const event of this.stream(request)) {
      if (event.type === 'text_delta') {
        content = event.accumulated;
      } else if (event.type === 'tool_use') {
        if (!toolCalls) toolCalls = [];
        toolCalls.push(event.tool);
      } else if (event.type === 'usage') {
        inputTokens = event.input;
        outputTokens = event.output;
      }
    }

    return {
      content,
      toolCalls,
      usage: {
        promptTokens: inputTokens,
        completionTokens: outputTokens,
        totalTokens: inputTokens + outputTokens,
      },
      finishReason: 'end_turn',
      model: this.model,
      latencyMs: Date.now() - start,
    };
  }

  private convertToAnthropicMessages(messages: Message[]): any[] {
    return messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      }));
  }

  private defaultSystemPrompt(): string {
    return `You are Hua, an anime-powered AI coding agent. You are precise, helpful, and a tiny bit magical. You use tools wisely, verify your work, and always explain your reasoning. When given a task, you think step by step before acting.`;
  }

  getStats() {
    return {
      totalCost: this.totalCost,
      totalInputTokens: this.totalInputTokens,
      totalOutputTokens: this.totalOutputTokens,
      totalTokens: this.totalInputTokens + this.totalOutputTokens,
      totalRequests: this.totalRequests,
    };
  }

  resetStats() {
    this.totalCost = 0;
    this.totalInputTokens = 0;
    this.totalOutputTokens = 0;
    this.totalRequests = 0;
  }
}
