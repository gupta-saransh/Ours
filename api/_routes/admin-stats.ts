import { one, q } from '../_lib/db';
import { requireAdmin } from '../_lib/admin';
import { route } from '../_lib/respond';
import { errorFields, log } from '../_lib/log';
import {
  buildActivitySeries,
  buildCoupleRows,
  countActiveSince,
  lastNDays,
  unionAllSources,
  type ContentSource,
} from '../_lib/admin-aggregate';

/**
 * GET /api/admin/stats — aggregate + per-couple COUNTS only. Never reads couple
 * content and never decrypts: only row counts and timestamps leave the
 * database. Per-couple rows carry a short opaque id prefix, the member count,
 * and how much of each thing the couple has made. No names, no text, no photos.
 *
 * PERFORMANCE: every per-couple number comes from ONE grouped query per shape
 * (`GROUP BY couple_id, src`), merged in `admin-aggregate.ts`. The previous
 * version ran nine correlated subqueries per couple row, so a few hundred
 * couples meant thousands of scans in a single request; do not reintroduce
 * that pattern when adding a new count.
 *
 * DEGRADATION: newer tables (todos v19, daily_game_answers v16/v18,
 * message_reactions v21) are queried behind `safe*` helpers and fall back to a
 * legacy source list, so a deploy that runs ahead of `npm run migrate` renders
 * a dashboard with those figures at zero instead of 500ing the whole page.
 */

/** Everything that counts as "content a couple made", for activity + per-couple volume. */
const SOURCES: ContentSource[] = [
  { src: 'memories', table: 'memories' },
  { src: 'notes', table: 'love_notes' },
  { src: 'messages', table: 'messages' },
  { src: 'prompts', table: 'daily_prompt_answers' },
  { src: 'comments', table: 'memory_comments' },
  { src: 'dates', table: 'date_proposals' },
  { src: 'todos', table: 'todos' },
  { src: 'bucket', table: 'bucket_items' },
  { src: 'wishlist', table: 'wishlist_items' },
];
/** Same list minus anything added after v18, for the pre-migration fallback. */
const LEGACY_SOURCES: ContentSource[] = SOURCES.filter((s) => s.table !== 'todos');

const SOURCE_KEYS = SOURCES.map((s) => s.src);
const WINDOW_DAYS = 30;

/** A count that returns 0 (and says so in the log) rather than failing the page. */
async function safeCount(label: string, sql: string): Promise<number> {
  try {
    const row = await one<{ n: number }>(sql);
    return row?.n ?? 0;
  } catch (err) {
    log('warn', 'admin.count_unavailable', { metric: label, ...errorFields(err) });
    return 0;
  }
}

/** Runs `sql`, falling back to `legacySql` when a newer table is missing. */
async function safeRows<T>(label: string, sql: string, legacySql: string): Promise<T[]> {
  try {
    return await q<T>(sql);
  } catch (err) {
    log('warn', 'admin.query_fallback', { metric: label, ...errorFields(err) });
    try {
      return await q<T>(legacySql);
    } catch (err2) {
      log('error', 'admin.query_unavailable', { metric: label, ...errorFields(err2) });
      return [];
    }
  }
}

