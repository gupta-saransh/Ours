import { one, q } from '../_lib/db';
import { requireAdmin } from '../_lib/admin';
import { route } from '../_lib/respond';
import { errorFields, log } from '../_lib/log';
import {
  activeSpacesSpark,
  buildActivitySeries,
  buildCoupleRows,
  contentMix,
  countActiveSince,
  flowKpi,
  lastNDays,
  levelKpi,
  NAME_DELIM,
  unionAllSources,
  type ContentSource,
} from '../_lib/admin-aggregate';

/**
 * GET /api/admin/stats?days=7|30|90 — everything the dashboard renders, in one
 * request.
 *
 * WHAT LEAVES THE DATABASE: counts, timestamps, and member DISPLAY NAMES.
 * Never content, never decrypted anything, never an email or a token. Names are
 * a deliberate, recorded product decision (see CLAUDE.md): the dashboard's
 * whole job is telling you which couples are thriving and which have gone
 * quiet, and an opaque id makes that impossible to act on. Everything below the
 * name is still a count.
 *
 * WINDOWED AND COMPARED: every headline is measured over the requested window
 * AND over the preceding window of equal length, so the screen can show a delta
 * instead of a context-free number. That doubles a few queries and is worth it;
 * a number with no baseline gives nobody a reason to look twice.
 *
 * PERFORMANCE: one grouped query per SHAPE (`GROUP BY couple_id, src`), merged
 * in admin-aggregate.ts. Never a correlated subquery per couple; that pattern
 * meant thousands of scans per request at a few hundred couples.
 *
 * DEGRADATION: tables added after v18 are read behind `safe*` helpers with a
 * legacy fallback, so a deploy running ahead of `npm run migrate` renders those
 * figures as zero rather than 500ing the whole page.
 */

/** Everything that counts as "content a couple made". Adding a kind here updates
 *  the activity chart, the per-couple totals, the content mix, AND active-space
 *  counting, all at once. */
const SOURCES: ContentSource[] = [
  { src: 'messages', table: 'messages' },
  { src: 'memories', table: 'memories' },
  { src: 'notes', table: 'love_notes' },
  { src: 'todos', table: 'todos' },
  { src: 'prompts', table: 'daily_prompt_answers' },
  { src: 'comments', table: 'memory_comments' },
  { src: 'bucket', table: 'bucket_items' },
  { src: 'wishlist', table: 'wishlist_items' },
  { src: 'dates', table: 'date_proposals' },
];
/** Same list minus anything added after v18, for the pre-migration fallback. */
const LEGACY_SOURCES: ContentSource[] = SOURCES.filter((s) => s.table !== 'todos');

const SOURCE_KEYS = SOURCES.map((s) => s.src);
const ALLOWED_WINDOWS = [7, 30, 90];

