// Provider registry - 10+ LLM providers (inspired by OpenClaude providerProfile.ts)
// Each provider has its own base URL, env vars, and quirks.
// The system normalizes them to a common interface.

export type ProviderId =
  | 'anthropic'
  | 'openai'
  | 'gemini'
  | 'mistral'
  | 'github'
  | 'bedrock'
  | 'vertex'
  | 'nvidia-nim'
  | 'minimax'
  | 'xai'
  | 'ollama'
  | 'opencode'
  | 'codex'
  | 'xiaomi-mimo'
  | 'groq'
  | 'cerebras'
  | 'deepseek'
  | 'openrouter'
  | 'together'
  | 'fireworks'
  | 'perplexity'
  | 'huggingface'
  | 'custom';

export interface ProviderConfig {
  id: ProviderId;
  name: string;
  displayName: string;
  emoji: string;

  // Connection
  baseUrl: string;
  apiKeyEnv: string;
  defaultModel: string;

  // API format
  apiFormat: 'anthropic' | 'openai-chat' | 'openai-responses' | 'gemini';

  // Model listing
  modelsEndpoint?: string;

  // Headers/Auth
  authScheme: 'bearer' | 'x-api-key' | 'custom';
  customHeaderName?: string;

  // Quirks
  supportsPromptCaching: boolean;
  supportsTools: boolean;
  supportsStreaming: boolean;
  contextWindow: number;

  // Optional URL/path overrides
  chatPath?: string;
}

