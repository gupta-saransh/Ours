import { one, q } from '../_lib/db';
import { requireAdmin } from '../_lib/admin';
import { route } from '../_lib/respond';

/**
 * GET /api/admin/stats — aggregate counts only. No couple content, no
 * decryption, no per-couple identifying data ever leaves this query set.
 */
export default route(['GET'], async (req, res) => {
  requireAdmin(req);

  const [totals, membership, streaks, active, signupRows] = await Promise.all([
    one<Record<string, number>>(
      `SELECT
         (SELECT count(*)::int FROM couples) AS couples,
         (SELECT count(*)::int FROM users) AS users,
         (SELECT count(*)::int FROM couples WHERE wrapped_dek IS NOT NULL) AS encrypted_couples,
         (SELECT count(*)::int FROM memories) AS memories,
         (SELECT count(*)::int FROM love_notes) AS notes,
         (SELECT count(*)::int FROM milestones) AS milestones,
         (SELECT count(*)::int FROM daily_prompt_answers) AS prompt_answers,
         (SELECT count(*)::int FROM memory_comments) AS comments,
         (SELECT count(*)::int FROM date_proposals) AS dates,
         (SELECT count(*)::int FROM wishlist_items) AS wishlist,
         (SELECT count(*)::int FROM bucket_items) AS bucket_total,
         (SELECT count(*)::int FROM bucket_items WHERE done = true) AS bucket_done`
    ),
    one<{ paired: number; solo: number }>(
      `SELECT
         count(*) FILTER (WHERE n = 2)::int AS paired,
         count(*) FILTER (WHERE n = 1)::int AS solo
       FROM (SELECT couple_id, count(*) AS n FROM users WHERE couple_id IS NOT NULL GROUP BY couple_id) t`
    ),
    one<{ on_streak: number; longest_ever: number; avg_current: number }>(
      `SELECT
         count(*) FILTER (WHERE current_streak_days > 0)::int AS on_streak,
         COALESCE(max(longest_streak_days), 0)::int AS longest_ever,
         COALESCE(round(avg(current_streak_days) FILTER (WHERE current_streak_days > 0)), 0)::int AS avg_current
       FROM couples`
    ),
    one<{ n: number }>(
      `SELECT count(DISTINCT couple_id)::int AS n FROM (
         SELECT couple_id, created_at FROM memories
         UNION ALL SELECT couple_id, created_at FROM love_notes
         UNION ALL SELECT couple_id, created_at FROM daily_prompt_answers
         UNION ALL SELECT couple_id, created_at FROM memory_comments
         UNION ALL SELECT couple_id, created_at FROM bucket_items
         UNION ALL SELECT couple_id, created_at FROM date_proposals
       ) t WHERE created_at > now() - INTERVAL '7 days'`
    ),
    q<{ day: string; n: number }>(
      `SELECT created_at::DATE::STRING AS day, count(*)::int AS n
       FROM users WHERE created_at > now() - INTERVAL '30 days'
       GROUP BY day ORDER BY day ASC`
    ),
  ]);

  // Fill every day in the window so the chart has no gaps, even at zero.
  const byDay = new Map(signupRows.map((r) => [r.day, r.n]));
  const signups: { day: string; n: number }[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - i);
    const day = d.toISOString().slice(0, 10);
    signups.push({ day, n: byDay.get(day) ?? 0 });
  }

  res.status(200).json({
    totals,
    membership: membership ?? { paired: 0, solo: 0 },
    streaks: streaks ?? { on_streak: 0, longest_ever: 0, avg_current: 0 },
    activeCouples: active?.n ?? 0,
    signups,
  });
});
