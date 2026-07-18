import { one } from '../_lib/db';
import { requirePairedUser, USER_COLUMNS, type SessionUser } from '../_lib/auth';
import { registerPushToken } from '../_lib/push';
import { route, requireString, HttpError } from '../_lib/respond';

// Must match the preset ids defined in src/theme.ts.
const THEME_PRESET_IDS = ['parchment', 'dusk', 'meadow', 'tide', 'petal'];

// Must match AVATAR_IDS in src/components/Avatar.tsx.
const AVATAR_IDS = [
  'heart', 'flower', 'sun', 'moon', 'star', 'music',
  'coffee', 'cat', 'dog', 'bird', 'leaf', 'book',
  'rabbit', 'sparkles', 'clover', 'diamond', 'feather', 'glasses', 'cookie', 'palette',
];

/** PATCH /api/auth/profile — display name, notifications toggle, push token, theme, avatar. */
export default route(['PATCH'], async (req, res) => {
  const user = await requirePairedUser(req);
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
  if (body.themePreset !== undefined) {
    if (typeof body.themePreset !== 'string' || !THEME_PRESET_IDS.includes(body.themePreset)) {
      throw new HttpError(400, 'Unknown theme preset');
    }
    // The look is shared: one preset per couple, either partner may set it.
    await one(`UPDATE couples SET theme_preset = $2 WHERE id = $1`, [user.couple_id, body.themePreset]);
  }
  if (body.avatar !== undefined) {
    if (body.avatar !== null && (typeof body.avatar !== 'string' || !AVATAR_IDS.includes(body.avatar))) {
      throw new HttpError(400, 'Unknown avatar');
    }
    await one(`UPDATE users SET avatar = $2 WHERE id = $1`, [user.id, body.avatar]);
  }
  if (body.partnerNickname !== undefined) {
    // The pet name I use for my partner. Null or blank clears it (fall back to
    // their real name). Stored on my own row.
    let nickname: string | null = null;
    if (body.partnerNickname !== null) {
      if (typeof body.partnerNickname !== 'string') throw new HttpError(400, 'Nickname must be text');
      const trimmed = body.partnerNickname.trim();
      if (trimmed.length > 40) throw new HttpError(400, 'Nickname is too long');
      nickname = trimmed.length ? trimmed : null;
    }
    await one(`UPDATE users SET partner_nickname = $2 WHERE id = $1`, [user.id, nickname]);
  }
  if (body.onboarded !== undefined) {
    // The first-run flow finished (or was skipped to the end). One-way: nothing
    // ever sets this back to true except a fresh signup. Guarded so a
    // pre-v17 deploy cannot fail the whole profile save.
    await one(`UPDATE users SET needs_onboarding = false WHERE id = $1`, [user.id]).catch(() => null);
  }

  const updated = await one<SessionUser>(`SELECT ${USER_COLUMNS} FROM users WHERE id = $1`, [user.id]);
  // avatar is deliberately outside USER_COLUMNS (auth must not depend on the v9
  // migration); the catch keeps this route working pre-migration too.
  const avatarRow = await one<{ avatar: string | null }>(`SELECT avatar FROM users WHERE id = $1`, [user.id]).catch(
    () => null
  );
  res.status(200).json({ user: { ...updated, avatar: avatarRow?.avatar ?? null } });
});
