import { Platform } from 'react-native';
import { apiUrl, getAuthToken } from './api';

/**
 * Client-side logging.
 *
 * Events are buffered and POSTed in small batches to /api/logs, which forwards
 * them into the same structured pipeline as server logs (stdout + Axiom), so one
 * search shows a user tapping "turn on notifications" and the server storing the
 * subscription moments later.
 *
 * PRIVACY: same rule as the server. Log what happened, never what was written.
 * No note/message/wishlist text, no email addresses, no tokens. Fields are
 * primitives only, and the server trims them again on arrival.
 */

type Level = 'debug' | 'info' | 'warn' | 'error';
type Fields = Record<string, string | number | boolean | null | undefined>;

interface ClientEvent {
  t: string;
  level: Level;
  event: string;
  fields: Fields;
}

const FLUSH_DELAY_MS = 3000;
const MAX_BATCH = 20;
const MAX_BUFFER = 100;

/** Correlates every line from one app load. Random, not tied to the account. */
const sessionId = Math.random().toString(36).slice(2, 10);

let buffer: ClientEvent[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let sending = false;

function platformFields(): Fields {
  const standalone =
    Platform.OS === 'web' && typeof window !== 'undefined'
      ? // iOS home-screen PWA reports standalone; useful when push behaves
        // differently in the installed app than in the browser tab.
        (window.navigator as any)?.standalone === true ||
        window.matchMedia?.('(display-mode: standalone)')?.matches === true
      : undefined;
  return { platform: Platform.OS, standalone };
}

/** Record a client event. Never throws; safe to call from anywhere. */
export function logEvent(event: string, fields: Fields = {}, level: Level = 'info'): void {
  if (buffer.length >= MAX_BUFFER) return;
  buffer.push({ t: new Date().toISOString(), level, event, fields });
  if (buffer.length >= MAX_BATCH) {
    void flushEvents();
    return;
  }
  if (!timer) timer = setTimeout(() => void flushEvents(), FLUSH_DELAY_MS);
}

export const logClientError = (event: string, fields: Fields = {}) => logEvent(event, fields, 'error');
export const logClientWarn = (event: string, fields: Fields = {}) => logEvent(event, fields, 'warn');

/** Ship whatever is buffered. Failures are swallowed: logging never breaks the app. */
export async function flushEvents(): Promise<void> {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (sending || buffer.length === 0) return;
  const batch = buffer;
  buffer = [];
  sending = true;
  try {
    const token = getAuthToken();
    // Deliberately raw fetch, not api(): api() reports its own failures through
    // this module, and that would loop.
    await fetch(apiUrl('/api/logs'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ session: sessionId, ...platformFields(), events: batch }),
    });
  } catch {
    // Offline or the endpoint is down. Drop the batch rather than retrying
    // forever; these are diagnostics, not data.
  } finally {
    sending = false;
  }
}

let installed = false;

/**
 * Catch what nobody caught. Called once from the root layout so an unhandled
 * error in any screen leaves a trace instead of just a blank surface.
 */
export function installGlobalLogging(): void {
  if (installed) return;
  installed = true;

  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    window.addEventListener('error', (e) => {
      logClientError('client.uncaught_error', {
        message: String(e.message ?? '').slice(0, 300),
        source: e.filename ? String(e.filename).split('/').pop() : undefined,
        line: e.lineno,
      });
    });
    window.addEventListener('unhandledrejection', (e) => {
      const reason: any = (e as PromiseRejectionEvent).reason;
      logClientError('client.unhandled_rejection', {
        message: String(reason?.message ?? reason ?? '').slice(0, 300),
      });
    });
    // A backgrounded tab may never come back; get the buffer out first.
    window.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') void flushEvents();
    });
  }

  logEvent('client.session_start', {
    ...platformFields(),
    // Tells the installed-PWA case apart from a plain browser tab in the logs.
    referrer: Platform.OS === 'web' && typeof document !== 'undefined' ? document.referrer.slice(0, 100) : undefined,
  });
}
