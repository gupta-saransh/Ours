import { randomUUID } from 'node:crypto';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { errorFields, flushLogs, log } from './log';

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

type Handler = (req: VercelRequest, res: VercelResponse) => Promise<void>;

/**
 * Fields the request logger picks up from whatever the handler learned along the
 * way. `requireUser` stamps the user; routes may add their own context via
 * `logContext(req, {...})` so one request produces one rich line.
 */
export interface RequestContext {
  requestId: string;
  user_id?: string;
  couple_id?: string;
  [key: string]: unknown;
}

const CONTEXT = Symbol.for('ours.logContext');

export function logContext(req: VercelRequest, fields?: Record<string, unknown>): RequestContext {
  const holder = req as unknown as Record<symbol, RequestContext>;
  if (!holder[CONTEXT]) holder[CONTEXT] = { requestId: randomUUID() };
  if (fields) Object.assign(holder[CONTEXT], fields);
  return holder[CONTEXT];
}

function requestPath(req: VercelRequest): string {
  return (req.url ?? '').split('?')[0] || '/';
}

/**
 * Wraps a route: CORS for local dev (Expo dev server runs on a different
 * origin than `vercel dev`), method allow-list, uniform JSON errors, and one
 * structured log line per request.
 *
 * Logs are flushed AFTER the handler has written the response, so shipping them
 * never adds to the latency the user feels.
 */
export function route(methods: string[], handler: Handler): Handler {
  return async (req, res) => {
    const ctx = logContext(req);
    const startedAt = Date.now();
    let status = 200;
    let failure: Record<string, unknown> = {};

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', [...methods, 'OPTIONS'].join(', '));
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('X-Request-Id', ctx.requestId);

    // Preflights carry no signal; answer and stay out of the log.
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }

    try {
      if (!req.method || !methods.includes(req.method)) {
        status = 405;
        res.status(405).json({ error: 'Method not allowed' });
        return;
      }
      try {
        await handler(req, res);
        status = res.statusCode;
      } catch (err) {
        if (err instanceof HttpError) {
          // A 4xx is the API working as designed: record it, don't alarm.
          status = err.status;
          failure = { error: err.message };
          res.status(err.status).json({ error: err.message });
        } else {
          status = 500;
          failure = errorFields(err);
          res.status(500).json({ error: 'Something went wrong on our side.' });
        }
      }
    } finally {
      log(status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info', 'http.request', {
        ...ctx,
        method: req.method,
        path: requestPath(req),
        status,
        duration_ms: Date.now() - startedAt,
        ...failure,
      });
      // Response bytes are already out; this only keeps the lambda warm a moment.
      await flushLogs();
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
