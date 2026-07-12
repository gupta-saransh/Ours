import type { VercelRequest, VercelResponse } from '@vercel/node';

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

type Handler = (req: VercelRequest, res: VercelResponse) => Promise<void>;

/**
 * Wraps a route: CORS for local dev (Expo dev server runs on a different
 * origin than `vercel dev`), method allow-list, and uniform JSON errors.
 */
export function route(methods: string[], handler: Handler): Handler {
  return async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', [...methods, 'OPTIONS'].join(', '));
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    if (!req.method || !methods.includes(req.method)) {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }
    try {
      await handler(req, res);
    } catch (err) {
      if (err instanceof HttpError) {
        res.status(err.status).json({ error: err.message });
      } else {
        console.error(err);
        res.status(500).json({ error: 'Something went wrong on our side.' });
      }
    }
  };
}

export function requireString(value: unknown, field: string, maxLen = 10_000): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new HttpError(400, `${field} is required`);
  }
  if (value.length > maxLen) {
    throw new HttpError(400, `${field} is too long`);
  }
  return value.trim();
}
