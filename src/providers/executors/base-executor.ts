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
      // BUGFIX: AbortSignal.any is Node 20+ only. Use a manual
      // listener-based combination for Node 18 compat.
      const mergedSignal = combineSignals([signal, connectCtrl.signal]);

      try {
        // BUGFIX: The previous "retry" logic was broken. It only moved
        // to the NEXT URL on retryable status — it never retried the
        // SAME URL. With a single base URL (the common case), no retry
        // happened at all. We now implement a real per-URL retry loop
        // using exponential backoff.
        const maxAttempts = 3;
        const retryDelayMs = 1000;

        let lastResponse: Response | null = null;
        let attempt = 0;
        while (attempt < maxAttempts) {
          try {
            const response = await fetch(url, {
              method: 'POST',
              headers,
              body: JSON.stringify(transformedBody),
              signal: mergedSignal,
            });
            clearTimeout(timer);

            // Check if this status is retryable.
            const statusRetry = retryConfig[response.status];
            if (statusRetry && attempt < maxAttempts - 1) {
              // Retry the SAME URL after a delay.
              await new Promise((r) => setTimeout(r, statusRetry.delayMs ?? retryDelayMs));
              attempt++;
              lastResponse = response; // keep for fallback
              continue;
            }
            return { response, url, headers };
          } catch (err: any) {
            clearTimeout(timer);
            // Network error — retry the same URL if attempts remain.
            if (attempt < maxAttempts - 1) {
              await new Promise((r) => setTimeout(r, retryDelayMs * Math.pow(2, attempt)));
              attempt++;
              lastError = err;
              continue;
            }
            // Out of retries — try next base URL if available.
            lastError = err;
            break;
          }
        }
        // If we got here with a lastResponse, return it (best effort).
        if (lastResponse) return { response: lastResponse, url, headers };
        // Otherwise fall through to next base URL.
        if (urlIndex + 1 < baseUrls.length) continue;
        throw lastError || new Error(`URL ${url} failed`);
      } catch (err: any) {
        clearTimeout(timer);
        lastError = err;
        if (urlIndex + 1 < baseUrls.length) continue;
        throw err;
      }
    }

    throw lastError || new Error(`All ${baseUrls.length} URLs failed`);
  }
}

export default BaseExecutor;

/**
 * Combine multiple AbortSignals into one. Uses AbortSignal.any when
 * available (Node 20+); falls back to a manual listener-based
 * implementation for Node 18 compatibility.
 */
function combineSignals(signals: (AbortSignal | undefined)[]): AbortSignal {
  const valid = signals.filter((s): s is AbortSignal => s !== undefined);
  if (valid.length === 0) return new AbortController().signal;
  if (valid.length === 1) return valid[0];
  const anyFn = (AbortSignal as any).any;
  if (typeof anyFn === 'function') return anyFn(valid);
  // Node 18 fallback.
  const controller = new AbortController();
  for (const s of valid) {
    if (s.aborted) {
      controller.abort(s.reason);
      break;
    }
    s.addEventListener('abort', () => controller.abort(s.reason), { once: true });
  }
  return controller.signal;
}
