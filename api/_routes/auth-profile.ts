import { one } from '../_lib/db';
import { requireUser, USER_COLUMNS, type SessionUser } from '../_lib/auth';
import { registerPushToken } from '../_lib/push';
import { route, requireString, HttpError } from '../_lib/respond';

/** PATCH /api/auth/profile — display name, notifications toggle, push token. */
export default route(['PATCH'], async (req, res) => {
  const user = await requireUser(req);
  const body = req.body ?? {};

  if (body.displayName !== undefined) {
    const name = requireString(body.displayName, 'Name', 80);
    await one(`UPDATE users SET display_name = $2 WHERE id = $1`, [user.id, name]);
  }
  if (body.notificationsEnabled !== undefined) {
    if (typeof body.notificationsEnabled !== 'boolean') throw new HttpError(400, 'notificationsEnabled must be a boolean');
    await one(`UPDATE users SET notifications_enabled = $2 WHERE id = $1`, [user.id, body.notificationsEnabled]);
  }
  if (body.pushToken !== undefined) {
    await registerPushToken(user.id, typeof body.pushToken === 'string' ? body.pushToken : null);
  }

  const updated = await one<SessionUser>(`SELECT ${USER_COLUMNS} FROM users WHERE id = $1`, [user.id]);
  res.status(200).json({ user: updated });
});
