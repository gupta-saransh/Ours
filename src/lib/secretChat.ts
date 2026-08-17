import { ApiError, api } from './api';

/**
 * Secret chat, client side: the unlock grant and the countdown maths.
 *
 * THE GRANT LIVES IN MEMORY AND NOWHERE ELSE. Not localStorage, not a cookie,
 * not the auth module beside the session token. Everything else in this app
 * that persists a token does so to survive a reload; this one must NOT, because
 * surviving a reload is exactly what an unlock should not do. Closing the tab,
 * reloading, or leaving it alone for fifteen minutes all re-lock the thread,
 * and none of that needs any code to remember to run.
 */

let grant: { token: string; expiresAtMs: number } | null = null;

/** Fires whenever the lock state changes, so the screen can re-render itself locked. */
type Listener = (unlocked: boolean) => void;
const listeners = new Set<Listener>();

function emit(): void {
  const state = isUnlocked();
  for (const fn of listeners) fn(state);
}

export function onLockChange(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function isUnlocked(now: number = Date.now()): boolean {
  return !!grant && grant.expiresAtMs > now;
}

export function lock(): void {
  grant = null;
  emit();
}

function hold(token: string, expiresIn: number): void {
  // Expire the local copy slightly early so a request is never sent with a
  // grant the server is about to reject: a 401 mid-send would look like a bug
  // to the person typing.
  grant = { token, expiresAtMs: Date.now() + Math.max(0, expiresIn - 5) * 1000 };
  emit();
}

/** Status of the code itself (is one set, are we locked out). Needs no grant. */
export function codeStatus(): Promise<{ hasCode: boolean; lockedOut: boolean; waitMinutes: number }> {
  return api('/api/secret-code');
}

/** Set or reset the 4-digit code. Requires the ACCOUNT password, always, even the first time. */
export async function setCode(password: string, code: string): Promise<void> {
  const res = await api<{ token: string; expiresIn: number }>('/api/secret-code', {
    method: 'POST',
    body: { password, code },
  });
  // The server hands back a grant so setting a code drops you straight in
  // rather than immediately asking for what you just typed.
  hold(res.token, res.expiresIn);
}

export async function unlock(code: string): Promise<void> {
  const res = await api<{ token: string; expiresIn: number }>('/api/secret-code/unlock', {
    method: 'POST',
    body: { code },
  });
  hold(res.token, res.expiresIn);
}

/**
 * Every secret-thread call goes through here. A 401 means the grant died (its
 * fifteen minutes ran out, or the server restarted), so we drop it and let the
 * screen fall back to the lock. That is the auto-relock: no timer to schedule,
 * no state to reconcile.
 */
export async function secretApi<T = any>(
  path: string,
  opts: { method?: string; body?: unknown } = {}
): Promise<T> {
  if (!isUnlocked()) {
    lock();
    throw new ApiError(401, 'Locked');
  }
  try {
    return await api<T>(path, { ...opts, headers: { 'X-Secret-Token': grant!.token } });
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) lock();
    throw err;
  }
}

/* --------------------------------------------------------------------------
 * Countdown display. Pure, and tested in secretChat.test.ts.
 * ------------------------------------------------------------------------ */

export function remainingMs(expiresAt: string | null | undefined, now: number = Date.now()): number | null {
  if (!expiresAt) return null; // kept, or the timer was off
  const at = new Date(expiresAt).getTime();
  if (!Number.isFinite(at)) return null;
  return Math.max(0, at - now);
}

/**
 * A compact "how long is left" for a bubble footer: 6d, 23h, 45m, 12s. One unit
 * only, and always the largest that still reads as true, because a message with
 * an hour left does not need to know about seconds and a bubble has no room to
 * say so. Rounds UP within a unit, so a message never shows "0m" while it is
 * still readable.
 */
export function formatRemaining(ms: number | null): string | null {
  if (ms === null) return null;
  if (ms <= 0) return 'gone';
  const seconds = Math.ceil(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.ceil(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.ceil(hours / 24)}d`;
}

/**
 * How often the countdown needs redrawing: once a second while it is showing
 * seconds, once a minute after that, and never at all when there is no timer.
 * A one-second tick across a whole thread of day-long timers would be pure
 * waste, and on a phone that waste is battery.
 */
export function tickIntervalMs(smallestRemaining: number | null): number | null {
  if (smallestRemaining === null) return null;
  if (smallestRemaining <= 60_000) return 1_000;
  return 30_000;
}
