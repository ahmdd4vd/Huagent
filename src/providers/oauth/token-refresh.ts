/**
 * OAuth token refresh system.
 *
 * Inspired by 9router's tokenRefresh.js + oauthCredentialManager.js.
 * Handles: Google OAuth, GitHub OAuth, Claude OAuth, Vertex JWT minting,
 * generic OAuth2 refresh, and credential caching.
 */

// ─── OAuth endpoints ───────────────────────────────────────────
export const OAUTH_ENDPOINTS = {
  google: {
    token: 'https://oauth2.googleapis.com/token',
    authorize: 'https://accounts.google.com/o/oauth2/v2/auth',
    deviceCode: 'https://oauth2.googleapis.com/device/code',
  },
  github: {
    token: 'https://github.com/login/oauth/access_token',
    authorize: 'https://github.com/login/oauth/authorize',
    deviceCode: 'https://github.com/login/device/code',
  },
  claude: {
    token: 'https://api.anthropic.com/v1/oauth/token',
    authorize: 'https://claude.ai/oauth/authorize',
  },
};

// ─── Google OAuth refresh ──────────────────────────────────────
export async function refreshGoogleToken(
  refreshToken: string,
  clientId: string,
  clientSecret: string,
): Promise<{ accessToken: string; expiresAt: string } | null> {
  try {
    const res = await fetch(OAUTH_ENDPOINTS.google.token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });

    if (!res.ok) return null;
    const { access_token, expires_in } = await res.json();
    return {
      accessToken: access_token,
      expiresAt: new Date(Date.now() + (expires_in ?? 3600) * 1000).toISOString(),
    };
  } catch {
    return null;
  }
}

// ─── GitHub OAuth refresh ──────────────────────────────────────
export async function refreshGitHubToken(
  refreshToken: string,
  clientId: string,
  clientSecret: string,
): Promise<{ accessToken: string; expiresAt: string; refreshToken?: string } | null> {
  try {
    const res = await fetch(OAUTH_ENDPOINTS.github.token, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });

    if (!res.ok) return null;
    const data = await res.json();
    return {
      accessToken: data.access_token,
      expiresAt: new Date(Date.now() + (data.expires_in ?? 28800) * 1000).toISOString(),
      refreshToken: data.refresh_token, // GitHub rotates refresh tokens
    };
  } catch {
    return null;
  }
}

// ─── Claude OAuth refresh ──────────────────────────────────────
export async function refreshClaudeToken(
  refreshToken: string,
  clientId: string,
): Promise<{ accessToken: string; expiresAt: string } | null> {
  try {
    const res = await fetch(OAUTH_ENDPOINTS.claude.token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: clientId,
      }),
    });

    if (!res.ok) return null;
    const data = await res.json();
    return {
      accessToken: data.access_token,
      expiresAt: new Date(Date.now() + (data.expires_in ?? 3600) * 1000).toISOString(),
    };
  } catch {
    return null;
  }
}

// ─── Generic OAuth2 refresh ────────────────────────────────────
export async function refreshAccessToken(
  refreshToken: string,
  tokenUrl: string,
  clientId: string,
  clientSecret?: string,
): Promise<{ accessToken: string; expiresAt: string } | null> {
  try {
    const params: Record<string, string> = {
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId,
    };
    if (clientSecret) params.client_secret = clientSecret;

    const res = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params),
    });

    if (!res.ok) return null;
    const data = await res.json();
    return {
      accessToken: data.access_token,
      expiresAt: new Date(Date.now() + (data.expires_in ?? 3600) * 1000).toISOString(),
    };
  } catch {
    return null;
  }
}

// ─── Credential Manager ────────────────────────────────────────
// Caches tokens and provides auto-refresh with locking.

interface CachedToken {
  accessToken: string;
  expiresAt: number; // ms
}

const tokenCache = new Map<string, CachedToken>();
const refreshLocks = new Map<string, Promise<any>>();

/** Check if a cached token is still valid (with lead time). */
function isTokenValid(cached: CachedToken, leadMs: number = 5 * 60 * 1000): boolean {
  return cached.expiresAt - Date.now() > leadMs;
}

/**
 * Get a valid access token, refreshing if needed.
 * Uses a lock to prevent concurrent refresh for the same provider.
 */
export async function getValidToken(
  provider: string,
  credentials: {
    apiKey?: string;
    accessToken?: string;
    refreshToken?: string;
    expiresAt?: string;
    clientId?: string;
    clientSecret?: string;
    tokenUrl?: string;
  },
): Promise<string | null> {
  // 1. If we have a valid access token with known expiry, use it
  if (credentials.accessToken && credentials.expiresAt) {
    const expiresMs = new Date(credentials.expiresAt).getTime();
    if (expiresMs - Date.now() > 5 * 60 * 1000) {
      return credentials.accessToken;
    }
  }

  // 2. Check cache
  const cached = tokenCache.get(provider);
  if (cached && isTokenValid(cached)) {
    return cached.accessToken;
  }

  // 3. Need refresh — use lock to prevent concurrent refresh
  const lockKey = provider;
  const existing = refreshLocks.get(lockKey);
  if (existing) return existing;

  const refreshPromise = (async () => {
    try {
      let result: { accessToken: string; expiresAt: string } | null = null;

      if (credentials.refreshToken) {
        // Provider-specific refresh
        switch (provider) {
          case 'gemini':
          case 'gemini-cli':
          case 'antigravity':
            result = await refreshGoogleToken(
              credentials.refreshToken,
              credentials.clientId || '',
              credentials.clientSecret || '',
            );
            break;
          case 'github':
            result = await refreshGitHubToken(
              credentials.refreshToken,
              credentials.clientId || '',
              credentials.clientSecret || '',
            );
            break;
          case 'claude':
            result = await refreshClaudeToken(
              credentials.refreshToken,
              credentials.clientId || '',
            );
            break;
          default:
            if (credentials.tokenUrl) {
              result = await refreshAccessToken(
                credentials.refreshToken,
                credentials.tokenUrl,
                credentials.clientId || '',
                credentials.clientSecret,
              );
            }
            break;
        }
      }

      if (result) {
        const expiresMs = new Date(result.expiresAt).getTime();
        tokenCache.set(provider, { accessToken: result.accessToken, expiresAt: expiresMs });
        return result.accessToken;
      }

      // Fallback to apiKey if no refresh worked
      return credentials.apiKey || credentials.accessToken || null;
    } finally {
      refreshLocks.delete(lockKey);
    }
  })();

  refreshLocks.set(lockKey, refreshPromise);
  return refreshPromise;
}

/** Clear cached tokens for a provider (or all). */
export function clearTokenCache(provider?: string): void {
  if (provider) {
    tokenCache.delete(provider);
  } else {
    tokenCache.clear();
  }
}
