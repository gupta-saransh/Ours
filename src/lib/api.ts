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
  let res: Response;
  try {
    res = await fetch(apiUrl(path), {
      method: opts.method ?? 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
  } catch {
    throw new ApiError(0, 'Cannot reach the server. Check your connection.');
  }
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    // non-JSON response body
  }
  if (!res.ok) {
    throw new ApiError(res.status, data?.error ?? `Request failed (${res.status})`);
  }
  return data as T;
}