async function safeCount(label: string, sql: string): Promise<number> {
  try {
    const row = await one<{ n: number }>(sql);
    return Number(row?.n ?? 0);
  } catch (err) {
    log('warn', 'admin.count_unavailable', { metric: label, ...errorFields(err) });
    return 0;
  }
}

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

  const requested = Number(req.query.days);
  const days = ALLOWED_WINDOWS.includes(requested) ? requested : 30;
  // The comparison window is the same length, immediately before this one.
  const span = `${days} days`;
  const doubleSpan = `${days * 2} days`;

  const union = unionAllSources(SOURCES);
  const legacyUnion = unionAllSources(LEGACY_SOURCES);

  const [
    totals,
    spaces,
    prevSpaces,
    people,
    prevPeople,
    health,
    streaks,
    signupRows,
    activityRows,
    activeDayRows,
    prevWindow,
    coupleRows,
    coupleCountRows,
    lastActiveRows,
    memberRows,
    extras,
  ] = await Promise.all([
    // Lifetime totals per source, for the content mix.
    one<Record<string, number>>(
      `SELECT
         (SELECT count(*)::int FROM messages) AS messages,
         (SELECT count(*)::int FROM memories) AS memories,
         (SELECT count(*)::int FROM love_notes) AS notes,
         (SELECT count(*)::int FROM daily_prompt_answers) AS prompts,
         (SELECT count(*)::int FROM memory_comments) AS comments,
         (SELECT count(*)::int FROM date_proposals) AS dates,
         (SELECT count(*)::int FROM bucket_items) AS bucket,
         (SELECT count(*)::int FROM wishlist_items) AS wishlist,
         (SELECT count(*)::int FROM milestones) AS milestones`
    ),
    // A "space" is a couple row that actually HAS members. Counting couple rows
    // instead was the old dashboard's headline bug: abandoned shells (a signup
    // that never got used, a joined-away space) inflated it badly.
    one<{ spaces: number; paired: number; solo: number; empty: number }>(
      `SELECT
         (SELECT count(DISTINCT couple_id)::int FROM users WHERE couple_id IS NOT NULL) AS spaces,
         (SELECT count(*)::int FROM (SELECT couple_id FROM users WHERE couple_id IS NOT NULL
            GROUP BY couple_id HAVING count(*) = 2) t) AS paired,
         (SELECT count(*)::int FROM (SELECT couple_id FROM users WHERE couple_id IS NOT NULL
            GROUP BY couple_id HAVING count(*) = 1) t) AS solo,
         (SELECT count(*)::int FROM couples c
            WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.couple_id = c.id)) AS empty`
    ),
    one<{ n: number }>(
      `SELECT count(DISTINCT u.couple_id)::int AS n FROM users u
       WHERE u.couple_id IS NOT NULL AND u.created_at < now() - INTERVAL '${span}'`
    ),
    one<{ n: number }>(`SELECT count(*)::int AS n FROM users`),
    one<{ n: number }>(`SELECT count(*)::int AS n FROM users WHERE created_at < now() - INTERVAL '${span}'`),
    // Delivery health. Not vanity: 4 of 13 users having no push subscription is
    // the difference between a reminder feature working and not existing.
    one<{ no_push: number; notifs_off: number; unpaired_people: number }>(
      `SELECT
         count(*) FILTER (WHERE push_token IS NULL)::int AS no_push,
         count(*) FILTER (WHERE notifications_enabled = false)::int AS notifs_off,
         count(*) FILTER (WHERE couple_id IS NULL)::int AS unpaired_people
       FROM users`
    ),
    one<{ on_streak: number; longest_ever: number; avg_current: number }>(
      `SELECT
         count(*) FILTER (WHERE current_streak_days > 0)::int AS on_streak,
         COALESCE(max(longest_streak_days), 0)::int AS longest_ever,
         COALESCE(round(avg(current_streak_days) FILTER (WHERE current_streak_days > 0)), 0)::int AS avg_current
       FROM couples`
    ),
    q<{ day: string; n: number }>(
      `SELECT created_at::DATE::STRING AS day, count(*)::int AS n
       FROM users WHERE created_at > now() - INTERVAL '${span}'
       GROUP BY day ORDER BY day ASC`
    ),
    safeRows<{ day: string; src: string; n: number }>(
      'activity',
      `SELECT created_at::DATE::STRING AS day, src, count(*)::int AS n
       FROM (${union}) t WHERE created_at > now() - INTERVAL '${span}' GROUP BY day, src`,
      `SELECT created_at::DATE::STRING AS day, src, count(*)::int AS n
       FROM (${legacyUnion}) t WHERE created_at > now() - INTERVAL '${span}' GROUP BY day, src`
    ),
    // Distinct spaces active per day, for the "active spaces" sparkline.
    safeRows<{ day: string; couple_id: string }>(
      'active_days',
      `SELECT DISTINCT created_at::DATE::STRING AS day, couple_id::STRING AS couple_id
       FROM (${union}) t WHERE created_at > now() - INTERVAL '${span}' AND couple_id IS NOT NULL`,
      `SELECT DISTINCT created_at::DATE::STRING AS day, couple_id::STRING AS couple_id
       FROM (${legacyUnion}) t WHERE created_at > now() - INTERVAL '${span}' AND couple_id IS NOT NULL`
    ),
    // The preceding window, for every flow delta, in ONE pass.
    safeRows<{ src: string; n: number }>(
      'previous_window',
      `SELECT src, count(*)::int AS n FROM (${union}) t
       WHERE created_at > now() - INTERVAL '${doubleSpan}' AND created_at <= now() - INTERVAL '${span}'
       GROUP BY src`,
      `SELECT src, count(*)::int AS n FROM (${legacyUnion}) t
       WHERE created_at > now() - INTERVAL '${doubleSpan}' AND created_at <= now() - INTERVAL '${span}'
       GROUP BY src`
    ),
    q<{ id: string; created_at: string; encrypted: boolean; streak: number }>(
      `SELECT id::STRING AS id, created_at::STRING AS created_at,
              (wrapped_dek IS NOT NULL) AS encrypted,
              COALESCE(current_streak_days, 0)::int AS streak
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
    // Names joined with a control character, split apart in admin-aggregate;
    // a comma or plus sign could appear inside a display name, that cannot.
    q<{ couple_id: string; members: number; names: string }>(
      `SELECT couple_id::STRING AS couple_id, count(*)::int AS members,
              string_agg(display_name, '${NAME_DELIM}') AS names
       FROM users WHERE couple_id IS NOT NULL GROUP BY couple_id`
    ),
    Promise.all([
      safeCount('todos', 'SELECT count(*)::int AS n FROM todos'),
      safeCount('todos_done', 'SELECT count(*)::int AS n FROM todos WHERE done = true'),
      safeCount('game_rounds', 'SELECT count(*)::int AS n FROM daily_game_answers'),
      safeCount('reactions', 'SELECT count(*)::int AS n FROM message_reactions'),
      safeCount('referred', 'SELECT count(*)::int AS n FROM users WHERE referred_by IS NOT NULL'),
      safeCount('reflections', 'SELECT count(*)::int AS n FROM weekly_reflections'),
      safeCount(
        'capsules',
        `SELECT ((SELECT count(*)::int FROM memories WHERE sealed_until IS NOT NULL)
               + (SELECT count(*)::int FROM love_notes WHERE sealed_until IS NOT NULL)) AS n`
      ),
    ]),
  ]);

  const [todos, todosDone, gameRounds, reactions, referred, reflections, capsules] = extras;

  const now = new Date();
  const dayList = lastNDays(days, now.toISOString());
  const series = buildActivitySeries(dayList, activityRows, SOURCE_KEYS);
  const signupsByDay = new Map(signupRows.map((r) => [r.day, Number(r.n)]));
  const signupSpark = dayList.map((d) => signupsByDay.get(d) ?? 0);

  const prevBySrc = new Map(prevWindow.map((r) => [r.src, Number(r.n)]));
  const prevTotal = [...prevBySrc.values()].reduce((a, b) => a + b, 0);

  const weekAgo = new Date(now.getTime() - 7 * 86_400_000).toISOString();
  const activeSpark = activeSpacesSpark(dayList, activeDayRows);

  const totalsAll = {
    ...(totals ?? {}),
    todos,
  } as Record<string, number>;

  res.status(200).json({
    generatedAt: now.toISOString(),
    window: { days, from: dayList[0] ?? null, to: dayList[dayList.length - 1] ?? null },
    sources: SOURCE_KEYS,

    // The four headlines, each with its own baseline and shape.
    kpis: {
      activeSpaces: levelKpi(
        countActiveSince(lastActiveRows, weekAgo),
        0,
        activeSpark
      ),
      spaces: levelKpi(Number(spaces?.spaces ?? 0), Number(prevSpaces?.n ?? 0), []),
      people: levelKpi(Number(people?.n ?? 0), Number(prevPeople?.n ?? 0), signupSpark),
      content: flowKpi(series.map((d) => d.total), prevTotal),
      messages: flowKpi(series.map((d) => d.counts.messages ?? 0), prevBySrc.get('messages') ?? 0),
    },

    membership: {
      spaces: Number(spaces?.spaces ?? 0),
      paired: Number(spaces?.paired ?? 0),
      solo: Number(spaces?.solo ?? 0),
      empty: Number(spaces?.empty ?? 0),
      coupleRowsTotal: coupleRows.length,
    },

    // Things that are broken or drifting, not vanity counts.
    health: {
      emptySpaces: Number(spaces?.empty ?? 0),
      noPushSubscription: Number(health?.no_push ?? 0),
      notificationsOff: Number(health?.notifs_off ?? 0),
      unpairedPeople: Number(health?.unpaired_people ?? 0),
      totalPeople: Number(people?.n ?? 0),
    },

    engagement: {
      onStreak: Number(streaks?.on_streak ?? 0),
      longestEver: Number(streaks?.longest_ever ?? 0),
      avgStreak: Number(streaks?.avg_current ?? 0),
      gameRounds,
      todos,
      todosDone,
      reactions,
      capsules,
      reflections,
      referred,
    },

    activity: series,
    signups: dayList.map((day) => ({ day, n: signupsByDay.get(day) ?? 0 })),
    contentMix: contentMix(totalsAll, [...SOURCE_KEYS, 'milestones']),
    couples: buildCoupleRows(coupleRows, coupleCountRows, lastActiveRows, memberRows, SOURCE_KEYS),
  });
});
