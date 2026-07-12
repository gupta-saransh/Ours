import { randomInt } from 'node:crypto';
import { one } from '../_lib/db';
import { requireUser } from '../_lib/auth';
import { route, HttpError } from '../_lib/respond';

// No 0/O/1/I — codes get read aloud between partners.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function makeCode(): string {
  let code = '';
  for (let i = 0; i < 6; i++) code += ALPHABET[randomInt(ALPHABET.length)];
  return code;
}

export default route(['POST'], async (req, res) => {
  const user = await requireUser(req);
  if (user.couple_id) throw new HttpError(409, 'You’re already in a shared space');

  let couple;
  for (let attempt = 0; attempt < 5 && !couple; attempt++) {
    try {
      couple = await one(
        'INSERT INTO couples (invite_code) VALUES ($1) RETURNING id, invite_code',
        [makeCode()]
      );
    } catch {
      // invite_code collision — retry with a fresh code
    }
  }
  if (!couple) throw new HttpError(500, 'Could not create a space, please try again');

  await one('UPDATE users SET couple_id = $2 WHERE id = $1', [user.id, couple.id]);
  res.status(201).json({ couple });
});
