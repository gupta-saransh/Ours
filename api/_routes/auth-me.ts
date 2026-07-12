import { one } from '../_lib/db';
import { requireUser } from '../_lib/auth';
import { route } from '../_lib/respond';

export default route(['GET'], async (req, res) => {
  const user = await requireUser(req);
  let couple = null;
  let partner = null;
  if (user.couple_id) {
    couple = await one('SELECT id, invite_code, created_at FROM couples WHERE id = $1', [user.couple_id]);
    partner = await one(
      'SELECT id, display_name FROM users WHERE couple_id = $1 AND id != $2',
      [user.couple_id, user.id]
    );
  }
  res.status(200).json({ user, couple, partner: partner ?? null });
});
