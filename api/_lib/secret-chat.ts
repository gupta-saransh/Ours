/**
 * Secret chat: the pure rules. No database, no crypto, no React, so every
 * decision in here is unit-testable under plain node (secret-chat.test.ts).
 *
 * The two things worth reading before changing anything:
 *
 *  1. A message's timer is stamped AT SEND TIME and never rewritten. Changing
 *     the couple's timer from 24 hours to 1 minute affects messages sent after
 *     the change and nothing else; change it back and the next ones get 24
 *     hours again. Existing messages always keep the deal they were sent under.
 *     This is WhatsApp's rule and it is the one the feature was specified with.
 *
 *  2. On any disagreement, the DESTRUCTIVE action wins. Either partner may keep
 *     a message, either may un-keep it, either may delete it outright, and
 *     un-keeping restores the ORIGINAL deadline rather than granting a fresh
 *     window, so a message rescued past its time disappears the moment the
 *     rescue is withdrawn.
 */

/** The couple's timer choices. The client renders whatever this list says; it is never duplicated client-side. */
export const TTL_OPTIONS: { seconds: number; label: string }[] = [
  { seconds: 60, label: '1 minute' },
  { seconds: 3600, label: '1 hour' },
  { seconds: 86_400, label: '24 hours' },
  { seconds: 604_800, label: '7 days' },
  { seconds: 0, label: 'Off, messages stay' },
];

export const DEFAULT_TTL_SECONDS = 86_400;

/** Wrong tries allowed before the first lockout, then again between each escalation. */
export const FAILURES_PER_LOCKOUT = 5;
const MAX_LOCKOUT_MINUTES = 60;

export function isValidTtl(seconds: unknown): seconds is number {
  return typeof seconds === 'number' && TTL_OPTIONS.some((o) => o.seconds === seconds);
}

export function ttlLabel(seconds: number): string {
  return TTL_OPTIONS.find((o) => o.seconds === seconds)?.label ?? `${seconds} seconds`;
}

/**
 * When a message sent now under `ttlSeconds` should die. Null means never: the
 * timer was off, so the message persists (still sealed, still behind the code).
 */
export function expiryFor(createdAt: Date | string, ttlSeconds: number | null | undefined): Date | null {
  if (!ttlSeconds || ttlSeconds <= 0) return null;
  const base = typeof createdAt === 'string' ? new Date(createdAt) : createdAt;
  const ms = base.getTime();
  if (!Number.isFinite(ms)) return null;
  return new Date(ms + ttlSeconds * 1000);
}

export function isExpired(expiresAt: Date | string | null | undefined, now: Date | number = Date.now()): boolean {
  if (!expiresAt) return false; // null = kept, or timer off
  const at = typeof expiresAt === 'string' ? new Date(expiresAt).getTime() : expiresAt.getTime();
  if (!Number.isFinite(at)) return false; // unreadable stamp must not silently vanish a message
  const nowMs = typeof now === 'number' ? now : now.getTime();
  return at <= nowMs;
}

/**
 * Un-keeping restores the message's ORIGINAL deadline, measured from when the
 * timer actually started (the moment the other person read it), so by then it
 * is usually already past and the message goes immediately. Deliberately not
 * "now + the current timer": that would let keep-then-unkeep be used to EXTEND
 * a message's life, the opposite of what the button means.
 *
 * A message un-kept before it was ever read has no start yet, so it returns to
 * WAITING (null) rather than being handed a fresh window.
 */
export function unkeepExpiry(
  timerStartedAt: Date | string | null | undefined,
  ttlSeconds: number | null | undefined
): Date | null {
  if (!timerStartedAt) return null;
  return expiryFor(timerStartedAt, ttlSeconds);
}

/**
 * Whether a message is still waiting to be read, and so has not begun counting
 * down. Distinct from "kept" (paused on purpose) and from "timer off".
 */
export function isAwaitingRead(m: {
  ttl_seconds: number | null;
  timer_started_at: string | Date | null;
  kept_by: string | null;
  expires_at: string | Date | null;
}): boolean {
  return !!m.ttl_seconds && m.ttl_seconds > 0 && !m.timer_started_at && !m.kept_by && !m.expires_at;
}

/** A 4-digit code, and nothing else. Leading zeros are meaningful, so this stays a string everywhere. */
export function isValidCode(code: unknown): code is string {
  return typeof code === 'string' && /^\d{4}$/.test(code);
}

/**
 * Escalating backoff: no lock for the first few wrong tries, then a lockout that
 * doubles every further batch, capped at an hour. 10,000 combinations against
 * this is not a practical attack, while an honest fumble costs a minute.
 */
export function lockoutMinutesFor(failures: number): number {
  if (!Number.isFinite(failures) || failures < FAILURES_PER_LOCKOUT) return 0;
  const step = Math.floor(failures / FAILURES_PER_LOCKOUT); // 1 at 5 failures, 2 at 10, ...
  return Math.min(MAX_LOCKOUT_MINUTES, 2 ** (step - 1));
}

export function lockoutUntil(failures: number, now: Date | number = Date.now()): Date | null {
  const minutes = lockoutMinutesFor(failures);
  if (minutes <= 0) return null;
  const nowMs = typeof now === 'number' ? now : now.getTime();
  return new Date(nowMs + minutes * 60_000);
}

export function isLockedOut(
  lockedUntil: Date | string | null | undefined,
  now: Date | number = Date.now()
): boolean {
  if (!lockedUntil) return false;
  const at = typeof lockedUntil === 'string' ? new Date(lockedUntil).getTime() : lockedUntil.getTime();
  if (!Number.isFinite(at)) return false;
  const nowMs = typeof now === 'number' ? now : now.getTime();
  return at > nowMs;
}

export type CodeState = 'unset' | 'locked' | 'ok';

/**
 * Whether an unlock attempt may even be TRIED, before the code itself is
 * compared. Split out from the comparison so the route never does a scrypt
 * verify for a locked-out account, and so this branch is testable without
 * hashing anything.
 */
export function codeGateState(
  account: { secret_code_hash: string | null; secret_code_locked_until: string | Date | null },
  now: Date | number = Date.now()
): CodeState {
  if (!account.secret_code_hash) return 'unset';
  if (isLockedOut(account.secret_code_locked_until, now)) return 'locked';
  return 'ok';
}

/** Minutes still to wait, rounded up, for the "try again in N minutes" line. */
export function lockoutRemainingMinutes(
  lockedUntil: Date | string | null | undefined,
  now: Date | number = Date.now()
): number {
  if (!isLockedOut(lockedUntil, now)) return 0;
  const at = typeof lockedUntil === 'string' ? new Date(lockedUntil!).getTime() : (lockedUntil as Date).getTime();
  const nowMs = typeof now === 'number' ? now : now.getTime();
  return Math.max(1, Math.ceil((at - nowMs) / 60_000));
}

/**
 * The notice posted into the thread when someone changes the timer. Plaintext
 * and contentless by design: it names a person and a duration, never anything
 * either of them said, so it is safe to leave behind permanently as the record
 * of who changed what and when. Consent is the whole point of this feature, so
 * a timer change is never silent.
 */
export function timerChangeNotice(who: string, seconds: number): string {
  if (seconds <= 0) return `${who} turned off disappearing messages`;
  return `${who} set messages to disappear after ${ttlLabel(seconds)}`;
}
