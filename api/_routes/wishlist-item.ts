import { one } from '../_lib/db';
import { requirePairedUser } from '../_lib/auth';
import { publish } from '../_lib/ably';
import { route, requireString, HttpError } from '../_lib/respond';

const ITEM_COLUMNS = 'id, owner_id, added_by, title, url, notes, category, secret, gotten, gotten_by, created_at';

/**
 * PATCH: owner edits their own non-secret rows; the partner can toggle
 * `gotten` on the owner's visible items and edit their own secret rows.
 * DELETE: only the person who added the row.
 */
export default route(['PATCH', 'DELETE'], async (req, res) => {
  const user = await requirePairedUser(req);
  const id = String(req.query.id ?? '');

  const item = await one<{
    id: string;
    owner_id: string;
    added_by: string;
    secret: boolean;
    gotten: boolean;
  }>(`SELECT id, owner_id, added_by, secret, gotten FROM wishlist_items WHERE id = $1 AND couple_id = $2`, [
    id,
    user.couple_id,
  ]);
  if (!item) throw new HttpError(404, 'Item not found');
  // Never let the owner interact with a secret gift plan meant for them.
  if (item.secret && item.added_by !== user.id) throw new HttpError(404, 'Item not found');

  if (req.method === 'DELETE') {
    if (item.added_by !== user.id) throw new HttpError(403, 'Only whoever added this can remove it');
    await one('DELETE FROM wishlist_items WHERE id = $1', [id]);
    await publish(user.couple_id, 'wishlist.updated', { id, deleted: true });
    res.status(200).json({ ok: true });
    return;
  }

  const isOwner = item.owner_id === user.id;
  const body = req.body ?? {};

  if (body.gotten !== undefined) {
    if (isOwner) throw new HttpError(403, 'Your partner marks things as gotten, not you');
    if (typeof body.gotten !== 'boolean') throw new HttpError(400, 'gotten must be a boolean');
    await one('UPDATE wishlist_items SET gotten = $2, gotten_by = $3 WHERE id = $1', [
      id,
      body.gotten,
      body.gotten ? user.id : null,
    ]);
  }

  const canEditText = (isOwner && !item.secret) || (!isOwner && item.secret && item.added_by === user.id);
  if (body.title !== undefined || body.url !== undefined || body.notes !== undefined) {
    if (!canEditText) throw new HttpError(403, 'You cannot edit this item');
    if (body.title !== undefined) {
      await one('UPDATE wishlist_items SET title = $2 WHERE id = $1', [id, requireString(body.title, 'Title', 200)]);
    }
    if (body.url !== undefined) {
      await one('UPDATE wishlist_items SET url = $2 WHERE id = $1', [
        id,
        body.url ? requireString(body.url, 'Link', 500) : null,
      ]);
    }
    if (body.notes !== undefined) {
      await one('UPDATE wishlist_items SET notes = $2 WHERE id = $1', [
        id,
        body.notes ? requireString(body.notes, 'Notes', 500) : null,
      ]);
    }
  }

  const updated = await one(`SELECT ${ITEM_COLUMNS} FROM wishlist_items WHERE id = $1`, [id]);
  await publish(user.couple_id, 'wishlist.updated', { id });
  res.status(200).json({ item: updated });
});
