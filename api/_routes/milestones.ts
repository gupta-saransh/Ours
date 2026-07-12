import { one, q } from '../_lib/db';
import { requirePairedUser } from '../_lib/auth';
import { route, requireString, HttpError } from '../_lib/respond';

const KINDS = ['anniversary', 'birthday', 'custom'] as const;

export default route(['GET', 'POST'], async (req, res) => {
  const user = await requirePairedUser(req);

  if (req.method === 'GET') {
    const milestones = await q(
      `SELECT id, author_id, title, date, kind, created_at FROM milestones
       WHERE couple_id = $1 ORDER BY date ASC LIMIT 200`,
      [user.couple_id]
    );
    res.status(200).json({ milestones });
    return;
  }

  const title = requireString(req.body?.title, 'Title', 120);
  const date = requireString(req.body?.date, 'Date', 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) {
    throw new HttpError(400, 'Date must be YYYY-MM-DD');
  }
  const kind = KINDS.includes(req.body?.kind) ? req.body.kind : 'custom';

  const milestone = await one(
    `INSERT INTO milestones (couple_id, author_id, title, date, kind)
     VALUES ($1, $2, $3, $4, $5) RETURNING id, author_id, title, date, kind, created_at`,
    [user.couple_id, user.id, title, date, kind]
  );
  res.status(201).json({ milestone });
});
