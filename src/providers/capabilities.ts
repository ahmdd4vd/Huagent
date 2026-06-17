/**
 * Pattern-based model capabilities resolver.
 *
 * Inspired by 9router's capabilities.js — uses a 4-step fallback chain:
 *   1. Provider-specific override
 *   2. Exact model id match
 *   3. Glob pattern match (first match wins, specific → generic)
 *   4. Default floor (safe minimum)
 *
 * This eliminates the need to hardcode capabilities for every single model.
 */

export interface ModelCapabilities {
  vision: boolean;
  tools: boolean;
  reasoning: boolean;
  search: boolean;
  /** Thinking wire format: null = derive from provider apiFormat */
  thinkingFormat: 'openai' | 'claude-adaptive' | 'claude-budget' | 'gemini-level' | 'gemini-budget' | 'qwen' | 'deepseek' | 'minimax' | null;
  thinkingCanDisable: boolean;
  contextWindow: number;
  maxOutput: number;
}

export const DEFAULT_CAPABILITIES: ModelCapabilities = {
  vision: false,
  tools: true,
  reasoning: false,
  search: false,
  thinkingFormat: null,
  thinkingCanDisable: true,
  contextWindow: 200_000,
  maxOutput: 64_000,
};

/** Exact model id overrides — for exceptions that patterns would mis-match. */
export const MODEL_CAPABILITIES: Record<string, Partial<ModelCapabilities>> = {
  'claude-opus-4-7':   { vision: true, reasoning: true, search: true, thinkingFormat: 'claude-adaptive', contextWindow: 1_000_000, maxOutput: 128_000 },
  'claude-opus-4-6':   { vision: true, reasoning: true, search: true, thinkingFormat: 'claude-adaptive', contextWindow: 1_000_000, maxOutput: 128_000 },
  'claude-sonnet-4-6': { vision: true, reasoning: true, search: true, thinkingFormat: 'claude-adaptive', contextWindow: 1_000_000, maxOutput: 64_000 },
  'claude-sonnet-4-5': { vision: true, reasoning: true, search: true, thinkingFormat: 'claude-adaptive', contextWindow: 200_000, maxOutput: 64_000 },
  'gpt-image-1':       { vision: true, tools: false, search: false },
};

/**
 * Pattern fallback — glob (* = wildcard), matched case-insensitively.
 * ORDER MATTERS: specific variants first, generic families last.
 */
