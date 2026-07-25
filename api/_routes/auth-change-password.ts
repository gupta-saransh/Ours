import { one } from '../_lib/db';
import { hashPassword, requireUser, signToken, verifyPassword } from '../_lib/auth';
import { route, requireString, HttpError } from '../_lib/respond';

/**
 * Change your password while signed in. Verifies the current password against
 * the stored scrypt hash before allowing the change, stamps password_changed_at
 * (which revokes every other still-valid token, see requireUser), and hands back
 * a FRESH token so this very device is not logged out by that revocation.
 */
export default route(['POST'], async (req, res) => {
  const user = await requireUser(req);
  const currentPassword = requireString(req.body?.currentPassword, 'Current password', 200);
  const newPassword = requireString(req.body?.newPassword, 'New password', 200);
  // The same minimum signup enforces. No new rule invented.
  if (newPassword.length < 8) throw new HttpError(400, 'Password needs at least 8 characters');

  const row = await one<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = $1', [user.id]);
  if (!row || !verifyPassword(currentPassword, row.password_hash)) {
    throw new HttpError(400, 'That current password is not right');
  }
  if (verifyPassword(newPassword, row.password_hash)) {
    throw new HttpError(400, 'Choose a password different from your current one');
  }

  await one('UPDATE users SET password_hash = $2, password_changed_at = now() WHERE id = $1 RETURNING id', [
    user.id,
    hashPassword(newPassword),
  ]);

  res.status(200).json({ token: signToken(user.id), user });
});
