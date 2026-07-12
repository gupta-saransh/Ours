import { getPool } from '../_lib/db';
import { requireUser } from '../_lib/auth';
import { route } from '../_lib/respond';

/**
 * DELETE /api/auth/account — permanent.
 * Removes the user and everything they authored. If they were the last
 * member of the couple, the couple and all shared data go too.
 */
export default route(['DELETE'], async (req, res) => {
  const user = await requireUser(req);
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    if (user.couple_id) {
      await client.query('DELETE FROM memories WHERE couple_id = $1 AND author_id = $2', [user.couple_id, user.id]);
      await client.query('DELETE FROM love_notes WHERE couple_id = $1 AND author_id = $2', [user.couple_id, user.id]);
      await client.query('DELETE FROM milestones WHERE couple_id = $1 AND author_id = $2', [user.couple_id, user.id]);
    }
    await client.query('DELETE FROM users WHERE id = $1', [user.id]);
    if (user.couple_id) {
      const { rows } = await client.query('SELECT count(*)::int AS n FROM users WHERE couple_id = $1', [user.couple_id]);
      if (rows[0].n === 0) {
        await client.query('DELETE FROM memories WHERE couple_id = $1', [user.couple_id]);
        await client.query('DELETE FROM love_notes WHERE couple_id = $1', [user.couple_id]);
        await client.query('DELETE FROM milestones WHERE couple_id = $1', [user.couple_id]);
        await client.query('DELETE FROM couples WHERE id = $1', [user.couple_id]);
      }
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  res.status(200).json({ ok: true });
});
