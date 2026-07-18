import { one, q } from '../_lib/db';
import { requirePairedUser } from '../_lib/auth';
import { publish } from '../_lib/ably';
import { notify } from '../_lib/notify';
import { encryptField, readField } from '../_lib/envelope';
import { route, requireString, HttpError } from '../_lib/respond';

/**
 * Comments on a memory. Both members of the couple can read and write; the body
 * is encrypted at rest (envelope.ts). Realtime carries only ids (clients
 * refetch), never the comment body.
 *
 * GET  /api/comments?memoryId=  list a memory's comments (oldest first)
 * POST /api/comments { memoryId, body }  add a comment
 */
export default route(['GET', 'POST'], async (req, res) => {
  const user = await requirePairedUser(req);

  if (req.method === 'GET') {
    const memoryId = String(req.query.memoryId ?? '');
    if (!memoryId) throw new HttpError(400, 'memoryId is required');
    const owns = await one('SELECT id FROM memories WHERE id = $1 AND couple_id = $2', [memoryId, user.couple_id]);
    if (!owns) throw new HttpError(404, 'Memory not found');

    const rows = await q<Record<string, any>>(
      `SELECT c.id, c.memory_id, c.author_id, c.body, c.body_ct, c.created_at, c.edited_at,
              u.display_name AS author_name,
              (SELECT count(*) FROM comment_hearts h WHERE h.comment_id = c.id)::INT AS hearts,
              EXISTS (SELECT 1 FROM comment_hearts h WHERE h.comment_id = c.id AND h.user_id = $3) AS hearted_by_me
       FROM memory_comments c JOIN users u ON u.id = c.author_id
       WHERE c.memory_id = $1 AND c.couple_id = $2
       ORDER BY c.created_at ASC LIMIT 500`,
      [memoryId, user.couple_id, user.id]
    );
    const comments = await Promise.all(
      rows.map(async ({ body_ct, ...c }) => ({ ...c, body: (await readField(user.couple_id, body_ct, c.body)) ?? '' }))
    );
    res.status(200).json({ comments });
    return;
  }

  // POST
  const memoryId = requireString(req.body?.memoryId, 'memoryId', 64);
  const body = requireString(req.body?.body, 'Comment', 2000);
  const memory = await one('SELECT id FROM memories WHERE id = $1 AND couple_id = $2', [memoryId, user.couple_id]);
  if (!memory) throw new HttpError(404, 'Memory not found');

  const bodyCt = await encryptField(user.couple_id, body);
  const created = await one(
    `INSERT INTO memory_comments (memory_id, couple_id, author_id, body, body_ct)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, memory_id, author_id, created_at, edited_at`,
    [memoryId, user.couple_id, user.id, bodyCt ? '' : body, bodyCt]
  );
  const comment = { ...created, body, author_name: user.display_name, hearts: 0, hearted_by_me: false };
  // `created` lets list views bump their comment count without refetching
  // (edits publish the same event without it).
  await publish(user.couple_id, 'memory.commented', { memory_id: memoryId, id: comment.id, by: user.id, created: true });
  // Generic text: the comment body is encrypted and must not land in the
  // plaintext notifications table.
  await notify(user.couple_id, user.id, 'comment', `${user.display_name} commented on a memory`);
  res.status(201).json({ comment });
});
