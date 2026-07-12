import { one } from '../_lib/db';
import { requirePairedUser } from '../_lib/auth';
import { publish } from '../_lib/ably';
import { route, HttpError } from '../_lib/respond';

/**
 * GET    /api/memories/:id  full-resolution photo (fetched on demand)
 * PATCH  /api/memories/:id  { hearted } toggle a ♥ on the memory
 * DELETE /api/memories/:id  remove your own memory
 */
export default route(['GET', 'PATCH', 'DELETE'], async (req, res) => {
  const user = await requirePairedUser(req);
  const id = String(req.query.id ?? '');

  const memory = await one<{ id: string; author_id: string }>(
    'SELECT id, author_id FROM memories WHERE id = $1 AND couple_id = $2',
    [id, user.couple_id]
  );
  if (!memory) throw new HttpError(404, 'Memory not found');

  if (req.method === 'GET') {
    const row = await one<{ photo_data: string | null }>(
      'SELECT photo_data FROM memories WHERE id = $1',
      [id]
    );
    res.status(200).json({ photo_data: row?.photo_data ?? null });
    return;
  }

  if (req.method === 'DELETE') {
    if (memory.author_id !== user.id) throw new HttpError(403, 'You can only remove your own memories');
    await one('DELETE FROM memory_hearts WHERE memory_id = $1', [id]);
    await one('DELETE FROM memories WHERE id = $1', [id]);
    await publish(user.couple_id, 'memory.deleted', { id });
    res.status(200).json({ ok: true });
    return;
  }

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
