import { randomInt } from 'node:crypto';
import { one } from './db';

// No 0/O/1/I; codes get read aloud between partners.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function makeCode(): string {
  let code = '';
  for (let i = 0; i < 6; i++) code += ALPHABET[randomInt(ALPHABET.length)];
  return code;
}

/**
 * Every account gets its own space at signup, so the whole app works solo and
 * pairing is optional. Retries on the (rare) invite-code collision.
 */
export async function createCoupleForUser(userId: string): Promise<{ id: string; invite_code: string }> {
  let couple;
  for (let attempt = 0; attempt < 5 && !couple; attempt++) {
    try {
      couple = await one<{ id: string; invite_code: string }>(
        'INSERT INTO couples (invite_code) VALUES ($1) RETURNING id, invite_code',
        [makeCode()]
      );
    } catch {
      // collision, try a fresh code
    }
  }
  if (!couple) throw new Error('Could not allocate an invite code');
  await one('UPDATE users SET couple_id = $2 WHERE id = $1', [userId, couple.id]);
  return couple;
}
