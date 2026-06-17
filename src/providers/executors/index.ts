/**
 * Specialized executors for providers that need custom auth/URL/transformation.
 *
 * Each executor extends BaseExecutor and overrides the methods that differ
 * from the default OpenAI-compat / Anthropic behavior.
 */

import { BaseExecutor, type ExecutorConfig, type ExecutorCredentials, type ExecutorResult } from './base-executor.js';

// ─── Anthropic API version (shared) ────────────────────────────
const ANTHROPIC_API_VERSION = '2023-06-01';

// ─── VertexExecutor ────────────────────────────────────────────
// Google Cloud Vertex AI — SA JSON → JWT → Bearer token, or raw API key.
// URL: projects/{id}/locations/{loc}/publishers/google/models/{model}:streamGenerateContent

export class VertexExecutor extends BaseExecutor {
  constructor() {
    super('vertex', {
      baseUrl: 'https://aiplatform.googleapis.com',
      format: 'vertex',
    });
  }

  buildUrl(model: string, stream: boolean, _urlIndex: number, credentials: ExecutorCredentials): string {
    const action = stream ? 'streamGenerateContent' : 'generateContent';
    const saJson = this.parseSaJson(credentials.apiKey);
    const projectId = saJson?.project_id || credentials.providerSpecificData?.projectId;
    const location = credentials.providerSpecificData?.location || 'us-central1';

    if (projectId) {
      // Project-scoped path (OAuth/SA flow)
      let url = `https://aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${model}:${action}`;
      if (stream) url += '?alt=sse';
      return url;
    }

    // Raw API key: global publishers endpoint
    let url = `https://aiplatform.googleapis.com/v1/publishers/google/models/${model}:${action}`;
    if (stream) url += '?alt=sse';
    if (credentials.apiKey && !saJson) {
      url += stream ? `&key=${credentials.apiKey}` : `?key=${credentials.apiKey}`;
    }
    return url;
  }

  buildHeaders(credentials: ExecutorCredentials, stream: boolean): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (credentials.accessToken) {
      headers['Authorization'] = `Bearer ${credentials.accessToken}`;
    }
    if (stream) headers['Accept'] = 'text/event-stream';
    return headers;
  }

  private parseSaJson(apiKey?: string): any {
    if (!apiKey) return null;
    try {
      const parsed = JSON.parse(apiKey);
      return parsed.type === 'service_account' && parsed.client_email ? parsed : null;
    } catch { return null; }
  }
}

// ─── GitHubExecutor ────────────────────────────────────────────
// GitHub Copilot — special headers for client identity + Copilot token auth.

export class GitHubExecutor extends BaseExecutor {
  constructor() {
    super('github', {
      baseUrl: 'https://api.githubcopilot.com/v1/chat/completions',
      format: 'openai-chat',
      headers: {
        'copilot-integration-id': 'vscode-chat',
        'editor-version': 'vscode/1.110.0',
        'user-agent': 'GitHubCopilotChat/0.38.0',
        'openai-intent': 'conversation-panel',
        'x-github-api-version': '2025-04-01',
      },
    });
  }

  buildHeaders(credentials: ExecutorCredentials, stream: boolean): Record<string, string> {
    const headers = super.buildHeaders(credentials, stream);
    // GitHub uses Copilot token as Bearer
    if (credentials.providerSpecificData?.copilotToken) {
      headers['Authorization'] = `Bearer ${credentials.providerSpecificData.copilotToken}`;
    }
    return headers;
  }
}

// ─── OllamaExecutor ───────────────────────────────────────────
// Ollama local — no auth needed, custom base URL resolution.

export class OllamaExecutor extends BaseExecutor {
  constructor() {
    super('ollama', {
      baseUrl: 'http://localhost:11434/v1/chat/completions',
      format: 'openai-chat',
    });
  }

  buildUrl(_model: string, _stream: boolean, _urlIndex: number, credentials: ExecutorCredentials): string {
    const customHost = credentials.providerSpecificData?.baseUrl?.trim();
    const host = (customHost || 'http://localhost:11434').replace(/\/$/, '');
    return `${host}/v1/chat/completions`;
  }

  buildHeaders(_credentials: ExecutorCredentials, stream: boolean): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    // Ollama doesn't need auth, but OpenAI SDK requires a key.
    // We pass a dummy key so the SDK doesn't complain.
    headers['Authorization'] = 'Bearer ollama';
    if (stream) headers['Accept'] = 'text/event-stream';
    return headers;
  }
}

// ─── QoderExecutor ─────────────────────────────────────────────
// Qoder (Qoder AI) — OAuth-based with Bearer token.

export class QoderExecutor extends BaseExecutor {
  constructor() {
    super('qoder', {
      baseUrl: 'https://api.qoder.ai/v1/chat/completions',
      format: 'openai-chat',
      clientId: 'qoder-cli',
      tokenUrl: 'https://auth.qoder.ai/oauth/token',
    });
  }

