import { one } from '../_lib/db';
import { hashPassword, signToken, USER_COLUMNS, type SessionUser } from '../_lib/auth';
import { createCoupleForUser } from '../_lib/invite';
import { route, requireString, HttpError } from '../_lib/respond';

export default route(['POST'], async (req, res) => {
  const email = requireString(req.body?.email, 'Email', 320).toLowerCase();
  const password = requireString(req.body?.password, 'Password', 200);
  const displayName = requireString(req.body?.displayName, 'Name', 80);

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'That email does not look right');
  if (password.length < 8) throw new HttpError(400, 'Password needs at least 8 characters');

  const existing = await one('SELECT id FROM users WHERE email = $1', [email]);
  if (existing) throw new HttpError(409, 'An account with that email already exists');

  const user = await one<SessionUser>(
    `INSERT INTO users (email, password_hash, display_name) VALUES ($1, $2, $3) RETURNING ${USER_COLUMNS}`,
    [email, hashPassword(password), displayName]
  );

  // Friend referral: /sign-up?ref=CODE passes the code through. Best-effort and
  // catch-guarded (pre-v16 schema, bogus code) so it can never block a signup.
  const ref = typeof req.body?.ref === 'string' ? req.body.ref.trim().toUpperCase() : '';
  if (ref && /^[A-Z2-9]{4,12}$/.test(ref)) {
    await one(
      `UPDATE users SET referred_by = (SELECT id FROM users WHERE referral_code = $2 LIMIT 1)
       WHERE id = $1 AND EXISTS (SELECT 1 FROM users WHERE referral_code = $2)`,
      [user!.id, ref]
    ).catch(() => {});
  }

  // Everyone gets a space of their own right away; pairing is optional.
  const couple = await createCoupleForUser(user!.id);
  user!.couple_id = couple.id;
  res.status(201).json({ token: signToken(user!.id), user });
});
