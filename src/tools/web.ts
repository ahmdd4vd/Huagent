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
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'huagent/0.1.0' },
      signal: AbortSignal.timeout(15000),
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
