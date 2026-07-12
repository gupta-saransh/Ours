import { one, q } from '../_lib/db';
import { requirePairedUser } from '../_lib/auth';
import { route } from '../_lib/respond';

/**
 * GET  /api/notifications  your partner's activity (nudges, memories, notes,
 *                          milestones, bucket items), newest first, plus how
 *                          many arrived since you last looked
 * POST /api/notifications  mark everything as seen
 */
export default route(['GET', 'POST'], async (req, res) => {
  const user = await requirePairedUser(req);

  if (req.method === 'POST') {
    await one('UPDATE users SET notifications_seen_at = now() WHERE id = $1', [user.id]);
    res.status(200).json({ ok: true });
    return;
  }

  const [notifications, seen] = await Promise.all([
    q(
      `SELECT id, actor_id, kind, text, created_at FROM notifications
       WHERE couple_id = $1 AND actor_id != $2
       ORDER BY created_at DESC LIMIT 60`,
      [user.couple_id, user.id]
    ),
    one<{ notifications_seen_at: string }>('SELECT notifications_seen_at FROM users WHERE id = $1', [user.id]),
  ]);
  const seenAt = seen?.notifications_seen_at ?? new Date(0).toISOString();
  const unseen = notifications.filter((n: any) => new Date(n.created_at) > new Date(seenAt)).length;
  res.status(200).json({ notifications, seenAt, unseen });
});
