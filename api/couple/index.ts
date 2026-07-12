import { one, q } from '../_lib/db';
import { requirePairedUser } from '../_lib/auth';
import { route } from '../_lib/respond';

export default route(['GET'], async (req, res) => {
  const user = await requirePairedUser(req);
  const couple = await one('SELECT id, invite_code, created_at FROM couples WHERE id = $1', [user.couple_id]);
  const members = await q(
    'SELECT id, display_name, email FROM users WHERE couple_id = $1 ORDER BY created_at',
    [user.couple_id]
  );
  res.status(200).json({ couple, members });
});
