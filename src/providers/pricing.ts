/**
 * Pattern-based pricing resolver.
 *
 * Inspired by 9router's pricing.js — 3-step fallback chain:
 *   1. Provider-specific override
 *   2. Exact model id match (canonical, provider-agnostic)
 *   3. Glob pattern match (first match wins)
 *
 * All rates in $/1M tokens.
 */

export interface ModelPricing {
  input: number;
  output: number;
  cached?: number;
  reasoning?: number;
}

/** Canonical model pricing — provider-agnostic. */
export const MODEL_PRICING: Record<string, ModelPricing> = {
  // Anthropic
  'claude-opus-4-7':              { input: 15, output: 75, cached: 1.50, reasoning: 75 },
  'claude-opus-4-6':              { input: 15, output: 75, cached: 1.50, reasoning: 75 },
  'claude-sonnet-4-6':            { input: 3, output: 15, cached: 0.30, reasoning: 15 },
  'claude-sonnet-4-5':            { input: 3, output: 15, cached: 0.30, reasoning: 15 },
  'claude-sonnet-4-0':            { input: 3, output: 15, cached: 1.50, reasoning: 15 },
  'claude-haiku-4-5':             { input: 1, output: 5, cached: 0.10, reasoning: 5 },
  'claude-3-5-sonnet-20241022':   { input: 3, output: 15, cached: 1.50, reasoning: 15 },
  'claude-3-5-haiku-20241022':    { input: 0.8, output: 4 },
  'claude-3-opus-20240229':       { input: 15, output: 75 },

  // OpenAI
  'gpt-5.5':                      { input: 5, output: 15, cached: 1.25, reasoning: 15 },
  'gpt-5':                        { input: 5, output: 15, cached: 1.25, reasoning: 15 },
  'gpt-5-mini':                   { input: 0.75, output: 3, cached: 0.375, reasoning: 3 },
  'gpt-4o':                       { input: 2.5, output: 10, cached: 1.25 },
  'gpt-4o-mini':                  { input: 0.15, output: 0.60, cached: 0.075 },
  'gpt-4-turbo':                  { input: 10, output: 30 },
  'o3':                           { input: 10, output: 40, reasoning: 40 },
  'o3-mini':                      { input: 1.1, output: 4.4, reasoning: 4.4 },
  'o4-mini':                      { input: 1.1, output: 4.4, reasoning: 4.4 },

  // Gemini
  'gemini-3-pro':                 { input: 1.25, output: 5, cached: 0.25, reasoning: 5 },
  'gemini-3-flash':               { input: 0.075, output: 0.3, cached: 0.03 },
  'gemini-3-flash-preview':       { input: 0.50, output: 3, cached: 0.03 },
  'gemini-2.5-pro':               { input: 1.25, output: 5, cached: 0.25, reasoning: 5 },
  'gemini-2.5-flash':             { input: 0.075, output: 0.3, cached: 0.03 },

  // Mistral
  'mistral-large-3':              { input: 2, output: 6 },
  'mistral-vibe-cli-latest':      { input: 0.2, output: 0.6 },
  'codestral-25':                 { input: 0.3, output: 0.9 },

  // Grok
  'grok-4':                       { input: 5, output: 15, reasoning: 15 },
  'grok-3':                       { input: 3, output: 15 },
  'grok-3-mini':                  { input: 0.3, output: 0.5, reasoning: 0.5 },
  'grok-2-latest':                { input: 5, output: 15 },

  // DeepSeek
  'deepseek-chat':                { input: 0.27, output: 1.1 },
  'deepseek-reasoner':            { input: 0.55, output: 2.19, reasoning: 2.19 },
  'deepseek-coder':               { input: 0.27, output: 1.1 },

  // Qwen
  'qwen3-coder':                  { input: 1, output: 4 },

  // MiniMax
  'MiniMax-M3':                   { input: 0.5, output: 1.5 },

  // MiMo
  'mimo-v2.5-pro':                { input: 0.5, output: 1.5 },

  // Groq
  'llama-3.3-70b-versatile':      { input: 0.59, output: 0.79 },
  'llama-3.1-8b-instant':         { input: 0.05, output: 0.08 },

  // Cerebras
  'llama-3.3-70b':                { input: 0.85, output: 0.85 },

  // Perplexity
  'sonar-pro':                    { input: 3, output: 15 },
  'sonar':                        { input: 1, output: 1 },
  'sonar-reasoning':              { input: 1, output: 5, reasoning: 5 },
};

