import 'dotenv/config';
import jwt from 'jsonwebtoken';
import type { VercelRequest } from '@vercel/node';
import { HttpError } from './respond';

/**
 * The secret-chat unlock grant.
 *
 * WHY THIS EXISTS AT ALL, rather than the client just remembering "they typed
 * the code": if unlocking were only a boolean in the app's own state, then the
 * 4-digit code would protect nothing at the API layer, and anyone holding an
 * unlocked phone (or a copy of the session token) could read the secret thread
 * straight from the endpoint. The code has to buy a real, separate,
 * short-lived credential or it is decoration.
 *
 * Shape mirrors admin.ts deliberately: a distinct claim (`secret: true`) so it
 * can never be confused with, or substituted by, an ordinary session token, and
 * vice versa. It is ALSO bound to a user id, so one partner's unlock cannot be
 * replayed by the other.
 *
 * Short life is the auto-relock: 15 minutes, held in memory only on the client,
 * never localStorage, never a cookie. Walking away from the phone re-locks the
 * thread without anyone having to remember to press anything.
 */

const TTL_SECONDS = 15 * 60;

function secret(): string {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error('JWT_SECRET is not set');
  return s;
}

export function signSecretToken(userId: string): { token: string; expiresIn: number } {
  return {
    token: jwt.sign({ secret: true }, secret(), { subject: userId, expiresIn: TTL_SECONDS }),
    expiresIn: TTL_SECONDS,
  };
}

/**
 * Throws unless the request carries an unexpired unlock token belonging to THIS
 * user. Call it after requireUser/requirePairedUser: the session proves who you
 * are, this proves you just entered the code.
 */
export function requireSecretSession(req: VercelRequest, userId: string): void {
  const raw = req.headers['x-secret-token'];
  const token = Array.isArray(raw) ? raw[0] : raw;
  if (!token) throw new HttpError(401, 'Locked');
  try {
    const payload = jwt.verify(token, secret());
    if (typeof payload === 'string') throw new Error('bad payload');
    if (payload.secret !== true) throw new Error('not a secret grant');
    if (payload.sub !== userId) throw new Error('grant belongs to someone else');
  } catch {
    // One flat message: a caller learns only "locked", never whether the token
    // was expired, malformed, or somebody else's.
    throw new HttpError(401, 'Locked');
  }
}
