import { one } from '../_lib/db';
import { requirePairedUser } from '../_lib/auth';
import { publish } from '../_lib/ably';
import { route, requireString, HttpError } from '../_lib/respond';

const CATEGORIES = ['experience', 'item'];
const RETURNING =
  "id, author_id, title, category, done, completed_at::STRING AS completed_at, created_at";

/**
 * PATCH { done } marks an item done (and stamps completed_at, so a finished item
 * stays on the list, dated) or un-does it; { title } renames it; { category }
 * re-tags it. DELETE removes it. Either partner may edit a shared list item.
 */
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
    await publish(user.couple_id, 'bucket.updated', { id, deleted: true });
    res.status(200).json({ ok: true });
    return;
  }

  const body = req.body ?? {};

  if (body.title !== undefined) {
    const title = requireString(body.title, 'Title', 200);
    const updated = await one(`UPDATE bucket_items SET title = $2 WHERE id = $1 RETURNING ${RETURNING}`, [id, title]);
    await publish(user.couple_id, 'bucket.updated', { id });
    res.status(200).json({ item: updated });
    return;
  }

  if (body.category !== undefined) {
    if (typeof body.category !== 'string' || !CATEGORIES.includes(body.category)) {
      throw new HttpError(400, 'Unknown category');
    }
    const updated = await one(`UPDATE bucket_items SET category = $2 WHERE id = $1 RETURNING ${RETURNING}`, [
      id,
      body.category,
    ]);
    await publish(user.couple_id, 'bucket.updated', { id });
    res.status(200).json({ item: updated });
    return;
  }

  const done = body.done;
  if (typeof done !== 'boolean') throw new HttpError(400, 'done must be a boolean');
  // Stamp the moment it was crossed off; clear it if it comes back to the list.
  const updated = await one(
    `UPDATE bucket_items SET done = $2, completed_at = CASE WHEN $2 THEN now() ELSE NULL END
     WHERE id = $1 RETURNING ${RETURNING}`,
    [id, done]
  );
  await publish(user.couple_id, 'bucket.updated', { id });
  res.status(200).json({ item: updated });
});
