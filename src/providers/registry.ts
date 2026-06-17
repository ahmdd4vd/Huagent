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
  | 'qoder'
  | 'kiro'
  | 'antigravity'
  | 'gemini-cli'
  | 'azure'
  | 'cohere'
  | 'nebius'
  | 'cloudflare-ai'
  | 'siliconflow'
  | 'hyperbolic'
  | 'chutes'
  | 'glm'
  | 'kimi'
  | 'cline'
  | 'codebuddy'
  | 'kilocode'
  | 'commandcode'
  | 'blackbox'
  | 'vercel-ai'
  | 'volcengine'
  | 'opencode-go'
  | 'mimo-free'
  | 'xiaomi-tokenplan'
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
  apiFormat: 'anthropic' | 'openai-chat' | 'openai-responses';

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

  // OAuth configuration (for providers that support OAuth login)
  oauth?: {
    clientId?: string;
    clientSecret?: string;
    authorizeUrl?: string;
    tokenUrl?: string;
    deviceCodeUrl?: string;
    scopes?: string;
  };

  // Executor override (provider id of specialized executor, if any)
  executor?: string;
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
    baseUrl: 'https://api.githubcopilot.com/v1',
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
    apiFormat: 'anthropic', // Bedrock uses Anthropic message format (needs AWS auth in production)
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
    apiFormat: 'anthropic', // Vertex Claude uses Anthropic format (needs ADC/service-account in production)
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
    baseUrl: 'https://api.perplexity.ai/v1',
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
  qoder: {
    id: 'qoder',
    name: 'qoder',
    displayName: 'Qoder AI',
    emoji: '🤖',
    baseUrl: 'https://api.qoder.ai/v1',
    apiKeyEnv: 'QODER_API_KEY',
    defaultModel: 'qoder-large',
    apiFormat: 'openai-chat',
    authScheme: 'bearer',
    supportsPromptCaching: false,
    supportsTools: true,
    supportsStreaming: true,
    contextWindow: 200000,
    executor: 'qoder',
    oauth: {
      clientId: 'qoder-cli',
      tokenUrl: 'https://auth.qoder.ai/oauth/token',
      scopes: 'openid profile offline_access',
    },
  },
  kiro: {
    id: 'kiro',
    name: 'kiro',
    displayName: 'Amazon Kiro',
    emoji: '🔶',
    baseUrl: 'https://api.kiro.ai/v1',
    apiKeyEnv: 'KIRO_API_KEY',
    defaultModel: 'kiro-coder',
    apiFormat: 'openai-chat',
    authScheme: 'bearer',
    supportsPromptCaching: false,
    supportsTools: true,
    supportsStreaming: true,
    contextWindow: 200000,
    executor: 'kiro',
    oauth: {
      clientId: 'kiro-cli',
      tokenUrl: 'https://auth.kiro.ai/oauth/token',
      scopes: 'openid profile',
    },
  },
  antigravity: {
    id: 'antigravity',
    name: 'antigravity',
    displayName: 'Antigravity (Google)',
    emoji: '🚀',
    baseUrl: 'https://antigravity.googleapis.com/v1beta',
    apiKeyEnv: 'ANTIGRAVITY_API_KEY',
    defaultModel: 'gemini-2.5-flash',
    apiFormat: 'openai-chat',
    authScheme: 'bearer',
    supportsPromptCaching: false,
    supportsTools: true,
    supportsStreaming: true,
    contextWindow: 1048576,
    executor: 'antigravity',
    oauth: {
      clientId: '1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com',
      clientSecret: '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',
      authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenUrl: 'https://oauth2.googleapis.com/token',
      scopes: 'openid https://www.googleapis.com/auth/cloud-platform',
    },
  },
  'gemini-cli': {
    id: 'gemini-cli',
    name: 'gemini-cli',
    displayName: 'Gemini CLI',
    emoji: '💎',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    apiKeyEnv: 'GEMINI_API_KEY',
    defaultModel: 'gemini-2.5-flash',
    apiFormat: 'openai-chat',
    authScheme: 'bearer',
    supportsPromptCaching: false,
    supportsTools: true,
    supportsStreaming: true,
    contextWindow: 1048576,
    executor: 'gemini-cli',
    oauth: {
      clientId: '681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com',
      clientSecret: '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',
      authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenUrl: 'https://oauth2.googleapis.com/token',
      scopes: 'openid https://www.googleapis.com/auth/generative-language',
    },
  },
  azure: {
    id: 'azure',
    name: 'azure',
    displayName: 'Azure OpenAI',
    emoji: '☁️',
    baseUrl: '',
    apiKeyEnv: 'AZURE_OPENAI_API_KEY',
    defaultModel: 'gpt-4o',
    apiFormat: 'openai-chat',
    authScheme: 'bearer',
    supportsPromptCaching: false,
    supportsTools: true,
    supportsStreaming: true,
    contextWindow: 128000,
  },
  cohere: {
    id: 'cohere',
    name: 'cohere',
    displayName: 'Cohere',
    emoji: '🟢',
    baseUrl: 'https://api.cohere.ai/v1',
    apiKeyEnv: 'COHERE_API_KEY',
    defaultModel: 'command-a-03-2025',
    apiFormat: 'openai-chat',
    authScheme: 'bearer',
    supportsPromptCaching: false,
    supportsTools: true,
    supportsStreaming: true,
    contextWindow: 128000,
  },
  nebius: {
    id: 'nebius',
    name: 'nebius',
    displayName: 'Nebius AI',
    emoji: '🟣',
    baseUrl: 'https://api.studio.nebius.ai/v1',
    apiKeyEnv: 'NEBIUS_API_KEY',
    defaultModel: 'meta-llama/Llama-3.3-70B-Instruct',
    apiFormat: 'openai-chat',
    authScheme: 'bearer',
    supportsPromptCaching: false,
    supportsTools: true,
    supportsStreaming: true,
    contextWindow: 128000,
  },
  'cloudflare-ai': {
    id: 'cloudflare-ai',
    name: 'cloudflare-ai',
    displayName: 'Cloudflare AI',
    emoji: '🟠',
    baseUrl: 'https://api.cloudflare.com/client/v4/accounts',
    apiKeyEnv: 'CLOUDFLARE_API_TOKEN',
    defaultModel: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
    apiFormat: 'openai-chat',
    authScheme: 'bearer',
    supportsPromptCaching: false,
    supportsTools: true,
    supportsStreaming: true,
    contextWindow: 128000,
  },
  siliconflow: {
    id: 'siliconflow',
    name: 'siliconflow',
    displayName: 'SiliconFlow',
    emoji: '💠',
    baseUrl: 'https://api.siliconflow.com/v1',
    apiKeyEnv: 'SILICONFLOW_API_KEY',
    defaultModel: 'deepseek-ai/DeepSeek-V3.2',
    apiFormat: 'openai-chat',
    authScheme: 'bearer',
    supportsPromptCaching: false,
    supportsTools: true,
    supportsStreaming: true,
    contextWindow: 128000,
  },
  hyperbolic: {
    id: 'hyperbolic',
    name: 'hyperbolic',
    displayName: 'Hyperbolic',
    emoji: '⚡',
    baseUrl: 'https://api.hyperbolic.xyz/v1',
    apiKeyEnv: 'HYPERBOLIC_API_KEY',
    defaultModel: 'meta-llama/Llama-3.3-70B-Instruct',
    apiFormat: 'openai-chat',
    authScheme: 'bearer',
    supportsPromptCaching: false,
    supportsTools: true,
    supportsStreaming: true,
    contextWindow: 128000,
  },
  chutes: {
    id: 'chutes',
    name: 'chutes',
    displayName: 'Chutes',
    emoji: '🪂',
    baseUrl: 'https://llm.chutes.ai/v1',
    apiKeyEnv: 'CHUTES_API_KEY',
    defaultModel: 'deepseek-ai/DeepSeek-R1',
    apiFormat: 'openai-chat',
    authScheme: 'bearer',
    supportsPromptCaching: false,
    supportsTools: true,
    supportsStreaming: true,
    contextWindow: 128000,
  },
  glm: {
    id: 'glm',
    name: 'glm',
    displayName: 'GLM (Z.ai)',
    emoji: '🔵',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    apiKeyEnv: 'GLM_API_KEY',
    defaultModel: 'glm-4-plus',
    apiFormat: 'openai-chat',
    authScheme: 'bearer',
    supportsPromptCaching: false,
    supportsTools: true,
    supportsStreaming: true,
    contextWindow: 128000,
  },
  kimi: {
    id: 'kimi',
    name: 'kimi',
    displayName: 'Kimi (Moonshot)',
    emoji: '🌙',
    baseUrl: 'https://api.moonshot.cn/v1',
    apiKeyEnv: 'KIMI_API_KEY',
    defaultModel: 'moonshot-v1-128k',
    apiFormat: 'openai-chat',
    authScheme: 'bearer',
    supportsPromptCaching: false,
    supportsTools: true,
    supportsStreaming: true,
    contextWindow: 128000,
  },
  cline: {
    id: 'cline',
    name: 'cline',
    displayName: 'Cline',
    emoji: '🤖',
    baseUrl: 'https://api.cline.bot/api/v1',
    apiKeyEnv: 'CLINE_API_KEY',
    defaultModel: 'anthropic/claude-sonnet-4-20250514',
    apiFormat: 'openai-chat',
    authScheme: 'bearer',
    supportsPromptCaching: false,
    supportsTools: true,
    supportsStreaming: true,
    contextWindow: 200000,
    oauth: {
      authorizeUrl: 'https://api.cline.bot/api/v1/auth/authorize',
      tokenUrl: 'https://api.cline.bot/api/v1/auth/token',
    },
  },
  codebuddy: {
    id: 'codebuddy',
    name: 'codebuddy',
    displayName: 'CodeBuddy (Tencent)',
    emoji: '🐧',
    baseUrl: 'https://copilot.tencent.com/v1',
    apiKeyEnv: 'CODEBUDDY_API_KEY',
    defaultModel: 'hunyuan-turbos-latest',
    apiFormat: 'openai-chat',
    authScheme: 'bearer',
    supportsPromptCaching: false,
    supportsTools: true,
    supportsStreaming: true,
    contextWindow: 256000,
  },
  kilocode: {
    id: 'kilocode',
    name: 'kilocode',
    displayName: 'Kilo Code',
    emoji: '⚖️',
    baseUrl: 'https://api.kilocode.ai/v1',
    apiKeyEnv: 'KILOCODE_API_KEY',
    defaultModel: 'claude-sonnet-4-20250514',
    apiFormat: 'openai-chat',
    authScheme: 'bearer',
    supportsPromptCaching: false,
    supportsTools: true,
    supportsStreaming: true,
    contextWindow: 200000,
  },
  commandcode: {
    id: 'commandcode',
    name: 'commandcode',
    displayName: 'CommandCode',
    emoji: '💻',
    baseUrl: 'https://api.commandcode.dev/v1',
    apiKeyEnv: 'COMMANDCODE_API_KEY',
    defaultModel: 'deepseek-ai/deepseek-chat',
    apiFormat: 'openai-chat',
    authScheme: 'bearer',
    supportsPromptCaching: false,
    supportsTools: true,
    supportsStreaming: true,
    contextWindow: 128000,
  },
  blackbox: {
    id: 'blackbox',
    name: 'blackbox',
    displayName: 'Blackbox AI',
    emoji: '⬛',
    baseUrl: 'https://api.blackbox.ai/v1',
    apiKeyEnv: 'BLACKBOX_API_KEY',
    defaultModel: 'blackboxai',
    apiFormat: 'openai-chat',
    authScheme: 'bearer',
    supportsPromptCaching: false,
    supportsTools: true,
    supportsStreaming: true,
    contextWindow: 128000,
  },
  'vercel-ai': {
    id: 'vercel-ai',
    name: 'vercel-ai',
    displayName: 'Vercel AI Gateway',
    emoji: '▲',
    baseUrl: 'https://ai-gateway.vercel.sh/v1',
    apiKeyEnv: 'VERCEL_AI_API_KEY',
    defaultModel: 'openai/gpt-4o',
    apiFormat: 'openai-chat',
    authScheme: 'bearer',
    supportsPromptCaching: false,
    supportsTools: true,
    supportsStreaming: true,
    contextWindow: 128000,
  },
  volcengine: {
    id: 'volcengine',
    name: 'volcengine',
    displayName: 'Volcengine (ByteDance)',
    emoji: '🌋',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    apiKeyEnv: 'VOLCENGINE_API_KEY',
    defaultModel: 'deepseek-v3',
    apiFormat: 'openai-chat',
    authScheme: 'bearer',
    supportsPromptCaching: false,
    supportsTools: true,
    supportsStreaming: true,
    contextWindow: 128000,
  },
  'opencode-go': {
    id: 'opencode-go',
    name: 'opencode-go',
    displayName: 'OpenCode Go',
    emoji: '🐹',
    baseUrl: 'https://api.opencode.ai/v1',
    apiKeyEnv: 'OPENCODE_GO_API_KEY',
    defaultModel: 'gpt-4o',
    apiFormat: 'openai-chat',
    authScheme: 'bearer',
    supportsPromptCaching: false,
    supportsTools: true,
    supportsStreaming: true,
    contextWindow: 128000,
  },
  'mimo-free': {
    id: 'mimo-free',
    name: 'mimo-free',
    displayName: 'MiMo Free',
    emoji: '📱',
    baseUrl: 'https://api.mimo.ai/v1',
    apiKeyEnv: 'MIMO_FREE_API_KEY',
    defaultModel: 'mimo-v2',
    apiFormat: 'openai-chat',
    authScheme: 'bearer',
    supportsPromptCaching: false,
    supportsTools: true,
    supportsStreaming: true,
    contextWindow: 128000,
  },
  'xiaomi-tokenplan': {
    id: 'xiaomi-tokenplan',
    name: 'xiaomi-tokenplan',
    displayName: 'Xiaomi TokenPlan',
    emoji: '📱',
    baseUrl: 'https://api.xiaomi.com/v1',
    apiKeyEnv: 'XIAOMI_TOKENPLAN_API_KEY',
    defaultModel: 'mimo-v2.5-pro',
    apiFormat: 'openai-chat',
    authScheme: 'bearer',
    supportsPromptCaching: false,
    supportsTools: true,
    supportsStreaming: true,
    contextWindow: 128000,
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
    ['custom', 'TOKENROUTER_API_KEY'], // TokenRouter → custom provider
    ['gemini', 'GEMINI_API_KEY'],
    ['gemini', 'GOOGLE_API_KEY'], // Google API key → Gemini (not OpenAI)
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
    ['qoder', 'QODER_API_KEY'],
    ['kiro', 'KIRO_API_KEY'],
    ['antigravity', 'ANTIGRAVITY_API_KEY'],
    ['cohere', 'COHERE_API_KEY'],
    ['nebius', 'NEBIUS_API_KEY'],
    ['cloudflare-ai', 'CLOUDFLARE_API_TOKEN'],
    ['siliconflow', 'SILICONFLOW_API_KEY'],
    ['hyperbolic', 'HYPERBOLIC_API_KEY'],
    ['chutes', 'CHUTES_API_KEY'],
    ['glm', 'GLM_API_KEY'],
    ['kimi', 'KIMI_API_KEY'],
    ['cline', 'CLINE_API_KEY'],
    ['codebuddy', 'CODEBUDDY_API_KEY'],
    ['kilocode', 'KILOCODE_API_KEY'],
    ['commandcode', 'COMMANDCODE_API_KEY'],
    ['blackbox', 'BLACKBOX_API_KEY'],
    ['vercel-ai', 'VERCEL_AI_API_KEY'],
    ['volcengine', 'VOLCENGINE_API_KEY'],
    ['azure', 'AZURE_OPENAI_API_KEY'],
    ['bedrock', 'AWS_BEARER_TOKEN_BEDROCK'],
    ['vertex', 'GOOGLE_APPLICATION_CREDENTIALS'], // Note: Vertex needs ADC/service-account, not just a path
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