  buildHeaders(credentials: ExecutorCredentials, stream: boolean): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (credentials.accessToken) {
      headers['Authorization'] = `Bearer ${credentials.accessToken}`;
    } else if (credentials.apiKey) {
      headers['Authorization'] = `Bearer ${credentials.apiKey}`;
    }
    if (stream) headers['Accept'] = 'text/event-stream';
    return headers;
  }
}

// ─── KiroExecutor ──────────────────────────────────────────────
// Amazon Kiro — AWS-style auth with session tokens.

export class KiroExecutor extends BaseExecutor {
  constructor() {
    super('kiro', {
      baseUrl: 'https://api.kiro.ai/v1/chat/completions',
      format: 'openai-chat',
      clientId: 'kiro-cli',
      tokenUrl: 'https://auth.kiro.ai/oauth/token',
    });
  }

  buildHeaders(credentials: ExecutorCredentials, stream: boolean): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': 'kiro-cli/1.0',
    };
    if (credentials.accessToken) {
      headers['Authorization'] = `Bearer ${credentials.accessToken}`;
    } else if (credentials.apiKey) {
      headers['Authorization'] = `Bearer ${credentials.apiKey}`;
    }
    if (stream) headers['Accept'] = 'text/event-stream';
    return headers;
  }
}

// ─── AntigravityExecutor ──────────────────────────────────────
// Antigravity (Google) — OAuth via Google Cloud with Gemini models.

export class AntigravityExecutor extends BaseExecutor {
  constructor() {
    super('antigravity', {
      baseUrl: 'https://antigravity.googleapis.com/v1beta/models',
      format: 'gemini',
      clientId: '1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com',
      clientSecret: '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',
      tokenUrl: 'https://oauth2.googleapis.com/token',
    });
  }

  buildUrl(model: string, stream: boolean, _urlIndex: number, _credentials: ExecutorCredentials): string {
    const action = stream ? 'streamGenerateContent' : 'generateContent';
    let url = `https://antigravity.googleapis.com/v1beta/models/${model}:${action}`;
    if (stream) url += '?alt=sse';
    return url;
  }

  buildHeaders(credentials: ExecutorCredentials, stream: boolean): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (credentials.accessToken) {
      headers['Authorization'] = `Bearer ${credentials.accessToken}`;
    }
    if (stream) headers['Accept'] = 'text/event-stream';
    return headers;
  }
}

// ─── Gemini CLI Executor ───────────────────────────────────────
// Google Gemini via AI Studio — x-goog-api-key header or OAuth Bearer.

export class GeminiCLIExecutor extends BaseExecutor {
  constructor() {
    super('gemini-cli', {
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta/models',
      format: 'gemini',
      auth: { header: 'x-goog-api-key', scheme: 'raw' },
      clientId: '681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com',
      clientSecret: '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',
      tokenUrl: 'https://oauth2.googleapis.com/token',
    });
  }

  buildUrl(model: string, stream: boolean, _urlIndex: number, credentials: ExecutorCredentials): string {
    const action = stream ? 'streamGenerateContent' : 'generateContent';
    let url = `${this.config.baseUrl}/${model}:${action}`;
    if (stream) url += '?alt=sse';
    // API key goes in URL for raw key auth
    if (credentials.apiKey && !credentials.accessToken) {
      url += stream ? `&key=${credentials.apiKey}` : `?key=${credentials.apiKey}`;
    }
    return url;
  }

  buildHeaders(credentials: ExecutorCredentials, stream: boolean): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (credentials.accessToken) {
      headers['Authorization'] = `Bearer ${credentials.accessToken}`;
    }
    if (stream) headers['Accept'] = 'text/event-stream';
    return headers;
  }
}

// ─── Executor Registry ─────────────────────────────────────────
// Map provider ids to their specialized executor instances.

const executors: Record<string, BaseExecutor> = {
  vertex: new VertexExecutor(),
  github: new GitHubExecutor(),
  ollama: new OllamaExecutor(),
  qoder: new QoderExecutor(),
  kiro: new KiroExecutor(),
  antigravity: new AntigravityExecutor(),
  'gemini-cli': new GeminiCLIExecutor(),
};

/** Get the executor for a provider. Falls back to BaseExecutor for standard providers. */
export function getExecutor(providerId: string, config?: ExecutorConfig): BaseExecutor {
  if (executors[providerId]) return executors[providerId];
  // Standard providers use the base executor with their config
  if (config) return new BaseExecutor(providerId, config);
  // Fallback: minimal config (shouldn't happen in production)
  return new BaseExecutor(providerId, { baseUrl: '', format: 'openai-chat' });
}

/** Check if a provider has a specialized executor. */
export function hasSpecializedExecutor(providerId: string): boolean {
  return providerId in executors;
}

