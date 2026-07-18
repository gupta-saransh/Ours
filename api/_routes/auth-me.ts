import { one } from '../_lib/db';
import { requireUser } from '../_lib/auth';
import { encryptionEnabled, keyFingerprint } from '../_lib/envelope';
import { route } from '../_lib/respond';

export default route(['GET'], async (req, res) => {
  const user = await requireUser(req);
  let couple = null;
  let partner:
    | { id: string; display_name: string; realName?: string; nickname?: string | null; avatar?: string | null }
    | null = null;
  let encryptionCode: string | null = null;
  let avatar: string | null = null;
  // Guarded like the avatar/nickname reads below: pre-v17 this column does not
  // exist, and "already onboarded" is the safe answer (never trap an existing
  // account in the first-run flow).
  const onboardingRow = await one<{ needs_onboarding: boolean }>(
    'SELECT needs_onboarding FROM users WHERE id = $1',
    [user.id]
  ).catch(() => null);
  if (user.couple_id) {
    // The avatar + nickname selects are catch-guarded: a deploy that lands
    // before the v9/v11 migration must degrade gracefully, never fail /me (a
    // failed /me clears the session client-side and would sign both partners
    // out).
    let partnerAvatar: { avatar: string | null } | null | undefined = null;
    let myAvatar: { avatar: string | null } | null | undefined = null;
    let myNick: { partner_nickname: string | null } | null | undefined = null;
    [couple, partner, encryptionCode, myAvatar, myNick] = await Promise.all([
      one('SELECT id, invite_code, created_at, theme_preset FROM couples WHERE id = $1', [user.couple_id]),
      one('SELECT id, display_name FROM users WHERE couple_id = $1 AND id != $2', [user.couple_id, user.id]),
      keyFingerprint(user.couple_id),
      one<{ avatar: string | null }>('SELECT avatar FROM users WHERE id = $1', [user.id]).catch(() => null),
      one<{ partner_nickname: string | null }>('SELECT partner_nickname FROM users WHERE id = $1', [
        user.id,
      ]).catch(() => null),
    ]);
    avatar = myAvatar?.avatar ?? null;
    if (partner) {
      partnerAvatar = await one<{ avatar: string | null }>('SELECT avatar FROM users WHERE id = $1', [
        partner.id,
      ]).catch(() => null);
      // The nickname I gave my partner (on my own row) becomes the name I see
      // for them everywhere; the real name rides along for Settings + the
      // notification-text swap.
      const realName = partner.display_name;
      const nickname = myNick?.partner_nickname ?? null;
      partner = {
        id: partner.id,
        display_name: nickname || realName,
        realName,
        nickname,
        avatar: partnerAvatar?.avatar ?? null,
      };
    }
  }
  res.status(200).json({
    user: { ...user, avatar },
    couple,
    partner: partner ?? null,
    encryption: encryptionEnabled(),
    encryptionCode,
    needsOnboarding: onboardingRow?.needs_onboarding ?? false,
  });
});
