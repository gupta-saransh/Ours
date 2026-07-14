import { one } from '../_lib/db';
import { requirePairedUser } from '../_lib/auth';
import { publish } from '../_lib/ably';
import { notify } from '../_lib/notify';
import { readField } from '../_lib/envelope';
import { route, HttpError } from '../_lib/respond';

/**
 * GET    /api/memories/:id  full-resolution photo (fetched on demand); also
 *                           records the first open of a time capsule and
 *                           refuses partner access while it is still sealed
 * PATCH  /api/memories/:id  { hearted } toggle a ♥ on the memory
 * DELETE /api/memories/:id  remove your own memory
 */
export default route(['GET', 'PATCH', 'DELETE'], async (req, res) => {
  const user = await requirePairedUser(req);
  const id = String(req.query.id ?? '');

  const memory = await one<{
    id: string;
    author_id: string;
    sealed_until: string | null;
    capsule_opened_at: string | null;
  }>(
    `SELECT id, author_id, sealed_until::STRING AS sealed_until, capsule_opened_at
     FROM memories WHERE id = $1 AND couple_id = $2`,
    [id, user.couple_id]
  );
  if (!memory) throw new HttpError(404, 'Memory not found');

  const today = new Date().toISOString().slice(0, 10);
  const stillSealed = !!memory.sealed_until && memory.sealed_until > today;

  if (req.method === 'GET') {
    if (stillSealed && memory.author_id !== user.id) {
      res.status(403).json({ sealed: true, reveal_date: memory.sealed_until });
      return;
    }
    if (memory.sealed_until && !stillSealed && !memory.capsule_opened_at && memory.author_id !== user.id) {
      await one('UPDATE memories SET capsule_opened_at = now() WHERE id = $1', [id]);
      await publish(user.couple_id, 'capsule.opened', { id, kind: 'memory', by: user.id });
      await notify(user.couple_id, user.id, 'capsule', `${user.display_name} opened your time capsule`);
    }
    const row = await one<{ photo_data: string | null; note: string; note_ct: Buffer | null }>(
      'SELECT photo_data, note, note_ct FROM memories WHERE id = $1',
      [id]
    );
    const note = (await readField(user.couple_id, row?.note_ct, row?.note ?? '')) ?? '';
    res.status(200).json({ photo_data: row?.photo_data ?? null, note });
    return;
  }

  if (req.method === 'DELETE') {
    // Either partner may delete any memory in their shared space; couple_id is
    // already enforced by the SELECT above (Anisha confirmed this is intended).
    await one('DELETE FROM memory_hearts WHERE memory_id = $1', [id]);
    await one('DELETE FROM memories WHERE id = $1', [id]);
    await publish(user.couple_id, 'memory.deleted', { id });
    res.status(200).json({ ok: true });
    return;
  }

  // Hearting a partner's capsule stays blocked until it is unsealed.
  if (stillSealed && memory.author_id !== user.id) throw new HttpError(403, 'Still sealed');

  const hearted = req.body?.hearted;
  if (typeof hearted !== 'boolean') throw new HttpError(400, 'hearted must be a boolean');
  if (hearted) {
    await one(
      'INSERT INTO memory_hearts (memory_id, user_id) VALUES ($1, $2) ON CONFLICT (memory_id, user_id) DO NOTHING',
      [id, user.id]
    );
  } else {
    await one('DELETE FROM memory_hearts WHERE memory_id = $1 AND user_id = $2', [id, user.id]);
  }
  const count = await one<{ n: number }>(
    'SELECT count(*)::int AS n FROM memory_hearts WHERE memory_id = $1',
    [id]
  );
  await publish(user.couple_id, 'memory.hearted', { id, hearts: count?.n ?? 0, by: user.id });
  res.status(200).json({ hearts: count?.n ?? 0, hearted_by_me: hearted });
});
