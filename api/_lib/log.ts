/**
 * Structured logging.
 *
 * Every log line is a JSON object with an `event` name plus flat fields, written
 * to two places:
 *   1. stdout (always) — visible in `vercel logs` / the Vercel dashboard.
 *   2. Axiom (when AXIOM_TOKEN + AXIOM_DATASET are set) — searchable history,
 *      which is what you actually want when a cron ran hours ago and you are
 *      asking "did the push go out, and if not, why".
 *
 * Serverless shape: lines are buffered per invocation and shipped in ONE HTTP
 * call, flushed by `route()` AFTER the response has been written, so logging
 * never sits in the user's latency path. If Axiom is not configured (or the
 * ingest fails) nothing breaks and stdout still has everything.
 *
 * PRIVACY: this app holds a couple's private writing. Never log note/memory/
 * message bodies, prompt answers, wishlist titles, emails, tokens, or push
 * subscription endpoints in full. Log ids, counts, kinds, and reasons. String
 * values are truncated defensively below, but that is a backstop, not a licence.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogFields {
  [key: string]: unknown;
}

interface AxiomConfig {
  url: string;
  token: string;
}

const MAX_BUFFER = 500;
const MAX_STRING = 400;
const FLUSH_TIMEOUT_MS = 2500;

let buffer: Record<string, unknown>[] = [];

function axiomConfig(): AxiomConfig | null {
  const token = process.env.AXIOM_TOKEN;
  const dataset = process.env.AXIOM_DATASET;
  if (!token || !dataset) return null;
  // Axiom's EU region uses a different host; override with AXIOM_URL if needed.
  const base = (process.env.AXIOM_URL ?? 'https://api.axiom.co').replace(/\/+$/, '');
  return { url: `${base}/v1/datasets/${encodeURIComponent(dataset)}/ingest`, token };
}

/** Trim anything oversized so one stray field can never dump user content. */
function clean(fields: LogFields): LogFields {
  const out: LogFields = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    if (typeof value === 'string') {
      out[key] = value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
    } else if (value instanceof Error) {
      out[key] = value.message;
    } else if (value === null || typeof value !== 'object') {
      out[key] = value;
    } else {
      // Objects/arrays: keep them, but bounded.
      try {
        const json = JSON.stringify(value);
        out[key] = json.length > MAX_STRING ? `${json.slice(0, MAX_STRING)}…` : value;
      } catch {
        out[key] = '[unserializable]';
      }
    }
  }
  return out;
}

/** Flatten an unknown thrown value into loggable fields. */
export function errorFields(err: unknown): LogFields {
  if (err instanceof Error) {
    const anyErr = err as Error & { code?: unknown; statusCode?: unknown };
    return {
      error: err.message,
      error_name: err.name,
      error_code: anyErr.code !== undefined ? String(anyErr.code) : undefined,
      error_status: anyErr.statusCode !== undefined ? Number(anyErr.statusCode) : undefined,
      // First few frames only; a full stack is noise in a log search.
      stack: err.stack?.split('\n').slice(1, 5).join(' | '),
    };
  }
  return { error: typeof err === 'string' ? err : JSON.stringify(err) };
}

export function log(level: LogLevel, event: string, fields: LogFields = {}): void {
  const record = {
    _time: new Date().toISOString(),
    level,
    event,
    service: 'ours-api',
    env: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? 'development',
    ...clean(fields),
  };

  // stdout first, so a log line survives even if the process dies before flush.
  // (Unit tests exercise these paths constantly; keep their output readable.)
  if (!process.env.VITEST) {
    const line = JSON.stringify(record);
    if (level === 'error') console.error(line);
    else if (level === 'warn') console.warn(line);
    else console.log(line);
  }

  if (!axiomConfig()) return;
  if (buffer.length >= MAX_BUFFER) return; // never grow without bound
  buffer.push(record);
}

export const logInfo = (event: string, fields?: LogFields) => log('info', event, fields);
export const logWarn = (event: string, fields?: LogFields) => log('warn', event, fields);
export const logError = (event: string, fields?: LogFields) => log('error', event, fields);

type WaitUntil = (promise: Promise<unknown>) => void;

/**
 * Vercel's per-invocation `waitUntil`, if the platform is offering one.
 *
 * This matters more than it looks. `route()` flushes AFTER the response has been
 * written, and Vercel treats a finished response as a finished invocation: it
 * may FREEZE the container mid-fetch even though we are still awaiting. The
 * request hangs in limbo until the container thaws for the next request, at
 * which point our overdue 2.5s timer fires immediately and aborts it. The
 * symptom is an "axiom ingest error: This operation was aborted" printed at the
 * head of some LATER request's logs, and a silently dropped batch. Handing the
 * promise to `waitUntil` tells the platform to keep the invocation alive until
 * shipping is done, which is the whole fix.
 *
 * Read off the request-context global rather than taking a dependency on
 * `@vercel/functions` for one function call. If that contract ever changes we
 * simply fall back to awaiting, which is exactly today's behavior.
 */
function platformWaitUntil(): WaitUntil | null {
  try {
    const holder = (globalThis as Record<symbol, unknown>)[Symbol.for('@vercel/request-context')] as
      | { get?: () => { waitUntil?: unknown } | undefined }
      | undefined;
    const fn = holder?.get?.()?.waitUntil;
    return typeof fn === 'function' ? (fn as WaitUntil) : null;
  } catch {
    return null;
  }
}

/** POST one batch. Never throws; a lost log line must never cost a request. */
async function ship(config: AxiomConfig, batch: Record<string, unknown>[]): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FLUSH_TIMEOUT_MS);
  try {
    const res = await fetch(config.url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(batch),
      signal: controller.signal,
    });
    if (!res.ok) {
      // Deliberately console-only: re-logging through log() would recurse.
      console.error(`axiom ingest failed: ${res.status} ${await res.text().catch(() => '')}`.slice(0, 300));
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const aborted = controller.signal.aborted;
    console.error(
      aborted
        ? `axiom ingest gave up after ${FLUSH_TIMEOUT_MS}ms (${batch.length} lines dropped; stdout still has them)`
        : `axiom ingest error: ${message}`
    );
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Ship whatever is buffered. Safe to call any number of times; never throws and
 * never rejects. Call it after the response is written.
 *
 * When the platform offers `waitUntil` the returned promise resolves at once and
 * the platform owns the in-flight request; otherwise the caller's await is what
 * keeps it alive.
 */
export function flushLogs(): Promise<void> {
  const config = axiomConfig();
  if (!config || buffer.length === 0) return Promise.resolve();
  const batch = buffer;
  buffer = [];

  const shipped = ship(config, batch);
  const wait = platformWaitUntil();
  if (wait) {
    wait(shipped);
    return Promise.resolve();
  }
  return shipped;
}

/** True when logs are being shipped somewhere durable (used by diagnostics). */
export function loggingConfigured(): boolean {
  return axiomConfig() !== null;
}

/**
 * A push endpoint identifies the browser+device and is a capability URL, so we
 * log only its host (enough to tell Apple from Google from Mozilla) plus a short
 * fingerprint to correlate rows without storing the secret path.
 */
export function endpointHost(endpoint: string | null | undefined): string | undefined {
  if (!endpoint) return undefined;
  try {
    return new URL(endpoint).host;
  } catch {
    return 'invalid-endpoint';
  }
}
