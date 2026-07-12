import { one } from '../_lib/db';
import { requirePairedUser } from '../_lib/auth';
import { route, HttpError } from '../_lib/respond';

/** PATCH { done } toggles an item; DELETE removes it. */
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

  const done = req.body?.done;
  if (typeof done !== 'boolean') throw new HttpError(400, 'done must be a boolean');
  const updated = await one(
    'UPDATE bucket_items SET done = $2 WHERE id = $1 RETURNING id, author_id, title, done, created_at',
    [id, done]
  );
  res.status(200).json({ item: updated });
});
