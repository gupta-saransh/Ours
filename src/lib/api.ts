const BASE = process.env.EXPO_PUBLIC_API_URL || '';

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

let authToken: string | null = null;
export function setAuthToken(token: string | null) {
  authToken = token;
}
export function getAuthToken() {
  return authToken;
}
export function apiUrl(path: string) {
  return `${BASE}${path}`;
}

export async function api<T = any>(
  path: string,
  opts: { method?: string; body?: unknown } = {}
): Promise<T> {
  const method = opts.method ?? 'GET';
  const startedAt = Date.now();
  let res: Response;
  try {
    res = await fetch(apiUrl(path), {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
  } catch {
    reportFailure(path, method, 0, 'network', Date.now() - startedAt);
    throw new ApiError(0, 'Cannot reach the server. Check your connection.');
  }
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    // non-JSON response body
  }
  if (!res.ok) {
    const message = data?.error ?? `Request failed (${res.status})`;
    reportFailure(path, method, res.status, message, Date.now() - startedAt);
    throw new ApiError(res.status, message);
  }
  return data as T;
}

/**
 * Report a failed call to the client logger. Lazily imported so this module
 * stays dependency-free (src/lib/log.ts imports from here), and never for the
 * log endpoint itself, which would loop.
 */
function reportFailure(path: string, method: string, status: number, message: string, ms: number): void {
  if (path.startsWith('/api/logs')) return;
  import('./log')
    .then(({ logClientError }) => {
      logClientError('client.api_failed', {
        path,
        method,
        status,
        // Server error copy, not user content.
        message: String(message).slice(0, 200),
        duration_ms: ms,
      });
    })
    .catch(() => {});
}
