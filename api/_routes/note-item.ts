import { one } from '../_lib/db';
import { requirePairedUser } from '../_lib/auth';
import { publish } from '../_lib/ably';
import { notify } from '../_lib/notify';
import { readField } from '../_lib/envelope';
import { route, HttpError } from '../_lib/respond';

/**
 * PATCH { pinned } toggles a pin.
 * PATCH { hearted } sets/clears the caller's heart (per-user, JWT user only).
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
    await one('DELETE FROM note_hearts WHERE note_id = $1', [id]);
    await one('DELETE FROM love_notes WHERE id = $1', [id]);
    await publish(user.couple_id, 'note.deleted', { id });
    res.status(200).json({ ok: true });
    return;
  }

  // Heart toggle. The heart always belongs to the JWT user; a user id in the
  // body is ignored, mirroring the memory hearts rule.
  if (typeof req.body?.hearted === 'boolean') {
    if (req.body.hearted) {
      await one(
        `INSERT INTO note_hearts (note_id, user_id) VALUES ($1, $2)
         ON CONFLICT (note_id, user_id) DO NOTHING`,
        [id, user.id]
      );
    } else {
      await one('DELETE FROM note_hearts WHERE note_id = $1 AND user_id = $2', [id, user.id]);
    }
    const counts = await one<{ hearts: number; hearted_by_me: boolean }>(
      `SELECT (SELECT count(*)::int FROM note_hearts WHERE note_id = $1) AS hearts,
              EXISTS(SELECT 1 FROM note_hearts WHERE note_id = $1 AND user_id = $2) AS hearted_by_me`,
      [id, user.id]
    );
    await publish(user.couple_id, 'note.hearted', { id, hearts: counts?.hearts ?? 0, by: user.id });
    if (req.body.hearted && note.author_id !== user.id) {
      // Generic text: the note body is encrypted and must not land in the
      // plaintext notifications table.
      await notify(user.couple_id, user.id, 'note', `${user.display_name} loved your note ♥`);
    }
    res.status(200).json({ hearts: counts?.hearts ?? 0, hearted_by_me: counts?.hearted_by_me ?? false });
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
    const full = await one<{
      id: string;
      author_id: string;
      body: string;
      body_ct: Buffer | null;
      pinned: boolean;
      created_at: string;
      sealed_until: string | null;
    }>(
      `SELECT id, author_id, body, body_ct, pinned, created_at, sealed_until::STRING AS sealed_until FROM love_notes WHERE id = $1`,
      [id]
    );
    const { body_ct: openCt, ...rest } = full ?? ({} as NonNullable<typeof full>);
    const body = (await readField(user.couple_id, openCt, rest.body ?? '')) ?? '';
    res.status(200).json({ note: { ...rest, body } });
    return;
  }

  const pinned = req.body?.pinned;
  if (typeof pinned !== 'boolean') throw new HttpError(400, 'pinned must be a boolean');
  const updated = await one<{
    id: string;
    author_id: string;
    body: string;
    body_ct: Buffer | null;
    pinned: boolean;
    created_at: string;
  }>(
    `UPDATE love_notes SET pinned = $2 WHERE id = $1 RETURNING id, author_id, body, body_ct, pinned, created_at`,
    [id, pinned]
  );
  const { body_ct: pinCt, ...pinRest } = updated ?? ({} as NonNullable<typeof updated>);
  const pinnedNote = { ...pinRest, body: (await readField(user.couple_id, pinCt, pinRest.body ?? '')) ?? '' };
  await publish(user.couple_id, 'note.pinned', pinnedNote);
  res.status(200).json({ note: pinnedNote });
});