export const PROVIDERS: Record<ProviderId, ProviderConfig> = {
  anthropic: {
    id: 'anthropic',
    name: 'anthropic',
    displayName: 'Anthropic',
    emoji: '🌸',
    baseUrl: 'https://api.anthropic.com',
    apiKeyEnv: 'ANTHROPIC_API_KEY',
    defaultModel: 'claude-3-5-sonnet-20241022',
    apiFormat: 'anthropic',
    authScheme: 'x-api-key',
    supportsPromptCaching: true,
    supportsTools: true,
    supportsStreaming: true,
    contextWindow: 200000,
  },
  openai: {
    id: 'openai',
    name: 'openai',
    displayName: 'OpenAI',
    emoji: '🤖',
    baseUrl: 'https://api.openai.com/v1',
    apiKeyEnv: 'OPENAI_API_KEY',
    defaultModel: 'gpt-4o',
    apiFormat: 'openai-chat',
    authScheme: 'bearer',
    supportsPromptCaching: false,
    supportsTools: true,
    supportsStreaming: true,
    contextWindow: 128000,
  },
  gemini: {
    id: 'gemini',
    name: 'gemini',
    displayName: 'Google Gemini',
    emoji: '💎',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    apiKeyEnv: 'GEMINI_API_KEY',
    defaultModel: 'gemini-3-flash-preview',
    apiFormat: 'openai-chat', // Gemini exposes OpenAI-compat
    authScheme: 'bearer',
    supportsPromptCaching: false,
    supportsTools: true,
    supportsStreaming: true,
    contextWindow: 1000000,
  },
  mistral: {
    id: 'mistral',
    name: 'mistral',
    displayName: 'Mistral',
    emoji: '🌬️',
    baseUrl: 'https://api.mistral.ai/v1',
    apiKeyEnv: 'MISTRAL_API_KEY',
    defaultModel: 'mistral-vibe-cli-latest',
    apiFormat: 'openai-chat',
    authScheme: 'bearer',
    supportsPromptCaching: false,
    supportsTools: true,
    supportsStreaming: true,
    contextWindow: 32000,
  },
  github: {
    id: 'github',
    name: 'github',
    displayName: 'GitHub Copilot',
    emoji: '🐙',
    baseUrl: 'https://api.githubcopilot.com',
    apiKeyEnv: 'GITHUB_TOKEN',
    defaultModel: 'gpt-4o',
    apiFormat: 'openai-chat',
    authScheme: 'bearer',
    supportsPromptCaching: false,
    supportsTools: true,
    supportsStreaming: true,
    contextWindow: 128000,
  },
  bedrock: {
    id: 'bedrock',
    name: 'bedrock',
    displayName: 'AWS Bedrock',
    emoji: '☁️',
    baseUrl: 'https://bedrock-runtime.us-east-1.amazonaws.com',
    apiKeyEnv: 'AWS_BEARER_TOKEN_BEDROCK',
    defaultModel: 'us.anthropic.claude-3-5-sonnet-20241022-v2:0',
    apiFormat: 'anthropic', // Bedrock uses Anthropic format
    authScheme: 'bearer',
    supportsPromptCaching: true,
    supportsTools: true,
    supportsStreaming: true,
    contextWindow: 200000,
  },
  vertex: {
    id: 'vertex',
    name: 'vertex',
    displayName: 'Google Vertex AI',
    emoji: '🌐',
    baseUrl: 'https://us-central1-aiplatform.googleapis.com/v1',
    apiKeyEnv: 'GOOGLE_API_KEY',
    defaultModel: 'claude-3-5-sonnet@20241022',
    apiFormat: 'anthropic',
    authScheme: 'bearer',
    supportsPromptCaching: false,
    supportsTools: true,
    supportsStreaming: true,
    contextWindow: 200000,
  },
  'nvidia-nim': {
    id: 'nvidia-nim',
    name: 'nvidia-nim',
    displayName: 'NVIDIA NIM',
    emoji: '⚡',
    baseUrl: 'https://integrate.api.nvidia.com/v1',
    apiKeyEnv: 'NVIDIA_API_KEY',
    defaultModel: 'meta/llama-3.1-70b-instruct',
    apiFormat: 'openai-chat',
    authScheme: 'bearer',
    supportsPromptCaching: false,
    supportsTools: true,
    supportsStreaming: true,
    contextWindow: 128000,
  },
  minimax: {
    id: 'minimax',
    name: 'minimax',
    displayName: 'MiniMax',
    emoji: '🌟',
    baseUrl: 'https://api.minimax.io/v1',
    apiKeyEnv: 'MINIMAX_API_KEY',
    defaultModel: 'MiniMax-M3',
    apiFormat: 'openai-chat',
    authScheme: 'bearer',
    supportsPromptCaching: false,
    supportsTools: true,
    supportsStreaming: true,
    contextWindow: 128000,
  },
  xai: {
    id: 'xai',
    name: 'xai',
    displayName: 'xAI (Grok)',
    emoji: '🚀',
    baseUrl: 'https://api.x.ai/v1',
    apiKeyEnv: 'XAI_API_KEY',
    defaultModel: 'grok-2-latest',
    apiFormat: 'openai-chat',
    authScheme: 'bearer',
    supportsPromptCaching: false,
    supportsTools: true,
    supportsStreaming: true,
    contextWindow: 128000,
  },
  ollama: {
    id: 'ollama',
    name: 'ollama',
    displayName: 'Ollama (Local)',
    emoji: '🦙',
    baseUrl: 'http://localhost:11434/v1',
    apiKeyEnv: 'OLLAMA_API_KEY', // usually 'ollama' or empty
    defaultModel: 'llama3.2',
    apiFormat: 'openai-chat',
    authScheme: 'bearer',
    supportsPromptCaching: false,
    supportsTools: true,
    supportsStreaming: true,
    contextWindow: 32000,
  },
  opencode: {
    id: 'opencode',
    name: 'opencode',
    displayName: 'OpenCode',
    emoji: '🌲',
    baseUrl: 'https://opencode.ai/zen/v1',
    apiKeyEnv: 'OPENCODE_API_KEY',
    defaultModel: 'qwen3-coder',
    apiFormat: 'openai-chat',
    authScheme: 'bearer',
    supportsPromptCaching: false,
    supportsTools: true,
    supportsStreaming: true,
    contextWindow: 128000,
  },
  codex: {
    id: 'codex',
    name: 'codex',
    displayName: 'Codex (ChatGPT)',
    emoji: '🧠',
    baseUrl: 'https://chatgpt.com/backend-api/codex',
    apiKeyEnv: 'CODEX_API_KEY',
    defaultModel: 'gpt-5.5',
    apiFormat: 'openai-responses',
    authScheme: 'bearer',
    supportsPromptCaching: false,
    supportsTools: true,
    supportsStreaming: true,
    contextWindow: 256000,
  },
  'xiaomi-mimo': {
    id: 'xiaomi-mimo',
    name: 'xiaomi-mimo',
    displayName: 'Xiaomi MiMo',
    emoji: '📱',
    baseUrl: 'https://api.xiaomi.com/v1',
    apiKeyEnv: 'MIMO_API_KEY',
    defaultModel: 'mimo-v2.5-pro',
    apiFormat: 'openai-chat',
    authScheme: 'bearer',
    supportsPromptCaching: false,
    supportsTools: true,
    supportsStreaming: true,
    contextWindow: 128000,
  },
  groq: {
    id: 'groq',
    name: 'groq',
    displayName: 'Groq (fast inference)',
    emoji: '⚡',
    baseUrl: 'https://api.groq.com/openai/v1',
    apiKeyEnv: 'GROQ_API_KEY',
    defaultModel: 'llama-3.3-70b-versatile',
    apiFormat: 'openai-chat',
    authScheme: 'bearer',
    supportsPromptCaching: false,
    supportsTools: true,
    supportsStreaming: true,
    contextWindow: 128000,
  },
  cerebras: {
    id: 'cerebras',
    name: 'cerebras',
    displayName: 'Cerebras (fast inference)',
    emoji: '🧠',
    baseUrl: 'https://api.cerebras.ai/v1',
    apiKeyEnv: 'CEREBRAS_API_KEY',
    defaultModel: 'llama-3.3-70b',
    apiFormat: 'openai-chat',
    authScheme: 'bearer',
    supportsPromptCaching: false,
    supportsTools: true,
    supportsStreaming: true,
    contextWindow: 128000,
  },
  deepseek: {
    id: 'deepseek',
    name: 'deepseek',
    displayName: 'DeepSeek',
    emoji: '🌊',
    baseUrl: 'https://api.deepseek.com/v1',
    apiKeyEnv: 'DEEPSEEK_API_KEY',
    defaultModel: 'deepseek-chat',
    apiFormat: 'openai-chat',
    authScheme: 'bearer',
    supportsPromptCaching: true,
    supportsTools: true,
    supportsStreaming: true,
    contextWindow: 128000,
  },
  openrouter: {
    id: 'openrouter',
    name: 'openrouter',
    displayName: 'OpenRouter (multi-provider)',
    emoji: '🌐',
    baseUrl: 'https://openrouter.ai/api/v1',
    apiKeyEnv: 'OPENROUTER_API_KEY',
    defaultModel: 'anthropic/claude-sonnet-4-6',
    apiFormat: 'openai-chat',
    authScheme: 'bearer',
    supportsPromptCaching: false,
    supportsTools: true,
    supportsStreaming: true,
    contextWindow: 200000,
  },
  together: {
    id: 'together',
    name: 'together',
    displayName: 'Together AI',
    emoji: '🤝',
    baseUrl: 'https://api.together.xyz/v1',
    apiKeyEnv: 'TOGETHER_API_KEY',
    defaultModel: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
    apiFormat: 'openai-chat',
    authScheme: 'bearer',
    supportsPromptCaching: false,
    supportsTools: true,
    supportsStreaming: true,
    contextWindow: 128000,
  },
  fireworks: {
    id: 'fireworks',
    name: 'fireworks',
    displayName: 'Fireworks AI',
    emoji: '🎆',
    baseUrl: 'https://api.fireworks.ai/inference/v1',
    apiKeyEnv: 'FIREWORKS_API_KEY',
    defaultModel: 'accounts/fireworks/models/llama-v3p3-70b-instruct',
    apiFormat: 'openai-chat',
    authScheme: 'bearer',
    supportsPromptCaching: false,
    supportsTools: true,
    supportsStreaming: true,
    contextWindow: 128000,
  },
  perplexity: {
    id: 'perplexity',
    name: 'perplexity',
    displayName: 'Perplexity (search-augmented)',
    emoji: '🔍',
    baseUrl: 'https://api.perplexity.ai',
    apiKeyEnv: 'PERPLEXITY_API_KEY',
    defaultModel: 'sonar-pro',
    apiFormat: 'openai-chat',
    authScheme: 'bearer',
    supportsPromptCaching: false,
    supportsTools: false,
    supportsStreaming: true,
    contextWindow: 127000,
  },
  huggingface: {
    id: 'huggingface',
    name: 'huggingface',
    displayName: 'HuggingFace Inference',
    emoji: '🤗',
    baseUrl: 'https://api-inference.huggingface.co/models',
    apiKeyEnv: 'HF_TOKEN',
    defaultModel: 'meta-llama/Llama-3.3-70B-Instruct',
    apiFormat: 'openai-chat',
    authScheme: 'bearer',
    supportsPromptCaching: false,
    supportsTools: false,
    supportsStreaming: true,
    contextWindow: 8000,
  },
  custom: {
    id: 'custom',
    name: 'custom',
    displayName: 'Custom (TokenRouter, etc.)',
    emoji: '🔮',
    baseUrl: 'https://api.tokenrouter.com/v1',
    apiKeyEnv: 'TOKENROUTER_API_KEY',
    defaultModel: 'MiniMax-M3',
    apiFormat: 'openai-chat',
    authScheme: 'bearer',
    supportsPromptCaching: false,
    supportsTools: true,
    supportsStreaming: true,
    contextWindow: 128000,
  },
};

