import { one, q } from '../_lib/db';
import { requirePairedUser } from '../_lib/auth';
import { publish } from '../_lib/ably';
import { notify } from '../_lib/notify';
import { encryptField, readField } from '../_lib/envelope';
import { route, requireString, HttpError } from '../_lib/respond';

/**
 * Performance contract: the list NEVER carries full-resolution photos, only
 * small thumbnails (~15 KB). The full photo is fetched on demand from
 * GET /api/memories/:id when a card is opened.
 *
 * The note is encrypted at rest (envelope.ts): the row carries `note` (empty
 * when encrypted) and `note_ct` (ciphertext), resolved to plaintext in JS after
 * the query. Sealed partner rows still come back with the note stripped.
 */
const LIST_COLUMNS = `m.id, m.author_id,
  CASE WHEN m.sealed_until IS NOT NULL AND m.sealed_until > now()::DATE AND m.author_id != $2
       THEN NULL ELSE m.thumb_data END AS thumb_data,
  m.note, m.note_ct,
  m.sealed_until::STRING AS sealed_until,
  (m.sealed_until IS NOT NULL AND m.sealed_until > now()::DATE) AS sealed,
  (m.capsule_opened_at IS NOT NULL) AS opened,
  COALESCE(m.memory_date, m.created_at::DATE)::STRING AS memory_date, m.created_at,
  u.display_name AS author_name,
  (SELECT count(*)::int FROM memory_hearts h WHERE h.memory_id = m.id) AS hearts,
  EXISTS(SELECT 1 FROM memory_hearts h WHERE h.memory_id = m.id AND h.user_id = $2) AS hearted_by_me,
  (SELECT count(*)::int FROM memory_comments c WHERE c.memory_id = m.id) AS comments,
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
    const rows = await q<{
      note: string;
      note_ct: Buffer | null;
      sealed: boolean;
      author_id: string;
    }>(
      `SELECT ${LIST_COLUMNS} FROM memories m
       JOIN users u ON u.id = m.author_id
       WHERE m.couple_id = $1
       ORDER BY COALESCE(m.memory_date, m.created_at::DATE) DESC, m.created_at DESC
       LIMIT 400`,
      [user.couple_id, user.id]
    );
    const memories = await Promise.all(
      rows.map(async ({ note_ct, ...m }) => {
        const stripped = m.sealed && m.author_id !== user.id; // partner's sealed capsule
        const note = stripped ? '' : (await readField(user.couple_id, note_ct, m.note)) ?? '';
        return { ...m, note };
      })
    );
    res.status(200).json({ memories });
    return;
  }

  // A moment needs SOMETHING, but either half alone is a complete thought: a
  // photo with no caption is a memory, and words with no photo are one too
  // (the client sends wordless-and-undated entries to /api/notes instead, so
  // what arrives here without a photo is a deliberately backdated one).
  const photoData = req.body?.photoData ? validImage(req.body.photoData, 3_500_000) : null;
  const thumbData = req.body?.thumbData ? validImage(req.body.thumbData, 200_000) : null;
  const hasNote = typeof req.body?.note === 'string' && req.body.note.trim().length > 0;
  if (!hasNote && !photoData) throw new HttpError(400, 'Add a photo or a few words');
  const note = hasNote ? requireString(req.body.note, 'Note', 4000) : '';
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

  // Encrypt the note at rest; when encryption is on the plaintext column is
  // stored empty and the ciphertext lives in note_ct. A captionless photo has
  // nothing to encrypt, so both columns stay empty rather than storing the
  // ciphertext of an empty string.
  const noteCt = note ? await encryptField(user.couple_id, note) : null;
  const created = await one(
    `INSERT INTO memories (couple_id, author_id, photo_data, thumb_data, note, note_ct, memory_date, sealed_until)
     VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7::DATE, now()::DATE), $8)
     RETURNING id, author_id, thumb_data, memory_date::STRING AS memory_date, created_at,
       sealed_until::STRING AS sealed_until, (photo_data IS NOT NULL) AS has_photo`,
    [user.couple_id, user.id, photoData, thumbData, noteCt ? '' : note, noteCt, memoryDate, sealedUntil]
  );
  const memory = {
    ...created,
    note, // echo the plaintext back to the author's client
    author_name: user.display_name,
    hearts: 0,
    hearted_by_me: false,
    comments: 0,
    sealed: !!sealedUntil,
    opened: false,
  };
  await publish(user.couple_id, 'memory.created', { id: memory.id, author_id: user.id });
  await notify(
    user.couple_id,
    user.id,
    sealedUntil ? 'capsule' : 'memory',
    sealedUntil
      ? `${user.display_name} sealed a time capsule`
      : photoData
        ? `${user.display_name} added a photo`
        : `${user.display_name} added a memory`
  );
  res.status(201).json({ memory });
});
