import { one } from '../_lib/db';
import { requirePairedUser } from '../_lib/auth';
import { route, requireString, HttpError } from '../_lib/respond';

const RETURNING = 'id, author_id, title, done, created_at';

/** PATCH { done } toggles an item, or { title } renames it; DELETE removes it. */
export default route(['PATCH', 'DELETE'], async (req, res) => {
  const user = await requirePairedUser(req);
  const id = String(req.query.id ?? '');

  const item = await one<{ id: string }>(
    'SELECT id FROM bucket_items WHERE id = $1 AND couple_id = $2',
    [id, user.couple_id]
  );
  if (!item) throw new HttpError(404, 'Item not found');

  if (req.method === 'DELETE') {
    await one('DELETE FROM bucket_items WHERE id = $1', [id]);
    res.status(200).json({ ok: true });
    return;
  }

  // Rename (either partner may edit a shared list item).
  if (req.body?.title !== undefined) {
    const title = requireString(req.body.title, 'Title', 200);
    const updated = await one(`UPDATE bucket_items SET title = $2 WHERE id = $1 RETURNING ${RETURNING}`, [id, title]);
    res.status(200).json({ item: updated });
    return;
  }

  const done = req.body?.done;
  if (typeof done !== 'boolean') throw new HttpError(400, 'done must be a boolean');
  const updated = await one(`UPDATE bucket_items SET done = $2 WHERE id = $1 RETURNING ${RETURNING}`, [id, done]);
  res.status(200).json({ item: updated });
});
