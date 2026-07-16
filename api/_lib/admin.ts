import 'dotenv/config';
import { timingSafeEqual } from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { VercelRequest } from '@vercel/node';
import { HttpError } from './respond';

/**
 * A single shared password gates /admin/dashboard (analytics only, no couple
 * data). Deliberately separate from the user auth in ./auth.ts: the admin JWT
 * carries { admin: true } and no `sub`, so it can never be mistaken for, or
 * substituted by, a couple member's session token.
 */

function secret(): string {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error('JWT_SECRET is not set');
  return s;
}

export function adminConfigured(): boolean {
  return !!process.env.ADMIN_PASSWORD;
}

// Fixed-size, zero-padded comparison so neither the early-exit nor the byte
// comparison leaks how many characters of a guess were correct.
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.alloc(256);
  const bufB = Buffer.alloc(256);
  bufA.write(a);
  bufB.write(b);
  return a.length === b.length && timingSafeEqual(bufA, bufB);
}

export function verifyAdminPassword(password: string): boolean {
  const expected = process.env.ADMIN_PASSWORD;
  return !!expected && safeEqual(password, expected);
}

export function signAdminToken(): string {
  return jwt.sign({ admin: true }, secret(), { expiresIn: '12h' });
}

/** Throws unless the request carries a valid, unexpired admin token. */
export function requireAdmin(req: VercelRequest): void {
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) throw new HttpError(401, 'Not signed in');
  try {
    const payload = jwt.verify(token, secret());
    if (typeof payload === 'string' || payload.admin !== true) throw new Error('not admin');
  } catch {
    throw new HttpError(401, 'Session expired — please sign in again');
  }
}
