import { one } from '../_lib/db';
import { requirePairedUser } from '../_lib/auth';
import { route, HttpError } from '../_lib/respond';

const COLUMNS =
  'id, author_id, person_id, title, date, kind, notify_days_before, last_reminded_date::STRING AS last_reminded_date, created_at';

export default route(['PATCH', 'DELETE'], async (req, res) => {
  const user = await requirePairedUser(req);
  const id = String(req.query.id ?? '');

  if (req.method === 'DELETE') {
    const deleted = await one('DELETE FROM milestones WHERE id = $1 AND couple_id = $2 RETURNING id', [
      id,
      user.couple_id,
    ]);
    if (!deleted) throw new HttpError(404, 'Milestone not found');
    res.status(200).json({ ok: true });
    return;
  }

  // Only the countdown window is editable here; title/date/kind stay
  // fixed once added (delete + re-add covers changing those).
  if (req.body?.notifyDaysBefore === undefined) throw new HttpError(400, 'Nothing to change');
  const n = Number(req.body.notifyDaysBefore);
  if (!Number.isInteger(n) || n < 0 || n > 60) throw new HttpError(400, 'Countdown days must be 0-60');

  const milestone = await one(
    `UPDATE milestones SET notify_days_before = $3 WHERE id = $1 AND couple_id = $2 RETURNING ${COLUMNS}`,
    [id, user.couple_id, n]
  );
  if (!milestone) throw new HttpError(404, 'Milestone not found');
  res.status(200).json({ milestone });
});
