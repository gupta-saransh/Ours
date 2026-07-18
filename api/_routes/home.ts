import { one, q } from '../_lib/db';
import { requirePairedUser } from '../_lib/auth';
import { readField } from '../_lib/envelope';
import { route } from '../_lib/respond';
import { promptStateFor, streakStateFor } from './prompts';
import { computeReflection } from './reflection';
import { gameStateFor } from './game';

const RESURFACE_COLUMNS = `id, thumb_data, note, note_ct,
  COALESCE(memory_date, created_at::DATE)::STRING AS memory_date`;

/**
 * Relationship points and levels (the second retention hook beside the streak).
 * Everything the couple keeps in the app earns points; thresholds name the
 * level. Computed on read from durable rows only, so it never needs its own
 * counter column and can never drift. Kept in sync with the LEVELS/POINT_SOURCES
 * copies in app/(tabs)/index.tsx.
 */
const LEVELS: { at: number; title: string }[] = [
  { at: 0, title: 'First Glance' },
  { at: 15, title: 'Getting Closer' },
  { at: 40, title: 'Finding Our Rhythm' },
  { at: 80, title: 'Love Letters' },
  { at: 140, title: 'Slow Dances' },
  { at: 220, title: 'Golden Hours' },
  { at: 320, title: 'Building a Life' },
  { at: 450, title: 'The Long Song' },
  { at: 620, title: 'A Thousand Days' },
  { at: 850, title: 'Ever After' },
];

/** Points each durable thing earns. Kept in sync with the client copy. */
const POINTS: Record<string, number> = {
  memories: 5,
  dates_done: 5,
  answers: 3,
  bucket_done: 3,
  notes: 2,
  milestones: 2,
  guesses: 2,
  todos_done: 2,
  comments: 1,
};

function storyFor(counts: Record<string, number>) {
  let points = 0;
  for (const [key, per] of Object.entries(POINTS)) points += (counts[key] ?? 0) * per;
  let idx = 0;
  for (let i = 0; i < LEVELS.length; i++) if (points >= LEVELS[i].at) idx = i;
  const next = LEVELS[idx + 1] ?? null;
  return {
    points,
    level: idx + 1,
    levelTitle: LEVELS[idx].title,
    levelStart: LEVELS[idx].at,
    nextAt: next ? next.at : null,
  };
}

/** Maps a `recent` row's source to the counts key whose points it earns. */
const RECENT_KIND_TO_POINTS: Record<string, string> = {
  memory: 'memories',
  note: 'notes',
  answer: 'answers',
  comment: 'comments',
  milestone: 'milestones',
  bucket: 'bucket_done',
  date: 'dates_done',
  guess: 'guesses',
  todo: 'todos_done',
};

/**
 * One request powers the whole home screen: days-together basis, partner,
 * upcoming milestones, a resurfaced memory (a year ago today, then a month
 * ago today, then a random older one), the bucket list, the latest pinned
 * note, and the unseen-notification count. Everything runs in parallel.
 */
