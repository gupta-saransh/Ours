import { one } from '../_lib/db';
import { requirePairedUser } from '../_lib/auth';
import { route, HttpError } from '../_lib/respond';

export default route(['DELETE'], async (req, res) => {
  const user = await requirePairedUser(req);
  const id = String(req.query.id ?? '');
  const deleted = await one(
    'DELETE FROM milestones WHERE id = $1 AND couple_id = $2 RETURNING id',
    [id, user.couple_id]
  );
  if (!deleted) throw new HttpError(404, 'Milestone not found');
  res.status(200).json({ ok: true });
});
