import { one } from '../_lib/db';
import { hashPassword, signToken, USER_COLUMNS, type SessionUser } from '../_lib/auth';
import { route, requireString, HttpError } from '../_lib/respond';

export default route(['POST'], async (req, res) => {
  const email = requireString(req.body?.email, 'Email', 320).toLowerCase();
  const password = requireString(req.body?.password, 'Password', 200);
  const displayName = requireString(req.body?.displayName, 'Name', 80);

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'That email doesn’t look right');
  if (password.length < 8) throw new HttpError(400, 'Password needs at least 8 characters');

  const existing = await one('SELECT id FROM users WHERE email = $1', [email]);
  if (existing) throw new HttpError(409, 'An account with that email already exists');

  const user = await one<SessionUser>(
    `INSERT INTO users (email, password_hash, display_name) VALUES ($1, $2, $3) RETURNING ${USER_COLUMNS}`,
    [email, hashPassword(password), displayName]
  );
  res.status(201).json({ token: signToken(user!.id), user });
});