export default route(['GET'], async (req, res) => {
  const user = await requirePairedUser(req);
  const cid = user.couple_id;

  const isSunday = new Date().getUTCDay() === 0;

  const [couple, partner, anniversary, milestones, yearAgo, monthAgo, older, bucket, pinnedNote, seen, prompt, upcomingDate, reflection, streak, storyCounts, guessRow, recentRows, game, todoWeek, todoWins] =
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
        `SELECT n.id, n.author_id, n.body, n.body_ct, n.created_at, u.display_name AS author_name
         FROM love_notes n JOIN users u ON u.id = n.author_id
         WHERE n.couple_id = $1 AND n.pinned = true ORDER BY n.created_at DESC LIMIT 1`,
        [cid]
      ),
      one<{ notifications_seen_at: string }>('SELECT notifications_seen_at FROM users WHERE id = $1', [user.id]),
      promptStateFor(cid, user.id),
      one(
        `SELECT id, title, title_ct, location, location_ct, proposed_for::STRING AS proposed_for FROM date_proposals
         WHERE couple_id = $1 AND status = 'accepted' AND proposed_for >= now()::DATE
           AND proposed_for < now()::DATE + 30
         ORDER BY proposed_for ASC LIMIT 1`,
        [cid]
      ),
      isSunday ? computeReflection(cid) : Promise.resolve(null),
      streakStateFor(cid),
      one<Record<string, number>>(
        `SELECT
           (SELECT count(*)::int FROM memories WHERE couple_id = $1) AS memories,
           (SELECT count(*)::int FROM love_notes WHERE couple_id = $1) AS notes,
           (SELECT count(*)::int FROM daily_prompt_answers WHERE couple_id = $1) AS answers,
           (SELECT count(*)::int FROM memory_comments WHERE couple_id = $1) AS comments,
           (SELECT count(*)::int FROM date_proposals WHERE couple_id = $1 AND status = 'accepted'
              AND (proposed_for IS NULL OR proposed_for <= now()::DATE)) AS dates_done,
           (SELECT count(*)::int FROM bucket_items WHERE couple_id = $1 AND done = true) AS bucket_done,
           (SELECT count(*)::int FROM milestones WHERE couple_id = $1) AS milestones`,
        [cid]
      ),
      // Correct This-or-That guesses: my guess matched their pick that day.
      // Catch-guarded: the table is v16 and a pre-migration deploy must degrade.
      one<{ n: number }>(
        // Both rounds of the day count (v18), hence the two comparisons.
        `SELECT (count(*) FILTER (WHERE a.guess = b.pick)
               + count(*) FILTER (WHERE a.guess2 IS NOT NULL AND b.pick2 IS NOT NULL AND a.guess2 = b.pick2))::int AS n
         FROM daily_game_answers a
         JOIN daily_game_answers b
           ON b.couple_id = a.couple_id AND b.game_date = a.game_date AND b.user_id != a.user_id
         WHERE a.couple_id = $1`,
        [cid]
      ).catch(() => null),
      // The last few point-earning moments, for the journey card's activity list.
      q<{ kind: string; created_at: string }>(
        `SELECT kind, created_at::STRING AS created_at FROM (
           SELECT 'memory' AS kind, created_at FROM memories WHERE couple_id = $1
           UNION ALL SELECT 'note', created_at FROM love_notes WHERE couple_id = $1
           UNION ALL SELECT 'answer', created_at FROM daily_prompt_answers WHERE couple_id = $1
           UNION ALL SELECT 'comment', created_at FROM memory_comments WHERE couple_id = $1
           UNION ALL SELECT 'milestone', created_at FROM milestones WHERE couple_id = $1
           UNION ALL SELECT 'bucket', completed_at FROM bucket_items
             WHERE couple_id = $1 AND done = true AND completed_at IS NOT NULL
           UNION ALL SELECT 'date', completed_at FROM date_proposals
             WHERE couple_id = $1 AND completed_at IS NOT NULL
         ) t ORDER BY created_at DESC LIMIT 5`,
        [cid]
      ).catch(() => [] as { kind: string; created_at: string }[]),
      gameStateFor(cid, user.id),
      // The week's to-do standing, for the Home summary card. Monday-based like
      // the weekly reflection. Catch-guarded: the table is v19 and a deploy that
      // lands before the migration must degrade to "no card", not a 500.
      one<Record<string, number>>(
        `SELECT
           count(*) FILTER (WHERE done AND done_at >= date_trunc('week', now()))::int AS week_done,
           count(*) FILTER (WHERE due_date >= date_trunc('week', now())::DATE
                              AND due_date < date_trunc('week', now())::DATE + 7)::int AS week_total,
           count(*) FILTER (WHERE done = false AND due_date < now()::DATE)::int AS overdue,
           count(*) FILTER (WHERE due_date = now()::DATE)::int AS today_total,
           count(*) FILTER (WHERE due_date = now()::DATE AND done)::int AS today_done,
           count(*) FILTER (WHERE done)::int AS all_done
         FROM todos WHERE couple_id = $1`,
        [cid]
      ).catch(() => null),
      // A few of the week's wins by name, so the card can say what you actually
      // did rather than only how many.
      q<Record<string, any>>(
        `SELECT title, title_ct, done_by FROM todos
         WHERE couple_id = $1 AND done AND done_at >= date_trunc('week', now())
         ORDER BY done_at DESC LIMIT 3`,
        [cid]
      ).catch(() => [] as Record<string, any>[]),
    ]);

  // `nudges` powers the on-open hearts shower: an unseen nudge from the last
  // two days means your partner was thinking of you while you were away. The
  // nickname (catch-guarded for pre-v11 deploys) resolves the pinned-note author.
  const [unseenRow, myNick] = await Promise.all([
    one<{ n: number; nudges: number }>(
      `SELECT count(*)::int AS n,
              count(*) FILTER (WHERE kind = 'nudge' AND created_at > now() - INTERVAL '48 hours')::int AS nudges
       FROM notifications
       WHERE couple_id = $1 AND actor_id != $2 AND created_at > $3`,
      [cid, user.id, seen?.notifications_seen_at ?? new Date(0).toISOString()]
    ),
    one<{ partner_nickname: string | null }>('SELECT partner_nickname FROM users WHERE id = $1', [user.id]).catch(
      () => null
    ),
  ]);
  const partnerNickname = myNick?.partner_nickname ?? null;

  const picked = yearAgo
    ? { ...yearAgo, tag: 'One year ago today' }
    : monthAgo
      ? { ...monthAgo, tag: 'One month ago today' }
      : older
        ? { ...older, tag: 'From your story' }
        : null;

  // Decrypt the couple-authored free text (envelope.ts) and drop the raw
  // ciphertext columns from the response.
  let resurfaced = null as Record<string, unknown> | null;
  if (picked) {
    const { note_ct, note, ...rest } = picked as Record<string, unknown> & { note_ct?: Buffer | null; note?: string };
    resurfaced = { ...rest, note: (await readField(cid, note_ct, note ?? '')) ?? '' };
  }

  let pinnedNoteOut = null as Record<string, unknown> | null;
  if (pinnedNote) {
    const { body_ct, body, ...rest } = pinnedNote as Record<string, unknown> & { body_ct?: Buffer | null; body?: string };
    // Show the pet name if the pinned note is the partner's and one is set.
    const authorName =
      partnerNickname && partner && (rest as { author_id?: string }).author_id === partner.id
        ? partnerNickname
        : (rest as { author_name?: string }).author_name;
    pinnedNoteOut = { ...rest, author_name: authorName, body: (await readField(cid, body_ct, body ?? '')) ?? '' };
  }

  let upcomingDateOut = null as Record<string, unknown> | null;
  if (upcomingDate) {
    const { title_ct, title, location_ct, location, ...rest } = upcomingDate as Record<string, unknown> & {
      title_ct?: Buffer | null;
      title?: string;
      location_ct?: Buffer | null;
      location?: string | null;
    };
    upcomingDateOut = {
      ...rest,
      title: (await readField(cid, title_ct, title ?? '')) ?? '',
      location: (await readField(cid, location_ct, location ?? null)) ?? location ?? null,
    };
  }

  // Titles are encrypted at rest, so the week's wins decrypt here like every
  // other piece of couple-authored text on this screen.
  const todos = todoWeek
    ? {
        weekDone: todoWeek.week_done ?? 0,
        weekTotal: todoWeek.week_total ?? 0,
        overdue: todoWeek.overdue ?? 0,
        todayTotal: todoWeek.today_total ?? 0,
        todayDone: todoWeek.today_done ?? 0,
        wins: await Promise.all(
          (todoWins ?? []).map(async (w) => ({
            title: (await readField(cid, w.title_ct, w.title)) ?? '',
            done_by: w.done_by,
          }))
        ),
      }
    : null;

  res.status(200).json({
    couple,
    partner: partner ?? null,
    todos,
    daysBasis: anniversary?.date ?? null,
    milestones,
    resurfaced,
    bucket,
    pinnedNote: pinnedNoteOut,
    unseen: unseenRow?.n ?? 0,
    prompt,
    upcomingDate: upcomingDateOut,
    isSunday,
    reflection,
    streak,
    nudged: (unseenRow?.nudges ?? 0) > 0,
    game,
    story: (() => {
      const counts = {
        ...(storyCounts ?? {
          memories: 0, notes: 0, answers: 0, comments: 0, dates_done: 0, bucket_done: 0, milestones: 0,
        }),
        guesses: guessRow?.n ?? 0,
        todos_done: todoWeek?.all_done ?? 0,
      };
      // Each recent moment carries the points it earned, so the card can show
      // "+5 · A memory · Jul 12" without the client re-deriving the values.
      const recent = (recentRows ?? []).map((r) => ({
        kind: r.kind,
        points: POINTS[RECENT_KIND_TO_POINTS[r.kind] ?? ''] ?? 0,
        created_at: r.created_at,
      }));
      return { ...storyFor(counts), counts, recent };
    })(),
  });
});
