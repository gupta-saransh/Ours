import { one } from '../_lib/db';
import { verifyPassword, signToken, USER_COLUMNS } from '../_lib/auth';
import { route, requireString, HttpError } from '../_lib/respond';

export default route(['POST'], async (req, res) => {
  const email = requireString(req.body?.email, 'Email', 320).toLowerCase();
  const password = requireString(req.body?.password, 'Password', 200);

  const row = await one<{ password_hash: string } & Record<string, unknown>>(
    `SELECT ${USER_COLUMNS}, password_hash FROM users WHERE email = $1`,
    [email]
  );
  if (!row || !verifyPassword(password, row.password_hash)) {
    throw new HttpError(401, 'Email or password is incorrect');
  }
  const { password_hash: _ph, ...user } = row;
  res.status(200).json({ token: signToken(user.id as string), user });
});
