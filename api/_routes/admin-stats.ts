import { one, q } from '../_lib/db';
import { requireAdmin } from '../_lib/admin';
import { route } from '../_lib/respond';

const ACTIVITY_SRC = ['memories', 'notes', 'prompts', 'comments', 'dates', 'messages'] as const;

/**
 * GET /api/admin/stats — aggregate + per-couple counts only. Never reads couple
 * content and never decrypts: only row COUNTS and timestamps leave the database.
 * Per-couple rows carry a short opaque id (for the owner's own analytics), the
 * member count, and how much of each thing the couple has made, but no names,
 * no text, no photos.
 */
export default route(['GET'], async (req, res) => {
  requireAdmin(req);

  const [totals, membership, streaks, active, signupRows, activityRows, coupleRows] = await Promise.all([
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
         (SELECT count(*)::int FROM messages) AS messages,
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
         UNION ALL SELECT couple_id, created_at FROM messages
       ) t WHERE created_at > now() - INTERVAL '7 days'`
    ),
    q<{ day: string; n: number }>(
      `SELECT created_at::DATE::STRING AS day, count(*)::int AS n
       FROM users WHERE created_at > now() - INTERVAL '30 days'
       GROUP BY day ORDER BY day ASC`
    ),
    // Everything the couples made, per day and per kind, last 30 days.
    q<{ day: string; src: string; n: number }>(
      `SELECT created_at::DATE::STRING AS day, src, count(*)::int AS n FROM (
         SELECT created_at, 'memories' AS src FROM memories
         UNION ALL SELECT created_at, 'notes' AS src FROM love_notes
         UNION ALL SELECT created_at, 'prompts' AS src FROM daily_prompt_answers
         UNION ALL SELECT created_at, 'comments' AS src FROM memory_comments
         UNION ALL SELECT created_at, 'dates' AS src FROM date_proposals
         UNION ALL SELECT created_at, 'messages' AS src FROM messages
       ) t WHERE created_at > now() - INTERVAL '30 days'
       GROUP BY day, src`
    ),
    // Per-couple data volume (counts only), newest couples first.
    q<Record<string, any>>(
      `SELECT
         left(c.id::STRING, 8) AS id,
         c.created_at::STRING AS created_at,
         (SELECT count(*)::int FROM users u WHERE u.couple_id = c.id) AS members,
         (SELECT count(*)::int FROM memories m WHERE m.couple_id = c.id) AS memories,
         (SELECT count(*)::int FROM love_notes n WHERE n.couple_id = c.id) AS notes,
         (SELECT count(*)::int FROM messages g WHERE g.couple_id = c.id) AS messages,
         (SELECT count(*)::int FROM date_proposals d WHERE d.couple_id = c.id) AS dates,
         (SELECT count(*)::int FROM daily_prompt_answers a WHERE a.couple_id = c.id) AS prompts,
         (SELECT count(*)::int FROM memory_comments mc WHERE mc.couple_id = c.id) AS comments,
         (SELECT count(*)::int FROM bucket_items b WHERE b.couple_id = c.id) AS bucket,
         (SELECT count(*)::int FROM wishlist_items w WHERE w.couple_id = c.id) AS wishlist,
         (SELECT max(x.created_at)::STRING FROM (
            SELECT created_at FROM memories WHERE couple_id = c.id
            UNION ALL SELECT created_at FROM love_notes WHERE couple_id = c.id
            UNION ALL SELECT created_at FROM messages WHERE couple_id = c.id
            UNION ALL SELECT created_at FROM date_proposals WHERE couple_id = c.id
            UNION ALL SELECT created_at FROM daily_prompt_answers WHERE couple_id = c.id
          ) x) AS last_active
       FROM couples c
       ORDER BY c.created_at DESC LIMIT 300`
    ),
  ]);

  // Fill every day in the window so the charts have no gaps, even at zero.
  const days: string[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - i);
    days.push(d.toISOString().slice(0, 10));
  }

  const signupsByDay = new Map(signupRows.map((r) => [r.day, r.n]));
  const signups = days.map((day) => ({ day, n: signupsByDay.get(day) ?? 0 }));

  const activityByDay = new Map<string, Record<string, number>>();
  for (const r of activityRows) {
    const cur = activityByDay.get(r.day) ?? {};
    cur[r.src] = r.n;
    activityByDay.set(r.day, cur);
  }
  const activity = days.map((day) => {
    const row = activityByDay.get(day) ?? {};
    const entry: Record<string, number | string> = { day };
    let total = 0;
    for (const src of ACTIVITY_SRC) {
      const n = row[src] ?? 0;
      entry[src] = n;
      total += n;
    }
    entry.total = total;
    return entry;
  });

  const couples = coupleRows
    .map((c) => ({
      ...c,
      total:
        (c.memories ?? 0) +
        (c.notes ?? 0) +
        (c.messages ?? 0) +
        (c.dates ?? 0) +
        (c.prompts ?? 0) +
        (c.comments ?? 0) +
        (c.bucket ?? 0) +
        (c.wishlist ?? 0),
    }))
    .sort((a, b) => b.total - a.total);

  res.status(200).json({
    totals,
    membership: membership ?? { paired: 0, solo: 0 },
    streaks: streaks ?? { on_streak: 0, longest_ever: 0, avg_current: 0 },
    activeCouples: active?.n ?? 0,
    signups,
    activity,
    couples,
  });
});
