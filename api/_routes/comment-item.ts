import { one } from '../_lib/db';
import { requirePairedUser } from '../_lib/auth';
import { publish } from '../_lib/ably';
import { encryptField } from '../_lib/envelope';
import { route, requireString, HttpError } from '../_lib/respond';

/**
 * PATCH /api/comments/:id { body }  edit your own comment
 * DELETE /api/comments/:id          delete your own comment
 *
 * Only the author can change their own comment; neither partner can touch the
 * other's (mirrors the per-user hearts rule). couple_id is always enforced.
 */
export default route(['PATCH', 'DELETE'], async (req, res) => {
  const user = await requirePairedUser(req);
  const id = String(req.query.id ?? '');

  const comment = await one<{ id: string; author_id: string; memory_id: string }>(
    'SELECT id, author_id, memory_id FROM memory_comments WHERE id = $1 AND couple_id = $2',
    [id, user.couple_id]
  );
  if (!comment) throw new HttpError(404, 'Comment not found');
  if (comment.author_id !== user.id) throw new HttpError(403, 'You can only change your own comments');

  if (req.method === 'DELETE') {
    await one('DELETE FROM memory_comments WHERE id = $1', [id]);
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
