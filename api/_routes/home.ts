import { one, q } from '../_lib/db';
import { requirePairedUser } from '../_lib/auth';
import { readField } from '../_lib/envelope';
import { route } from '../_lib/respond';
import { promptStateFor } from './prompts';
import { computeReflection } from './reflection';

const RESURFACE_COLUMNS = `id, thumb_data, note, note_ct,
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

  const isSunday = new Date().getUTCDay() === 0;

  const [couple, partner, anniversary, milestones, yearAgo, monthAgo, older, bucket, pinnedNote, seen, prompt, upcomingDate, reflection] =
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
    ]);

  const unseenRow = await one<{ n: number }>(
    `SELECT count(*)::int AS n FROM notifications
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
  });
});
