import { one, q } from '../_lib/db';
import { requirePairedUser } from '../_lib/auth';
import { notify } from '../_lib/notify';
import { route, requireString, HttpError } from '../_lib/respond';

const KINDS = ['anniversary', 'birthday', 'custom'] as const;

/**
 * `person_id` (v17) says WHOSE a milestone is, which only birthdays need. It is
 * nullable: shared milestones (anniversaries) and every pre-v17 row leave it
 * null, and readers fall back to author_id, then the title text.
 *
 * `notify_days_before` / `last_reminded_date` (v20) drive the countdown banner
 * + daily reminder, see api/_lib/milestone-countdown.ts. Every query here falls
 * back through THREE column lists (v20 -> v17 -> legacy) so a deploy that lands
 * before either migration keeps working instead of 500ing.
 */
const COLUMNS_V20 =
  'id, author_id, person_id, title, date, kind, notify_days_before, last_reminded_date::STRING AS last_reminded_date, created_at';
const COLUMNS_V17 = 'id, author_id, person_id, title, date, kind, created_at';
const COLUMNS_LEGACY = 'id, author_id, title, date, kind, created_at';

const DEFAULT_NOTIFY_DAYS_BEFORE = 7;

function readNotifyDaysBefore(raw: unknown): number {
  if (raw === undefined || raw === null) return DEFAULT_NOTIFY_DAYS_BEFORE;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > 60) throw new HttpError(400, 'Countdown days must be 0-60');
  return n;
}

export default route(['GET', 'POST'], async (req, res) => {
  const user = await requirePairedUser(req);

  if (req.method === 'GET') {
    const list = (columns: string) =>
      q(
        `SELECT ${columns} FROM milestones
         WHERE couple_id = $1 ORDER BY date ASC LIMIT 200`,
        [user.couple_id]
      );
    const milestones = await list(COLUMNS_V20).catch(() => list(COLUMNS_V17).catch(() => list(COLUMNS_LEGACY)));
    res.status(200).json({ milestones });
    return;
  }

  const title = requireString(req.body?.title, 'Title', 120);
  const date = requireString(req.body?.date, 'Date', 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) {
    throw new HttpError(400, 'Date must be YYYY-MM-DD');
  }
  const kind = KINDS.includes(req.body?.kind) ? req.body.kind : 'custom';
  const notifyDaysBefore = readNotifyDaysBefore(req.body?.notifyDaysBefore);

  // Whose birthday this is. Only ever one of the two people in this space:
  // anything else is rejected rather than silently ignored.
  let personId: string | null = null;
  if (req.body?.personId != null) {
    if (typeof req.body.personId !== 'string') throw new HttpError(400, 'personId must be an id');
    const member = await one('SELECT id FROM users WHERE id = $1 AND couple_id = $2', [
      req.body.personId,
      user.couple_id,
    ]);
    if (!member) throw new HttpError(404, 'That person is not in your space');
    personId = req.body.personId;
  }

  const milestone = await one(
    `INSERT INTO milestones (couple_id, author_id, title, date, kind, person_id, notify_days_before)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING ${COLUMNS_V20}`,
    [user.couple_id, user.id, title, date, kind, personId, notifyDaysBefore]
  ).catch(() =>
    one(
      `INSERT INTO milestones (couple_id, author_id, title, date, kind, person_id)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${COLUMNS_V17}`,
      [user.couple_id, user.id, title, date, kind, personId]
    ).catch(() =>
      one(
        `INSERT INTO milestones (couple_id, author_id, title, date, kind)
         VALUES ($1, $2, $3, $4, $5) RETURNING ${COLUMNS_LEGACY}`,
        [user.couple_id, user.id, title, date, kind]
      )
    )
  );
  await notify(user.couple_id, user.id, 'milestone', `${user.display_name} added a milestone: ${title}`);
  res.status(201).json({ milestone });
});
