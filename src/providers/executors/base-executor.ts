/**
 * BaseExecutor — Base class for provider executors.
 *
 * Inspired by 9router's executors/base.js. Each provider that needs custom
 * auth, URL building, or request transformation extends this class.
 *
 * Default providers (standard OpenAI-compat + Anthropic) use DefaultExecutor.
 * Special providers (Vertex, GitHub, Ollama, Qoder, Kiro, Antigravity) get
 * their own subclass.
 */

export interface ExecutorCredentials {
  apiKey?: string;
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: string;
  providerSpecificData?: Record<string, any>;
}

export interface ExecutorConfig {
  baseUrl: string;
  format: 'openai-chat' | 'anthropic' | 'openai-responses' | 'gemini' | 'vertex';
  headers?: Record<string, string>;
  auth?: {
    header?: string;
    scheme?: string;
  };
  /** Multiple base URLs for fallback */
  baseUrls?: string[];
  /** Provider-specific quirks */
  quirks?: Record<string, any>;
  /** Retry config per status code */
  retry?: Record<number, { attempts: number; delayMs: number }>;
  /** Connection timeout in ms */
  timeoutMs?: number;
  /** Custom executor identifier */
  executor?: string;
  /** OAuth fields (injected from registry oauth block) */
  clientId?: string;
  clientSecret?: string;
  tokenUrl?: string;
}

export interface ExecutorResult {
  response: Response;
  url: string;
  headers: Record<string, string>;
}

export const DEFAULT_TIMEOUT_MS = 30_000;
export const DEFAULT_RETRY: Record<number, { attempts: number; delayMs: number }> = {
  429: { attempts: 3, delayMs: 2000 },
  500: { attempts: 2, delayMs: 1000 },
  502: { attempts: 2, delayMs: 1000 },
  503: { attempts: 2, delayMs: 1500 },
};

export class BaseExecutor {
  protected provider: string;
  protected config: ExecutorConfig;

  constructor(provider: string, config: ExecutorConfig) {
    this.provider = provider;
    this.config = config;
  }

  getProvider(): string {
    return this.provider;
  }

  getBaseUrls(): string[] {
    return this.config.baseUrls || (this.config.baseUrl ? [this.config.baseUrl] : []);
  }

  /** Build the request URL. Override in subclass for custom URL patterns. */
  buildUrl(model: string, _stream: boolean, _urlIndex: number, _credentials: ExecutorCredentials): string {
    const baseUrls = this.getBaseUrls();
    return baseUrls[0] || this.config.baseUrl;
  }

  /** Build request headers. Override for custom auth schemes. */
  buildHeaders(credentials: ExecutorCredentials, stream: boolean): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...this.config.headers,
    };

    // Standard auth: apiKey or accessToken
    const authHeader = this.config.auth?.header || 'Authorization';
    const authScheme = this.config.auth?.scheme || 'bearer';

    if (credentials.accessToken) {
      headers[authHeader] = authScheme === 'raw'
        ? credentials.accessToken
        : `Bearer ${credentials.accessToken}`;
    } else if (credentials.apiKey) {
      if (authHeader === 'x-api-key' || authScheme === 'x-api-key') {
        headers['x-api-key'] = credentials.apiKey;
      } else {
        headers[authHeader] = authScheme === 'raw'
          ? credentials.apiKey
          : `Bearer ${credentials.apiKey}`;
      }
    }

    if (stream) {
      headers['Accept'] = 'text/event-stream';
    }

    return headers;
  }

  /** Transform the request body. Override for provider-specific body mutations. */
  transformRequest(_model: string, body: any, _stream: boolean, _credentials: ExecutorCredentials): any {
    return body;
  }

  /**
   * Refresh expired credentials (OAuth tokens, JWT assertions, etc).
   * Override in subclass. Returns updated credentials or null if no refresh needed.
   */
  async refreshCredentials(_credentials: ExecutorCredentials): Promise<ExecutorCredentials | null> {
    return null;
  }

  /** Check if credentials need refresh. Override for provider-specific logic. */
  needsRefresh(credentials: ExecutorCredentials): boolean {
    if (!credentials.expiresAt) return false;
    const expiresMs = new Date(credentials.expiresAt).getTime();
    return expiresMs - Date.now() < 5 * 60 * 1000; // 5 min lead time
  }

  /**
   * Execute an HTTP request with retry + multi-URL fallback.
   */
  async execute(params: {
    model: string;
    body: any;
    stream: boolean;
    credentials: ExecutorCredentials;
    signal?: AbortSignal;
  }): Promise<ExecutorResult> {
    const { model, body, stream, credentials, signal } = params;
    const baseUrls = this.getBaseUrls();
    const retryConfig = { ...DEFAULT_RETRY, ...this.config.retry };
    const timeoutMs = this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    let lastError: Error | null = null;

    for (let urlIndex = 0; urlIndex < baseUrls.length; urlIndex++) {
      const url = this.buildUrl(model, stream, urlIndex, credentials);
      const headers = this.buildHeaders(credentials, stream);
      const transformedBody = this.transformRequest(model, body, stream, credentials);

      // Connection timeout
      const connectCtrl = new AbortController();
      const timer = setTimeout(() => connectCtrl.abort(new Error('connect timeout')), timeoutMs);
      const mergedSignal = signal
        ? AbortSignal.any([signal, connectCtrl.signal])
        : connectCtrl.signal;

      try {
        const response = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(transformedBody),
          signal: mergedSignal,
        });
        clearTimeout(timer);

        // Retry on rate limit / server error
        const retryEntry = retryConfig[response.status];
        if (retryEntry && urlIndex < baseUrls.length - 1) {
          lastError = new Error(`HTTP ${response.status}`);
          continue; // try next URL
        }

        return { response, url, headers };
      } catch (err: any) {
        clearTimeout(timer);
        lastError = err;

        // Try next URL on network error
        if (urlIndex + 1 < baseUrls.length) continue;
        throw err;
      }
    }

    throw lastError || new Error(`All ${baseUrls.length} URLs failed`);
  }
}

export default BaseExecutor;
