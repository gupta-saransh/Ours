import { one, q } from '../_lib/db';
import { requirePairedUser } from '../_lib/auth';
import { route } from '../_lib/respond';

const RESURFACE_COLUMNS = `id, thumb_data, note,
  COALESCE(memory_date, created_at::DATE)::STRING AS memory_date`;

/**
 * One request powers the whole home screen: days-together basis, partner,
 * upcoming milestones, a resurfaced memory (a year ago today, then a month
 * ago today, then a random older one), the bucket list, the latest pinned
 * note, and the unseen-notification count. Everything runs in parallel.
 */
export default route(['GET'], async (req, res) => {
  const user = await requirePairedUser(req);
  const cid = user.couple_id;

  const [couple, partner, anniversary, milestones, yearAgo, monthAgo, older, bucket, pinnedNote, seen] =
    await Promise.all([
      one('SELECT id, invite_code, created_at FROM couples WHERE id = $1', [cid]),
      one('SELECT id, display_name FROM users WHERE couple_id = $1 AND id != $2', [cid, user.id]),
      one<{ date: string }>(
        `SELECT date::STRING AS date FROM milestones WHERE couple_id = $1 AND kind = 'anniversary' ORDER BY date ASC LIMIT 1`,
        [cid]
      ),
      q(`SELECT id, title, date::STRING AS date, kind FROM milestones WHERE couple_id = $1 ORDER BY date ASC LIMIT 30`, [cid]),
      one(
        `SELECT ${RESURFACE_COLUMNS} FROM memories
         WHERE couple_id = $1 AND COALESCE(memory_date, created_at::DATE) = (now() - INTERVAL '1 year')::DATE LIMIT 1`,
        [cid]
      ),
      one(
        `SELECT ${RESURFACE_COLUMNS} FROM memories
         WHERE couple_id = $1 AND COALESCE(memory_date, created_at::DATE) = (now() - INTERVAL '1 month')::DATE LIMIT 1`,
        [cid]
      ),
      one(
        `SELECT ${RESURFACE_COLUMNS} FROM memories
         WHERE couple_id = $1 AND created_at < now() - INTERVAL '14 days' ORDER BY random() LIMIT 1`,
        [cid]
      ),
      q(
        `SELECT id, author_id, title, done, created_at FROM bucket_items
         WHERE couple_id = $1 AND done = false ORDER BY created_at DESC LIMIT 5`,
        [cid]
      ),
      one(
        `SELECT n.id, n.body, n.created_at, u.display_name AS author_name
         FROM love_notes n JOIN users u ON u.id = n.author_id
         WHERE n.couple_id = $1 AND n.pinned = true ORDER BY n.created_at DESC LIMIT 1`,
        [cid]
      ),
      one<{ notifications_seen_at: string }>('SELECT notifications_seen_at FROM users WHERE id = $1', [user.id]),
    ]);

  const unseenRow = await one<{ n: number }>(
    `SELECT count(*)::int AS n FROM notifications
     WHERE couple_id = $1 AND actor_id != $2 AND created_at > $3`,
    [cid, user.id, seen?.notifications_seen_at ?? new Date(0).toISOString()]
  );

  const resurfaced = yearAgo
    ? { ...yearAgo, tag: 'One year ago today' }
    : monthAgo
      ? { ...monthAgo, tag: 'One month ago today' }
      : older
        ? { ...older, tag: 'From your story' }
        : null;

  res.status(200).json({
    couple,
    partner: partner ?? null,
    daysBasis: anniversary?.date ?? null,
    milestones,
    resurfaced,
    bucket,
    pinnedNote: pinnedNote ?? null,
    unseen: unseenRow?.n ?? 0,
  });
});
