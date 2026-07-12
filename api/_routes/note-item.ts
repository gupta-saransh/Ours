import { one } from '../_lib/db';
import { requirePairedUser } from '../_lib/auth';
import { publish } from '../_lib/ably';
import { notify } from '../_lib/notify';
import { route, HttpError } from '../_lib/respond';

/**
 * PATCH { pinned } toggles a pin.
 * PATCH { open: true } opens a time capsule note on or after its reveal date
 * (records the first open, tells the author).
 * DELETE removes your own note.
 */
export default route(['PATCH', 'DELETE'], async (req, res) => {
  const user = await requirePairedUser(req);
  const id = String(req.query.id ?? '');

  const note = await one<{
    id: string;
    author_id: string;
    pinned: boolean;
    sealed_until: string | null;
    capsule_opened_at: string | null;
  }>(
    `SELECT id, author_id, pinned, sealed_until::STRING AS sealed_until, capsule_opened_at
     FROM love_notes WHERE id = $1 AND couple_id = $2`,
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

  if (req.body?.open === true) {
    if (!note.sealed_until) throw new HttpError(400, 'This note is not a capsule');
    if (note.sealed_until > new Date().toISOString().slice(0, 10)) {
      throw new HttpError(403, 'Still sealed');
    }
    if (!note.capsule_opened_at && note.author_id !== user.id) {
      await one('UPDATE love_notes SET capsule_opened_at = now() WHERE id = $1', [id]);
      await publish(user.couple_id, 'capsule.opened', { id, kind: 'note', by: user.id });
      await notify(user.couple_id, user.id, 'capsule', `${user.display_name} opened your time capsule`);
    }
    const full = await one(
      `SELECT id, author_id, body, pinned, created_at, sealed_until::STRING AS sealed_until FROM love_notes WHERE id = $1`,
      [id]
    );
    res.status(200).json({ note: full });
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
