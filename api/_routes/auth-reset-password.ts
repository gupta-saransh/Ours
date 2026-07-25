import { one } from '../_lib/db';
import { hashPassword, signToken, USER_COLUMNS, type SessionUser } from '../_lib/auth';
import { resetCodeStatus, type StoredResetCode } from '../_lib/password-reset';
import { route, requireString, HttpError } from '../_lib/respond';

/** The keyed-hash secret. Reuses JWT_SECRET so no new env var is needed. */
function pepper(): string {
  return process.env.JWT_SECRET || 'ours-reset-pepper';
}

/**
 * Finish a password reset: verify the emailed code, set the new password, and
 * sign them in. Every way a code can be invalid (missing / used / expired /
 * wrong) collapses into ONE generic message, so nothing here reveals whether
 * the email exists or which specific check failed.
 */
export default route(['POST'], async (req, res) => {
  const email = requireString(req.body?.email, 'Email', 320).toLowerCase();
  const code = requireString(req.body?.code, 'Code', 12).replace(/\s/g, '');
  const newPassword = requireString(req.body?.newPassword, 'New password', 200);

  const invalid = new HttpError(400, 'That code is not valid or has expired. Ask for a new one.');
  if (!/^\d{6}$/.test(code)) throw invalid;
  if (newPassword.length < 8) throw new HttpError(400, 'Password needs at least 8 characters');

  const user = await one<SessionUser>(`SELECT ${USER_COLUMNS} FROM users WHERE email = $1`, [email]);
  if (!user) throw invalid;

  const row = await one<StoredResetCode & { id: string }>(
    `SELECT id, code_hash, expires_at, used_at FROM password_reset_codes
     WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [user.id]
  );

  if (resetCodeStatus(row, code, pepper(), Date.now()) !== 'ok') throw invalid;

  // Spend the code so it works exactly once, then set the password and stamp
  // password_changed_at (which revokes any other outstanding token).
  await one('UPDATE password_reset_codes SET used_at = now() WHERE id = $1 RETURNING id', [row!.id]);
  await one('UPDATE users SET password_hash = $2, password_changed_at = now() WHERE id = $1 RETURNING id', [
    user.id,
    hashPassword(newPassword),
  ]);

  // Land them signed in on the device they reset from.
  res.status(200).json({ token: signToken(user.id), user });
});
