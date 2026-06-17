/**
 * Proxy-aware fetch — supports HTTP_PROXY / HTTPS_PROXY / NO_PROXY env vars.
 *
 * Inspired by 9router's proxyFetch.js. Uses native fetch (Node 18+) with
 * an undici ProxyAgent when a proxy is configured.
 *
 * Priority:
 *   1. Explicit proxy passed via options
 *   2. HTTPS_PROXY / HTTP_PROXY env vars
 *   3. Direct fetch (no proxy)
 */

export interface ProxyOptions {
  /** Explicit proxy URL (e.g. "http://127.0.0.1:7890") */
  proxy?: string;
  /** Connection timeout in ms (default 30s) */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Check if a URL should bypass the proxy (NO_PROXY matching).
 */
function shouldBypassProxy(targetUrl: string, noProxy: string): boolean {
  if (!noProxy) return false;
  const host = new URL(targetUrl).hostname.toLowerCase();
  const entries = noProxy.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  for (const entry of entries) {
    if (entry === '*') return true;
    if (host === entry || host.endsWith('.' + entry)) return true;
  }
  return false;
}

/**
 * Resolve the proxy URL for a given target, checking env vars.
 */
function resolveProxyUrl(targetUrl: string, explicit?: string): string | null {
  if (explicit) return explicit;

  const noProxy = process.env.NO_PROXY || process.env.no_proxy || '';
  if (shouldBypassProxy(targetUrl, noProxy)) return null;

  const isHttps = targetUrl.startsWith('https://');
  const proxyUrl = isHttps
    ? (process.env.HTTPS_PROXY || process.env.https_proxy)
    : (process.env.HTTP_PROXY || process.env.http_proxy);

  return proxyUrl || null;
}

/**
 * Proxy-aware fetch. Drop-in replacement for native fetch with
 * automatic proxy detection and connection timeout.
 */
export async function proxyFetch(
  url: string,
  init: RequestInit = {},
  opts: ProxyOptions = {},
): Promise<Response> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const proxyUrl = resolveProxyUrl(url, opts.proxy);

  // Connection timeout via AbortController
  const connectCtrl = new AbortController();
  const timer = setTimeout(() => connectCtrl.abort(new Error('fetch connect timeout')), timeoutMs);
  const signal = init.signal
    ? AbortSignal.any([init.signal, connectCtrl.signal])
    : connectCtrl.signal;

  try {
    let fetchInit: RequestInit = { ...init, signal };

    if (proxyUrl) {
      // Use undici ProxyAgent for proxy support (Node 18+)
      try {
        // @ts-ignore — undici is bundled with Node 18+ but types may not be installed
        const undici = await import('undici');
        const dispatcher = new undici.ProxyAgent(proxyUrl);
        fetchInit = { ...fetchInit, dispatcher } as any;
        const response = await (undici.fetch as any)(url, fetchInit);
        clearTimeout(timer);
        return response as unknown as Response;
      } catch {
        // undici not available — fall through to direct fetch
      }
    }

    const response = await fetch(url, fetchInit);
    clearTimeout(timer);
    return response;
  } catch (err: any) {
    clearTimeout(timer);
    throw err;
  }
}

/**
 * Check if proxy is configured (for display/debug purposes).
 */
export function getProxyInfo(): { proxy: string | null; noProxy: string } {
  return {
    proxy: process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy || null,
    noProxy: process.env.NO_PROXY || process.env.no_proxy || '',
  };
}
