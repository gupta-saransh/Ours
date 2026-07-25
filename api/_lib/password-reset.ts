import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';

/**
 * Pure-ish helpers for the forgot-password flow, kept out of the route so the
 * validity rules can be unit-tested without a DB or an email service (same
 * spirit as streak.ts / game-rounds.ts). The only non-deterministic piece is
 * generateResetCode(); everything else is a deterministic function of its
 * inputs.
 *
 * We never store the emailed code. We store a KEYED hash of it (HMAC-SHA256
 * under a server secret), so a database leak yields no working codes. A plain
 * SHA-256 would be brute-forceable for a 6-digit space (a million guesses); the
 * HMAC key makes the hash useless without the server secret.
 */

/** How long a code stays valid after it is issued. */
export const RESET_CODE_TTL_MS = 10 * 60 * 1000; // 10 minutes
/** How many codes one email may request inside the window before we go quiet. */
export const RESET_RATE_LIMIT = 5;
export const RESET_RATE_WINDOW_MS = 60 * 60 * 1000; // 1 hour

/** A fresh 6-digit numeric code, zero-padded, uniformly random. */
export function generateResetCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

/** The keyed hash we actually store. `pepper` is a server secret (JWT_SECRET). */
export function hashResetCode(code: string, pepper: string): string {
  return createHmac('sha256', pepper).update(code).digest('hex');
}

/** Constant-time check that `code` hashes to `storedHash`. */
export function verifyResetCodeHash(code: string, pepper: string, storedHash: string): boolean {
  const expected = Buffer.from(hashResetCode(code, pepper), 'hex');
  let actual: Buffer;
  try {
    actual = Buffer.from(storedHash, 'hex');
  } catch {
    return false;
  }
  // timingSafeEqual throws on a length mismatch; a valid HMAC-SHA256 is always
  // 32 bytes, so a wrong length is simply a non-match.
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

export type ResetCodeStatus = 'ok' | 'missing' | 'used' | 'expired' | 'mismatch';

export interface StoredResetCode {
  code_hash: string;
  expires_at: string | Date;
  used_at: string | Date | null;
}

/**
 * Whether a stored code can be redeemed right now. Checks are ordered used ->
 * expired -> mismatch, but the route collapses every non-'ok' into ONE generic
 * message, so the ordering never leaks which specific thing was wrong.
 */
export function resetCodeStatus(
  row: StoredResetCode | null | undefined,
  code: string,
  pepper: string,
  now: number
): ResetCodeStatus {
  if (!row) return 'missing';
  if (row.used_at) return 'used';
  if (new Date(row.expires_at).getTime() <= now) return 'expired';
  if (!verifyResetCodeHash(code, pepper, row.code_hash)) return 'mismatch';
  return 'ok';
}
