import { one } from '../_lib/db';
import { requirePairedUser } from '../_lib/auth';
import { publish } from '../_lib/ably';
import { route, HttpError } from '../_lib/respond';

/** PATCH { pinned } toggles a pin; DELETE removes your own note. */
export default route(['PATCH', 'DELETE'], async (req, res) => {
  const user = await requirePairedUser(req);
  const id = String(req.query.id ?? '');

  const note = await one<{ id: string; author_id: string; pinned: boolean }>(
    'SELECT id, author_id, pinned FROM love_notes WHERE id = $1 AND couple_id = $2',
    [id, user.couple_id]
  );
  if (!note) throw new HttpError(404, 'Note not found');

  if (req.method === 'DELETE') {
    if (note.author_id !== user.id) throw new HttpError(403, 'You can only remove your own notes');
    await one('DELETE FROM love_notes WHERE id = $1', [id]);
    await publish(user.couple_id, 'note.deleted', { id });
    res.status(200).json({ ok: true });
    return;
  }

  const pinned = req.body?.pinned;
  if (typeof pinned !== 'boolean') throw new HttpError(400, 'pinned must be a boolean');
  const updated = await one(
    `UPDATE love_notes SET pinned = $2 WHERE id = $1 RETURNING id, author_id, body, pinned, created_at`,
    [id, pinned]
  );
  await publish(user.couple_id, 'note.pinned', updated);
  res.status(200).json({ note: updated });
});