export const PATTERN_CAPABILITIES: Array<{ pattern: string; caps: Partial<ModelCapabilities> }> = [
  // Claude (4.6+ = adaptive thinking; older/haiku = budget)
  { pattern: '*claude*opus-4.6*',   caps: { vision: true, reasoning: true, search: true, thinkingFormat: 'claude-adaptive', contextWindow: 1_000_000, maxOutput: 128_000 } },
  { pattern: '*claude*opus-4.7*',   caps: { vision: true, reasoning: true, search: true, thinkingFormat: 'claude-adaptive', contextWindow: 1_000_000, maxOutput: 128_000 } },
  { pattern: '*claude*sonnet-4.6*', caps: { vision: true, reasoning: true, search: true, thinkingFormat: 'claude-adaptive', contextWindow: 1_000_000, maxOutput: 64_000 } },
  { pattern: '*claude*haiku*',      caps: { vision: true, reasoning: true, search: true, thinkingFormat: 'claude-budget' } },
  { pattern: '*claude*opus*',       caps: { vision: true, reasoning: true, search: true, thinkingFormat: 'claude-budget' } },
  { pattern: '*claude*sonnet*',     caps: { vision: true, reasoning: true, search: true, thinkingFormat: 'claude-budget' } },
  { pattern: '*claude-3*',          caps: { vision: true } },
  { pattern: '*claude*',            caps: { vision: true, reasoning: true, search: true, thinkingFormat: 'claude-budget' } },

  // Gemini
  { pattern: '*gemini-3*pro*',      caps: { vision: true, reasoning: true, search: true, thinkingFormat: 'gemini-level', thinkingCanDisable: false, contextWindow: 1_048_576, maxOutput: 65_535 } },
  { pattern: '*gemini-3*',          caps: { vision: true, reasoning: true, search: true, thinkingFormat: 'gemini-level', thinkingCanDisable: false, contextWindow: 1_048_576, maxOutput: 65_536 } },
  { pattern: '*gemini-2.5*',        caps: { vision: true, reasoning: true, search: true, thinkingFormat: 'gemini-budget', contextWindow: 1_048_576, maxOutput: 65_536 } },
  { pattern: '*gemini-2*',          caps: { vision: true, search: true, contextWindow: 1_048_576, maxOutput: 65_536 } },
  { pattern: '*gemini*',            caps: { vision: true, search: true, contextWindow: 1_048_576 } },

  // OpenAI GPT-5.x
  { pattern: '*gpt-5*codex*',       caps: { vision: true, reasoning: true, search: true, thinkingFormat: 'openai', contextWindow: 400_000, maxOutput: 128_000 } },
  { pattern: '*gpt-5*',             caps: { vision: true, reasoning: true, search: true, thinkingFormat: 'openai', contextWindow: 400_000, maxOutput: 128_000 } },
  { pattern: '*gpt-4o*',            caps: { vision: true, search: true, contextWindow: 128_000, maxOutput: 16_384 } },
  { pattern: '*gpt-4.1*',           caps: { vision: true, contextWindow: 1_000_000, maxOutput: 32_768 } },
  { pattern: '*gpt-4*',             caps: { contextWindow: 128_000 } },

  // o-series
  { pattern: '*o3*',                caps: { vision: true, reasoning: true, thinkingFormat: 'openai', contextWindow: 200_000, maxOutput: 100_000 } },
  { pattern: '*o4*',                caps: { vision: true, reasoning: true, thinkingFormat: 'openai', contextWindow: 200_000, maxOutput: 100_000 } },

  // Grok
  { pattern: '*grok-4*',            caps: { vision: true, reasoning: true, search: true, thinkingFormat: 'openai', contextWindow: 256_000 } },
  { pattern: '*grok-3*',            caps: { vision: true, reasoning: true, search: true, thinkingFormat: 'openai', contextWindow: 131_072 } },
  { pattern: '*grok*',              caps: { vision: true, reasoning: true, search: true, thinkingFormat: 'openai', contextWindow: 256_000 } },

  // Qwen
  { pattern: '*qwen*coder*',        caps: { reasoning: true, thinkingFormat: 'qwen', contextWindow: 1_000_000 } },
  { pattern: '*qwq*',               caps: { reasoning: true, thinkingFormat: 'qwen', thinkingCanDisable: false, contextWindow: 131_072 } },
  { pattern: '*qwen*',              caps: { reasoning: true, thinkingFormat: 'qwen', contextWindow: 262_144 } },

  // DeepSeek
  { pattern: '*deepseek-r*',        caps: { reasoning: true, thinkingFormat: 'deepseek', thinkingCanDisable: false, contextWindow: 128_000 } },
  { pattern: '*deepseek*',          caps: { contextWindow: 128_000 } },

  // MiniMax
  { pattern: '*minimax-m3*',        caps: { reasoning: true, thinkingFormat: 'minimax', contextWindow: 1_048_576, maxOutput: 512_000 } },
  { pattern: '*minimax*',           caps: { reasoning: true, thinkingFormat: 'minimax', contextWindow: 200_000, maxOutput: 131_072 } },

  // MiMo
  { pattern: '*mimo*v2.5*',         caps: { vision: true, contextWindow: 1_048_576, maxOutput: 131_072 } },
  { pattern: '*mimo*',              caps: { vision: true, contextWindow: 262_144, maxOutput: 131_072 } },

  // Llama
  { pattern: '*llama-4*',           caps: { vision: true, contextWindow: 1_000_000 } },
  { pattern: '*llama*',             caps: { contextWindow: 128_000 } },

  // Mistral
  { pattern: '*codestral*',         caps: { contextWindow: 256_000 } },
  { pattern: '*mistral-large*',     caps: { vision: true, contextWindow: 256_000 } },
  { pattern: '*mistral*',           caps: { contextWindow: 128_000 } },

  // Perplexity
  { pattern: '*sonar*',             caps: { search: true, contextWindow: 128_000 } },
];

/** Match a model ID against a glob pattern. Case-insensitive. */
export function matchPattern(pattern: string, model: string): boolean {
  const regex = new RegExp(
    '^' + pattern.split('*').map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$',
    'i',
  );
  return regex.test(model);
}

/**
 * Resolve capabilities for a model using the 4-step fallback chain.
 * Result is always a complete ModelCapabilities object.
 */
export function getCapabilities(provider: string | undefined, model: string): ModelCapabilities {
  if (!model) return { ...DEFAULT_CAPABILITIES };

  // Strip vendor prefix: "anthropic/claude-opus-4.7" → "claude-opus-4.7"
  const baseModel = model.includes('/') ? model.split('/').pop()! : model;

  // 1. Exact match (with or without prefix)
  if (MODEL_CAPABILITIES[baseModel]) return { ...DEFAULT_CAPABILITIES, ...MODEL_CAPABILITIES[baseModel] };
  if (MODEL_CAPABILITIES[model]) return { ...DEFAULT_CAPABILITIES, ...MODEL_CAPABILITIES[model] };

  // 2. Pattern match (first match wins)
  for (const { pattern, caps } of PATTERN_CAPABILITIES) {
    if (matchPattern(pattern, baseModel) || matchPattern(pattern, model)) {
      return { ...DEFAULT_CAPABILITIES, ...caps };
    }
  }

  // 3. Floor
  return { ...DEFAULT_CAPABILITIES };
}
