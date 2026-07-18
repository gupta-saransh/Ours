import { one } from '../_lib/db';
import { requirePairedUser } from '../_lib/auth';
import { publish } from '../_lib/ably';
import { encryptField } from '../_lib/envelope';
import { route, requireString, HttpError } from '../_lib/respond';

/**
 * PATCH /api/comments/:id { body }     edit your own comment
 * PATCH /api/comments/:id { hearted }  heart/unheart your PARTNER's comment
 * DELETE /api/comments/:id             delete your own comment
 *
 * Only the author can change their own comment; only the partner can heart it
 * (mirrors the note-hearts rule: you cannot heart your own words). couple_id is
 * always enforced.
 */
export default route(['PATCH', 'DELETE'], async (req, res) => {
  const user = await requirePairedUser(req);
  const id = String(req.query.id ?? '');

  const comment = await one<{ id: string; author_id: string; memory_id: string }>(
    'SELECT id, author_id, memory_id FROM memory_comments WHERE id = $1 AND couple_id = $2',
    [id, user.couple_id]
  );
  if (!comment) throw new HttpError(404, 'Comment not found');

  if (req.method === 'PATCH' && typeof req.body?.hearted === 'boolean') {
    if (comment.author_id === user.id) throw new HttpError(403, 'You cannot heart your own comment');
    if (req.body.hearted) {
      await one('INSERT INTO comment_hearts (comment_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [id, user.id]);
    } else {
      await one('DELETE FROM comment_hearts WHERE comment_id = $1 AND user_id = $2', [id, user.id]);
    }
    const row = await one<{ hearts: number }>(
      'SELECT count(*)::INT AS hearts FROM comment_hearts WHERE comment_id = $1',
      [id]
    );
    const hearts = row?.hearts ?? 0;
    await publish(user.couple_id, 'comment.hearted', {
      memory_id: comment.memory_id,
      id,
      by: user.id,
      hearts,
      hearted: req.body.hearted,
    });
    res.status(200).json({ id, hearts, hearted_by_me: req.body.hearted });
    return;
  }

  if (comment.author_id !== user.id) throw new HttpError(403, 'You can only change your own comments');

  if (req.method === 'DELETE') {
    await one('DELETE FROM memory_comments WHERE id = $1', [id]);
    await one('DELETE FROM comment_hearts WHERE comment_id = $1', [id]);
    await publish(user.couple_id, 'memory.commented', { memory_id: comment.memory_id, id, by: user.id, deleted: true });
    res.status(200).json({ ok: true });
    return;
  }

  const body = requireString(req.body?.body, 'Comment', 2000);
  const bodyCt = await encryptField(user.couple_id, body);
  const updated = await one<{ id: string; memory_id: string; author_id: string; created_at: string; edited_at: string }>(
    `UPDATE memory_comments SET body = $2, body_ct = $3, edited_at = now() WHERE id = $1
     RETURNING id, memory_id, author_id, created_at, edited_at`,
    [id, bodyCt ? '' : body, bodyCt]
  );
  const comment_out = { ...updated, body, author_name: user.display_name };
  await publish(user.couple_id, 'memory.commented', { memory_id: comment.memory_id, id, by: user.id });
  res.status(200).json({ comment: comment_out });
});