export default route(['GET'], async (req, res) => {
  requireAdmin(req);

  const union = unionAllSources(SOURCES);
  const legacyUnion = unionAllSources(LEGACY_SOURCES);

  const [
    totals,
    membership,
    streaks,
    signupRows,
    activityRows,
    coupleRows,
    coupleCountRows,
    lastActiveRows,
    memberRows,
    todos,
    todosDone,
    gameRounds,
    reactions,
    referred,
    capsules,
    reflections,
  ] = await Promise.all([
    one<Record<string, number>>(
      `SELECT
         (SELECT count(*)::int FROM couples) AS couples,
         (SELECT count(*)::int FROM users) AS users,
         (SELECT count(*)::int FROM couples WHERE wrapped_dek IS NOT NULL) AS encrypted_couples,
         (SELECT count(*)::int FROM memories) AS memories,
         (SELECT count(*)::int FROM love_notes) AS notes,
         (SELECT count(*)::int FROM milestones) AS milestones,
         (SELECT count(*)::int FROM daily_prompt_answers) AS prompts,
         (SELECT count(*)::int FROM memory_comments) AS comments,
         (SELECT count(*)::int FROM date_proposals) AS dates,
         (SELECT count(*)::int FROM wishlist_items) AS wishlist,
         (SELECT count(*)::int FROM messages) AS messages,
         (SELECT count(*)::int FROM bucket_items) AS bucket,
         (SELECT count(*)::int FROM bucket_items WHERE done = true) AS bucket_done`
    ),
    one<{ paired: number; solo: number }>(
      `SELECT
         count(*) FILTER (WHERE n = 2)::int AS paired,
         count(*) FILTER (WHERE n = 1)::int AS solo
       FROM (SELECT couple_id, count(*) AS n FROM users WHERE couple_id IS NOT NULL GROUP BY couple_id) t`
    ),
    // NOTE: these read the couples.* streak CACHE columns (v6), refreshed by
    // advanceStreak on each reveal. The couple-facing streak is recomputed from
    // the answer history every read (api/_lib/streak.ts) and is the source of
    // truth; these are analytics-grade, not authoritative.
    one<{ on_streak: number; longest_ever: number; avg_current: number }>(
      `SELECT
         count(*) FILTER (WHERE current_streak_days > 0)::int AS on_streak,
         COALESCE(max(longest_streak_days), 0)::int AS longest_ever,
         COALESCE(round(avg(current_streak_days) FILTER (WHERE current_streak_days > 0)), 0)::int AS avg_current
       FROM couples`
    ),
    q<{ day: string; n: number }>(
      `SELECT created_at::DATE::STRING AS day, count(*)::int AS n
       FROM users WHERE created_at > now() - INTERVAL '${WINDOW_DAYS} days'
       GROUP BY day ORDER BY day ASC`
    ),
    safeRows<{ day: string; src: string; n: number }>(
      'activity',
      `SELECT created_at::DATE::STRING AS day, src, count(*)::int AS n
       FROM (${union}) t WHERE created_at > now() - INTERVAL '${WINDOW_DAYS} days'
       GROUP BY day, src`,
      `SELECT created_at::DATE::STRING AS day, src, count(*)::int AS n
       FROM (${legacyUnion}) t WHERE created_at > now() - INTERVAL '${WINDOW_DAYS} days'
       GROUP BY day, src`
    ),
    q<{ id: string; created_at: string; encrypted: boolean }>(
      `SELECT id::STRING AS id, created_at::STRING AS created_at, (wrapped_dek IS NOT NULL) AS encrypted
       FROM couples ORDER BY created_at DESC LIMIT 500`
    ),
    safeRows<{ couple_id: string; src: string; n: number }>(
      'couple_counts',
      `SELECT couple_id::STRING AS couple_id, src, count(*)::int AS n
       FROM (${union}) t WHERE couple_id IS NOT NULL GROUP BY couple_id, src`,
      `SELECT couple_id::STRING AS couple_id, src, count(*)::int AS n
       FROM (${legacyUnion}) t WHERE couple_id IS NOT NULL GROUP BY couple_id, src`
    ),
    safeRows<{ couple_id: string; last_active: string | null }>(
      'last_active',
      `SELECT couple_id::STRING AS couple_id, max(created_at)::STRING AS last_active
       FROM (${union}) t WHERE couple_id IS NOT NULL GROUP BY couple_id`,
      `SELECT couple_id::STRING AS couple_id, max(created_at)::STRING AS last_active
       FROM (${legacyUnion}) t WHERE couple_id IS NOT NULL GROUP BY couple_id`
    ),
    q<{ couple_id: string; members: number }>(
      `SELECT couple_id::STRING AS couple_id, count(*)::int AS members
       FROM users WHERE couple_id IS NOT NULL GROUP BY couple_id`
    ),
    safeCount('todos', 'SELECT count(*)::int AS n FROM todos'),
    safeCount('todos_done', 'SELECT count(*)::int AS n FROM todos WHERE done = true'),
    safeCount('game_rounds', 'SELECT count(*)::int AS n FROM daily_game_answers'),
    safeCount('reactions', 'SELECT count(*)::int AS n FROM message_reactions'),
    safeCount('referred', 'SELECT count(*)::int AS n FROM users WHERE referred_by IS NOT NULL'),
    safeCount(
      'capsules',
      `SELECT (
         (SELECT count(*)::int FROM memories WHERE sealed_until IS NOT NULL)
         + (SELECT count(*)::int FROM love_notes WHERE sealed_until IS NOT NULL)
       ) AS n`
    ),
    safeCount('reflections', 'SELECT count(*)::int AS n FROM weekly_reflections'),
  ]);

  const now = new Date();
  const days = lastNDays(WINDOW_DAYS, now.toISOString());
  const signupsByDay = new Map(signupRows.map((r) => [r.day, r.n]));

  const couples = buildCoupleRows(coupleRows, coupleCountRows, lastActiveRows, memberRows, SOURCE_KEYS);
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000).toISOString();

  res.status(200).json({
    generatedAt: now.toISOString(),
    sources: SOURCE_KEYS,
    totals: {
      ...(totals ?? {}),
      todos,
      todos_done: todosDone,
      game_rounds: gameRounds,
      reactions,
      referred,
      capsules,
      reflections,
    },
    membership: membership ?? { paired: 0, solo: 0 },
    streaks: streaks ?? { on_streak: 0, longest_ever: 0, avg_current: 0 },
    activeCouples: countActiveSince(lastActiveRows, weekAgo),
    signups: days.map((day) => ({ day, n: signupsByDay.get(day) ?? 0 })),
    activity: buildActivitySeries(days, activityRows, SOURCE_KEYS),
    couples,
  });
});
