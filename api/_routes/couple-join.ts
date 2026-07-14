import { getPool, one } from '../_lib/db';
import { requireUser } from '../_lib/auth';
import { publish } from '../_lib/ably';
import { notify } from '../_lib/notify';
import { encryptionEnabled, getDek, recryptBlob } from '../_lib/envelope';
import { route, requireString, HttpError } from '../_lib/respond';

// Encrypted columns that move with their author when spaces merge. Their
// ciphertext must be re-wrapped from the old couple's DEK to the new one, or it
// becomes unreadable under the target couple's key.
const MIGRATED_CT: { table: string; column: string }[] = [
  { table: 'memories', column: 'note_ct' },
  { table: 'love_notes', column: 'body_ct' },
];

/**
 * Join a partner's space by invite code. Everyone gets a solo space at
 * signup, so joining migrates everything you authored into the shared space
 * and deletes your old one. Nothing is lost.
 */
export default route(['POST'], async (req, res) => {
  const user = await requireUser(req);
  const code = requireString(req.body?.code, 'Invite code', 12).toUpperCase().replace(/\s/g, '');

  const target = await one<{ id: string; invite_code: string }>(
    'SELECT id, invite_code FROM couples WHERE invite_code = $1',
    [code]
  );
  if (!target) throw new HttpError(404, 'That code does not match any space');
  if (target.id === user.couple_id) throw new HttpError(409, 'That is your own invite code');

  if (user.couple_id) {
    const myPartner = await one('SELECT id FROM users WHERE couple_id = $1 AND id != $2', [
      user.couple_id,
      user.id,
    ]);
    if (myPartner) throw new HttpError(409, 'You are already linked with your partner');
  }

  const members = await one<{ n: number }>('SELECT count(*)::int AS n FROM users WHERE couple_id = $1', [
    target.id,
  ]);
  if ((members?.n ?? 0) >= 2) throw new HttpError(409, 'That space already has two people in it');

  // Re-wrap encrypted fields from the joining user's DEK to the target's, while
  // both couples (and both DEKs) still exist. Done inside the transaction so it
  // rolls back cleanly with the rest of the merge.
  const fromDek = user.couple_id && encryptionEnabled() ? await getDek(user.couple_id) : null;
  const toDek = fromDek ? await getDek(target.id) : null;

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    if (fromDek && toDek && user.couple_id) {
      for (const { table, column } of MIGRATED_CT) {
        const { rows } = await client.query(
          `SELECT id, ${column} AS ct FROM ${table} WHERE author_id = $1 AND couple_id = $2 AND ${column} IS NOT NULL`,
          [user.id, user.couple_id]
        );
        for (const r of rows as { id: string; ct: Buffer }[]) {
          try {
            await client.query(`UPDATE ${table} SET ${column} = $2 WHERE id = $1`, [r.id, recryptBlob(fromDek, toDek, r.ct)]);
          } catch {
            // Leave undecryptable rows untouched rather than fail the whole join.
          }
        }
      }
    }
    for (const table of ['memories', 'love_notes', 'milestones', 'bucket_items']) {
      await client.query(`UPDATE ${table} SET couple_id = $1 WHERE author_id = $2`, [target.id, user.id]);
    }
    await client.query('UPDATE notifications SET couple_id = $1 WHERE actor_id = $2', [target.id, user.id]);
    await client.query('UPDATE users SET couple_id = $2 WHERE id = $1', [user.id, target.id]);
    if (user.couple_id) {
      await client.query('DELETE FROM couples WHERE id = $1', [user.couple_id]);
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  await publish(target.id, 'partner.joined', { name: user.display_name });
  await notify(target.id, user.id, 'partner', `${user.display_name} joined your space`);
  res.status(200).json({ couple: target });
});
