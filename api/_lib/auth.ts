import 'dotenv/config';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { VercelRequest } from '@vercel/node';
import { one } from './db';
import { HttpError, logContext } from './respond';

const SCRYPT_KEYLEN = 64;

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, SCRYPT_KEYLEN).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const candidate = scryptSync(password, salt, SCRYPT_KEYLEN);
  return timingSafeEqual(candidate, Buffer.from(hash, 'hex'));
}

function secret(): string {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error('JWT_SECRET is not set');
  return s;
}

export function signToken(userId: string): string {
  return jwt.sign({}, secret(), { subject: userId, expiresIn: '30d' });
}

export interface SessionUser {
  id: string;
  email: string;
  display_name: string;
  couple_id: string | null;
  notifications_enabled: boolean;
}

const USER_COLUMNS = 'id, email, display_name, couple_id, notifications_enabled';

/** Verifies the Bearer token and loads the user fresh (couple_id must never be stale). */
export async function requireUser(req: VercelRequest): Promise<SessionUser> {
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) throw new HttpError(401, 'Not signed in');
  let userId: string;
  let issuedAt: number | undefined; // JWT `iat`, seconds since epoch
  try {
    const payload = jwt.verify(token, secret());
    userId = typeof payload === 'string' ? '' : (payload.sub ?? '');
    issuedAt = typeof payload === 'string' ? undefined : payload.iat;
  } catch {
    throw new HttpError(401, 'Session expired — please sign in again');
  }

  // Load `password_changed_at` alongside the row so a password change can revoke
  // still-valid 30-day tokens (stateless JWTs have no other kill switch). Guarded
  // for a pre-v22 deploy where the column does not exist yet.
  let user: (SessionUser & { password_changed_at?: string | null }) | undefined;
  try {
    user = await one<SessionUser & { password_changed_at: string | null }>(
      `SELECT ${USER_COLUMNS}, password_changed_at FROM users WHERE id = $1`,
      [userId]
    );
  } catch {
    user = await one<SessionUser>(`SELECT ${USER_COLUMNS} FROM users WHERE id = $1`, [userId]);
  }
  if (!user) throw new HttpError(401, 'Account no longer exists');

  // A NULL stamp never revokes (every pre-change session survives). Compare in
  // whole seconds: `iat` has second granularity, so a token minted in the same
  // request right after the change (its iat >= the change second) is NOT killed,
  // while an older token (iat < the change second) is.
  const changedAt = user.password_changed_at;
  if (changedAt && issuedAt !== undefined) {
    const changedSecond = Math.floor(new Date(changedAt).getTime() / 1000);
    if (changedSecond > issuedAt) {
      throw new HttpError(401, 'Your password changed. Please sign in again.');
    }
  }

  // Internal-only; never let it ride along into a response that echoes the user.
  delete user.password_changed_at;

  // Every subsequent log line for this request carries who it was for.
  logContext(req, { user_id: user.id, couple_id: user.couple_id ?? undefined });
  return user;
}

/**
 * Pairing is optional: everyone gets a space. Accounts created before spaces
 * were automatic get one lazily here, so no request ever fails for lack of one.
 */
export async function requirePairedUser(req: VercelRequest): Promise<SessionUser & { couple_id: string }> {
  const user = await requireUser(req);
  if (!user.couple_id) {
    const { createCoupleForUser } = await import('./invite');
    const couple = await createCoupleForUser(user.id);
    user.couple_id = couple.id;
  }
  return user as SessionUser & { couple_id: string };
}

export { USER_COLUMNS };
