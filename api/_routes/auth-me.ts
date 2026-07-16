import { one } from '../_lib/db';
import { requireUser } from '../_lib/auth';
import { encryptionEnabled, keyFingerprint } from '../_lib/envelope';
import { route } from '../_lib/respond';

export default route(['GET'], async (req, res) => {
  const user = await requireUser(req);
  let couple = null;
  let partner: { id: string; display_name: string; avatar?: string | null } | null = null;
  let encryptionCode: string | null = null;
  let avatar: string | null = null;
  if (user.couple_id) {
    // The avatar selects are catch-guarded: a deploy that lands before the v9
    // migration must degrade to "no avatar", never fail /me (a failed /me
    // clears the session client-side and would sign both partners out).
    let partnerAvatar: { avatar: string | null } | null | undefined = null;
    let myAvatar: { avatar: string | null } | null | undefined = null;
    [couple, partner, encryptionCode, myAvatar] = await Promise.all([
      one('SELECT id, invite_code, created_at, theme_preset FROM couples WHERE id = $1', [user.couple_id]),
      one('SELECT id, display_name FROM users WHERE couple_id = $1 AND id != $2', [user.couple_id, user.id]),
      keyFingerprint(user.couple_id),
      one<{ avatar: string | null }>('SELECT avatar FROM users WHERE id = $1', [user.id]).catch(() => null),
    ]);
    avatar = myAvatar?.avatar ?? null;
    if (partner) {
      partnerAvatar = await one<{ avatar: string | null }>('SELECT avatar FROM users WHERE id = $1', [
        partner.id,
      ]).catch(() => null);
      partner = { ...partner, avatar: partnerAvatar?.avatar ?? null };
    }
  }
  res.status(200).json({
    user: { ...user, avatar },
    couple,
    partner: partner ?? null,
    encryption: encryptionEnabled(),
    encryptionCode,
  });
});
