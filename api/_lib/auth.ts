import 'dotenv/config';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { VercelRequest } from '@vercel/node';
import { one } from './db';
import { HttpError } from './respond';

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
  try {
    const payload = jwt.verify(token, secret());
    userId = typeof payload === 'string' ? '' : (payload.sub ?? '');
  } catch {
    throw new HttpError(401, 'Session expired — please sign in again');
  }
  const user = await one<SessionUser>(`SELECT ${USER_COLUMNS} FROM users WHERE id = $1`, [userId]);
  if (!user) throw new HttpError(401, 'Account no longer exists');
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
