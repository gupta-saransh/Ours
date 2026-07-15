import { one } from '../_lib/db';
import { requireUser } from '../_lib/auth';
import { encryptionEnabled, keyFingerprint } from '../_lib/envelope';
import { route } from '../_lib/respond';

export default route(['GET'], async (req, res) => {
  const user = await requireUser(req);
  let couple = null;
  let partner = null;
  let encryptionCode: string | null = null;
  if (user.couple_id) {
    [couple, partner, encryptionCode] = await Promise.all([
      one('SELECT id, invite_code, created_at FROM couples WHERE id = $1', [user.couple_id]),
      one('SELECT id, display_name FROM users WHERE couple_id = $1 AND id != $2', [user.couple_id, user.id]),
      keyFingerprint(user.couple_id),
    ]);
  }
  res.status(200).json({
    user,
    couple,
    partner: partner ?? null,
    encryption: encryptionEnabled(),
    encryptionCode,
  });
});