/** Provider-specific pricing overrides. Only when price differs from canonical. */
export const PROVIDER_PRICING: Record<string, Record<string, ModelPricing>> = {
  // GitHub Copilot — free for subscribers
  github: Object.fromEntries(
    Object.keys(MODEL_PRICING).map(k => [k, { input: 0, output: 0 }]),
  ),
  // OpenCode Zen — free
  opencode: Object.fromEntries(
    Object.keys(MODEL_PRICING).map(k => [k, { input: 0, output: 0 }]),
  ),
};

/** Pattern-based pricing fallback. ORDER MATTERS. */
export const PATTERN_PRICING: Array<{ pattern: string; pricing: ModelPricing }> = [
  // Claude
  { pattern: 'claude-opus-*',   pricing: { input: 15, output: 75, cached: 1.50, reasoning: 75 } },
  { pattern: 'claude-sonnet-*', pricing: { input: 3, output: 15, cached: 0.30, reasoning: 15 } },
  { pattern: 'claude-haiku-*',  pricing: { input: 1, output: 5, cached: 0.10, reasoning: 5 } },
  { pattern: 'claude-*',        pricing: { input: 3, output: 15, cached: 0.30, reasoning: 15 } },

  // Gemini
  { pattern: 'gemini-*-flash',  pricing: { input: 0.075, output: 0.3, cached: 0.03 } },
  { pattern: 'gemini-*-pro',    pricing: { input: 1.25, output: 5, cached: 0.25, reasoning: 5 } },
  { pattern: 'gemini-*',        pricing: { input: 0.50, output: 3, cached: 0.03 } },

  // GPT
  { pattern: 'gpt-5*',          pricing: { input: 5, output: 15, cached: 1.25, reasoning: 15 } },
  { pattern: 'gpt-4o-*',        pricing: { input: 0.15, output: 0.60 } },
  { pattern: 'gpt-4*',          pricing: { input: 2.5, output: 10 } },

  // o-series
  { pattern: 'o3-*',            pricing: { input: 10, output: 40, reasoning: 40 } },
  { pattern: 'o4-*',            pricing: { input: 2, output: 8, reasoning: 8 } },

  // Qwen
  { pattern: 'qwen*coder*',     pricing: { input: 1, output: 4 } },
  { pattern: 'qwen*',           pricing: { input: 0.50, output: 2 } },

  // DeepSeek
  { pattern: 'deepseek-r*',     pricing: { input: 0.55, output: 2.19, reasoning: 2.19 } },
  { pattern: 'deepseek-*',      pricing: { input: 0.27, output: 1.1 } },

  // MiniMax
  { pattern: 'minimax*',        pricing: { input: 0.50, output: 2 } },
  { pattern: 'MiniMax*',        pricing: { input: 0.50, output: 2 } },

  // Grok
  { pattern: 'grok*',           pricing: { input: 3, output: 15 } },

  // Llama (generic)
  { pattern: 'llama*',          pricing: { input: 0.50, output: 0.80 } },

  // Mistral
  { pattern: 'codestral*',      pricing: { input: 0.30, output: 0.90 } },
  { pattern: 'mistral*',        pricing: { input: 0.50, output: 2 } },

  // MiMo
  { pattern: 'mimo*',           pricing: { input: 0.50, output: 1.50 } },
];

/** Match a model ID against a glob pattern. Case-insensitive. */
function matchGlob(pattern: string, model: string): boolean {
  const regex = new RegExp(
    '^' + pattern.split('*').map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$',
    'i',
  );
  return regex.test(model);
}

const DEFAULT_PRICING: ModelPricing = { input: 0.5, output: 1.5 };

/**
 * Resolve pricing for a model using the 3-step fallback chain.
 * Returns null only if nothing matches at all (shouldn't happen with patterns).
 */
export function getPricing(provider: string | undefined, model: string): ModelPricing {
  if (!model) return DEFAULT_PRICING;

  const baseModel = model.includes('/') ? model.split('/').pop()! : model;

  // 1. Provider-specific override
  if (provider && PROVIDER_PRICING[provider]?.[baseModel]) {
    return PROVIDER_PRICING[provider][baseModel];
  }

  // 2. Canonical model pricing
  if (MODEL_PRICING[baseModel]) return MODEL_PRICING[baseModel];
  if (MODEL_PRICING[model]) return MODEL_PRICING[model];

  // 3. Pattern match
  for (const { pattern, pricing } of PATTERN_PRICING) {
    if (matchGlob(pattern, baseModel) || matchGlob(pattern, model)) {
      return pricing;
    }
  }

  return DEFAULT_PRICING;
}

/** Calculate cost in USD from token counts and pricing. */
export function calculateCost(inputTokens: number, outputTokens: number, pricing: ModelPricing): number {
  return (inputTokens / 1_000_000) * pricing.input + (outputTokens / 1_000_000) * pricing.output;
}
