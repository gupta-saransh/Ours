import { one, q } from '../_lib/db';
import { requirePairedUser } from '../_lib/auth';
import { publish } from '../_lib/ably';
import { notify } from '../_lib/notify';
import { route, requireString, HttpError } from '../_lib/respond';

/**
 * Performance contract: the list NEVER carries full-resolution photos, only
 * small thumbnails (~15 KB). The full photo is fetched on demand from
 * GET /api/memories/:id when a card is opened.
 */
const LIST_COLUMNS = `m.id, m.author_id,
  CASE WHEN m.sealed_until IS NOT NULL AND m.sealed_until > now()::DATE AND m.author_id != $2
       THEN NULL ELSE m.thumb_data END AS thumb_data,
  CASE WHEN m.sealed_until IS NOT NULL AND m.sealed_until > now()::DATE AND m.author_id != $2
       THEN '' ELSE m.note END AS note,
  m.sealed_until::STRING AS sealed_until,
  (m.sealed_until IS NOT NULL AND m.sealed_until > now()::DATE) AS sealed,
  (m.capsule_opened_at IS NOT NULL) AS opened,
  COALESCE(m.memory_date, m.created_at::DATE)::STRING AS memory_date, m.created_at,
  u.display_name AS author_name,
  (SELECT count(*)::int FROM memory_hearts h WHERE h.memory_id = m.id) AS hearts,
  EXISTS(SELECT 1 FROM memory_hearts h WHERE h.memory_id = m.id AND h.user_id = $2) AS hearted_by_me,
  (m.photo_data IS NOT NULL) AS has_photo`;

function validImage(value: unknown, maxLen: number): string {
  if (typeof value !== 'string' || !value.startsWith('data:image/')) {
    throw new HttpError(400, 'Photo must be an image');
  }
  if (value.length > maxLen) throw new HttpError(413, 'Photo is too large');
  return value;
}

export default route(['GET', 'POST'], async (req, res) => {
  const user = await requirePairedUser(req);

  if (req.method === 'GET') {
    const memories = await q(
      `SELECT ${LIST_COLUMNS} FROM memories m
       JOIN users u ON u.id = m.author_id
       WHERE m.couple_id = $1
       ORDER BY COALESCE(m.memory_date, m.created_at::DATE) DESC, m.created_at DESC
       LIMIT 400`,
      [user.couple_id, user.id]
    );
    res.status(200).json({ memories });
    return;
  }

  const note = requireString(req.body?.note, 'Note', 4000);
  const photoData = req.body?.photoData ? validImage(req.body.photoData, 3_500_000) : null;
  const thumbData = req.body?.thumbData ? validImage(req.body.thumbData, 200_000) : null;
  let memoryDate: string | null = null;
  if (req.body?.memoryDate) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(req.body.memoryDate)) {
      throw new HttpError(400, 'memoryDate must be YYYY-MM-DD');
    }
    memoryDate = req.body.memoryDate;
  }
  let sealedUntil: string | null = null;
  if (req.body?.sealedUntil) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(req.body.sealedUntil)) throw new HttpError(400, 'sealedUntil must be YYYY-MM-DD');
    if (req.body.sealedUntil <= new Date().toISOString().slice(0, 10)) {
      throw new HttpError(400, 'A capsule needs a date in the future');
    }
    sealedUntil = req.body.sealedUntil;
  }

  const created = await one(
    `INSERT INTO memories (couple_id, author_id, photo_data, thumb_data, note, memory_date, sealed_until)
     VALUES ($1, $2, $3, $4, $5, COALESCE($6::DATE, now()::DATE), $7)
     RETURNING id, author_id, thumb_data, note, memory_date::STRING AS memory_date, created_at,
       sealed_until::STRING AS sealed_until, (photo_data IS NOT NULL) AS has_photo`,
    [user.couple_id, user.id, photoData, thumbData, note, memoryDate, sealedUntil]
  );
  const memory = {
    ...created,
    author_name: user.display_name,
    hearts: 0,
    hearted_by_me: false,
    sealed: !!sealedUntil,
    opened: false,
  };
  await publish(user.couple_id, 'memory.created', { id: memory.id, author_id: user.id });
  await notify(
    user.couple_id,
    user.id,
    sealedUntil ? 'capsule' : 'memory',
    sealedUntil ? `${user.display_name} sealed a time capsule` : `${user.display_name} added a memory`
  );
  res.status(201).json({ memory });
});
