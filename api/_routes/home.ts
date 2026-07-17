import { one, q } from '../_lib/db';
import { requirePairedUser } from '../_lib/auth';
import { readField } from '../_lib/envelope';
import { route } from '../_lib/respond';
import { promptStateFor, streakStateFor } from './prompts';
import { computeReflection } from './reflection';

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
  { at: 140, title: 'Keepsakes' },
  { at: 220, title: 'Golden Hours' },
  { at: 320, title: 'Building a Life' },
  { at: 450, title: 'The Long Song' },
  { at: 620, title: 'A Thousand Days' },
  { at: 850, title: 'Ever After' },
];

function storyFor(counts: Record<string, number>) {
  const points =
    counts.memories * 5 +
    counts.notes * 2 +
    counts.answers * 3 +
    counts.comments * 1 +
    counts.dates_done * 5 +
    counts.bucket_done * 3 +
    counts.milestones * 2;
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

  const [couple, partner, anniversary, milestones, yearAgo, monthAgo, older, bucket, pinnedNote, seen, prompt, upcomingDate, reflection, streak, storyCounts] =
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
        `SELECT n.id, n.body, n.body_ct, n.created_at, u.display_name AS author_name
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
    ]);

  // `nudges` powers the on-open hearts shower: an unseen nudge from the last
  // two days means your partner was thinking of you while you were away.
  const unseenRow = await one<{ n: number; nudges: number }>(
    `SELECT count(*)::int AS n,
            count(*) FILTER (WHERE kind = 'nudge' AND created_at > now() - INTERVAL '48 hours')::int AS nudges
     FROM notifications
     WHERE couple_id = $1 AND actor_id != $2 AND created_at > $3`,
    [cid, user.id, seen?.notifications_seen_at ?? new Date(0).toISOString()]
  );

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
    pinnedNoteOut = { ...rest, body: (await readField(cid, body_ct, body ?? '')) ?? '' };
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

  res.status(200).json({
    couple,
    partner: partner ?? null,
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
    story: (() => {
      const counts = storyCounts ?? {
        memories: 0, notes: 0, answers: 0, comments: 0, dates_done: 0, bucket_done: 0, milestones: 0,
      };
      return { ...storyFor(counts), counts };
    })(),
  });
});