export function getProvider(id: ProviderId): ProviderConfig {
  return PROVIDERS[id] || PROVIDERS.custom;
}

export function listProviders(): ProviderConfig[] {
  return Object.values(PROVIDERS);
}

// Auto-detect provider from environment variables
export function detectProviderFromEnv(): ProviderConfig | null {
  // Priority order: check env vars in order. Newer/more capable providers first.
  const candidates: Array<[ProviderId, string]> = [
    ['anthropic', 'ANTHROPIC_API_KEY'],
    ['openai', 'OPENAI_API_KEY'],
    ['minimax', 'MINIMAX_API_KEY'],
    ['minimax', 'TOKENROUTER_API_KEY'], // TokenRouter
    ['gemini', 'GEMINI_API_KEY'],
    ['openai', 'GOOGLE_API_KEY'], // OpenAI-compat for Google
    ['mistral', 'MISTRAL_API_KEY'],
    ['github', 'GITHUB_TOKEN'],
    ['nvidia-nim', 'NVIDIA_API_KEY'],
    ['xai', 'XAI_API_KEY'],
    ['opencode', 'OPENCODE_API_KEY'],
    ['codex', 'CODEX_API_KEY'],
    ['xiaomi-mimo', 'MIMO_API_KEY'],
    ['groq', 'GROQ_API_KEY'],
    ['cerebras', 'CEREBRAS_API_KEY'],
    ['deepseek', 'DEEPSEEK_API_KEY'],
    ['openrouter', 'OPENROUTER_API_KEY'],
    ['together', 'TOGETHER_API_KEY'],
    ['fireworks', 'FIREWORKS_API_KEY'],
    ['perplexity', 'PERPLEXITY_API_KEY'],
    ['huggingface', 'HF_TOKEN'],
    ['bedrock', 'AWS_BEARER_TOKEN_BEDROCK'],
    ['vertex', 'GOOGLE_APPLICATION_CREDENTIALS'],
  ];

  for (const [id, env] of candidates) {
    if (process.env[env]) {
      return PROVIDERS[id];
    }
  }
  return null;
}

// Build chat completion URL from provider config
export function getChatUrl(provider: ProviderConfig, path?: string): string {
  const base = provider.baseUrl.replace(/\/+$/, '');
  const p = path || provider.chatPath || '/chat/completions';
  if (p.startsWith('http')) return p;
  if (p.startsWith('/')) return base + p;
  return base + '/' + p;
}
