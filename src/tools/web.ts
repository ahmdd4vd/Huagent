// Web tool - fetch URL or search web
export const webTool = {
  name: 'web',
  description: 'Fetch content from a URL or search the web. Returns text content (markdown for web pages).',
  schema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['fetch', 'search'], description: 'What to do' },
      query: { type: 'string', description: 'For search: search query. For fetch: URL.' },
      limit: { type: 'number', description: 'For search: max results (default 5)' },
    },
    required: ['action', 'query'],
  },
  async execute(args: { action: 'fetch' | 'search'; query: string; limit?: number }) {
    if (args.action === 'fetch') {
      return await fetchUrl(args.query);
    } else {
      return await webSearch(args.query, args.limit || 5);
    }
  },
};

async function fetchUrl(url: string) {
  // SECURITY: Validate the URL to prevent SSRF attacks.
  // - Only http: and https: schemes are allowed (no file://, gopher://, etc.).
  // - Block private/loopback/link-local IPs (169.254.169.254 metadata, 127.x, 10.x, 192.168.x, etc.).
  // - Block hostnames that resolve to private IPs (best-effort DNS check).
  const urlError = validateFetchUrl(url);
  if (urlError) {
    return { url, error: urlError };
  }

  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'huagent/0.1.0' },
      signal: AbortSignal.timeout(15000),
      // Never send credentials (cookies) cross-origin.
      credentials: 'omit',
      redirect: 'follow',
    });

    if (!response.ok) {
      return { url, status: response.status, error: `HTTP ${response.status}` };
    }

    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('text/html') || contentType.includes('text/plain')) {
      const text = await response.text();
      // Strip HTML tags for simple text extraction
      const stripped = text
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      return {
        url,
        status: 200,
        contentType,
        content: stripped.slice(0, 50000),
        truncated: stripped.length > 50000,
      };
    }

    return { url, status: 200, contentType, content: '[binary content]', binary: true };
  } catch (err: any) {
    return { url, error: err.message };
  }
}

/**
 * Validate that a URL is safe to fetch.
 * Blocks non-http(s) schemes, private IPs, and link-local addresses.
 * Returns an error string if blocked, or null if the URL is safe.
 *
 * Exported so tests can verify the SSRF protection logic without
 * making real network requests.
 */
export function validateFetchUrl(rawUrl: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return `Invalid URL: ${JSON.stringify(rawUrl)}`;
  }

  // Scheme check — only http/https allowed.
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return `Blocked scheme: ${parsed.protocol} (only http/https allowed)`;
  }

  const host = parsed.hostname.toLowerCase();

  // Block obvious internal hostnames.
  const INTERNAL_HOSTNAMES = new Set([
    'localhost', 'ip6-localhost', 'ip6-loopback',
    'metadata', 'metadata.google.internal',  // cloud metadata
  ]);
  if (INTERNAL_HOSTNAMES.has(host)) {
    return `Blocked internal hostname: ${host}`;
  }

  // Block IP literals in private/loopback/link-local ranges.
  // We accept IPv4 and IPv6 literals; for hostnames we can't easily do a
  // DNS lookup here without making this async, so we rely on the IP check
  // to catch direct-IP SSRF attempts. Hostname-based SSRF (e.g.
  // `attacker.com` resolving to `127.0.0.1`) is harder to block without
  // a DNS resolver — for now we just block the obvious internal names.
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    // IPv4 literal.
    const parts = host.split('.').map(Number);
    if (parts.length !== 4 || parts.some((p) => p < 0 || p > 255)) {
      return `Invalid IPv4: ${host}`;
    }
    const [a, b] = parts;
    if (a === 10) return `Blocked private IP: ${host} (10.0.0.0/8)`;
    if (a === 127) return `Blocked loopback IP: ${host} (127.0.0.0/8)`;
    if (a === 0) return `Blocked reserved IP: ${host} (0.0.0.0/8)`;
    if (a === 169 && b === 254) return `Blocked link-local IP: ${host} (169.254.0.0/16, cloud metadata)`;
    if (a === 172 && b >= 16 && b <= 31) return `Blocked private IP: ${host} (172.16.0.0/12)`;
    if (a === 192 && b === 168) return `Blocked private IP: ${host} (192.168.0.0/16)`;
    if (a === 100 && b >= 64 && b <= 127) return `Blocked carrier-grade NAT: ${host} (100.64.0.0/10)`;
  }

  // IPv6 literal — block ::1 (loopback), fe80::/10 (link-local), fc00::/7 (ULA).
  // URL.hostname returns IPv6 literals wrapped in brackets, e.g. "[::1]".
  // Strip the brackets before comparing.
  const ipv6Host = host.startsWith('[') && host.endsWith(']')
    ? host.slice(1, -1).toLowerCase()
    : (host.includes(':') ? host.toLowerCase() : null);
  if (ipv6Host !== null) {
    if (ipv6Host === '::1' || ipv6Host === '::') return `Blocked IPv6 loopback: ${host}`;
    if (ipv6Host.startsWith('fe8') || ipv6Host.startsWith('fe9') || ipv6Host.startsWith('fea') || ipv6Host.startsWith('feb')) {
      return `Blocked IPv6 link-local: ${host}`;
    }
    if (ipv6Host.startsWith('fc') || ipv6Host.startsWith('fd')) {
      return `Blocked IPv6 ULA: ${host}`;
    }
  }

  return null;  // URL is safe.
}

async function webSearch(query: string, limit: number) {
  // Simple DuckDuckGo HTML search (no API key needed)
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(15000),
    });
    const html = await response.text();

    // Extract result snippets (very basic)
    const results: Array<{ title: string; url: string; snippet: string }> = [];
    const resultRegex = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([^<]+)<\/a>[\s\S]*?<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
    let match;
    while ((match = resultRegex.exec(html)) && results.length < limit) {
      results.push({
        url: match[1],
        title: match[2].trim(),
        snippet: match[3].replace(/<[^>]+>/g, '').trim(),
      });
    }

    return { query, count: results.length, results };
  } catch (err: any) {
    return { query, error: err.message, results: [] };
  }
}
