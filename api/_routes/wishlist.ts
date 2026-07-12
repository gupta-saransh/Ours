import { one, q } from '../_lib/db';
import { requirePairedUser } from '../_lib/auth';
import { publish } from '../_lib/ably';
import { notify } from '../_lib/notify';
import { route, requireString, HttpError } from '../_lib/respond';

const ITEM_COLUMNS = 'id, owner_id, added_by, title, url, notes, secret, gotten, gotten_by, created_at';

/**
 * Each partner keeps their own wishlist; the other sees it read-only.
 * `secret` rows are gift plans added to your PARTNER's list: hidden from the
 * owner forever, visible only to the person who added them. The filtering is
 * server-side and must never move to the client.
 */
export default route(['GET', 'POST'], async (req, res) => {
  const user = await requirePairedUser(req);

  if (req.method === 'GET') {
    const [mine, theirs] = await Promise.all([
      // My list, minus any secret gift plans my partner added for me.
      q(
        `SELECT ${ITEM_COLUMNS} FROM wishlist_items
         WHERE couple_id = $1 AND owner_id = $2 AND secret = false
         ORDER BY gotten ASC, created_at DESC LIMIT 200`,
        [user.couple_id, user.id]
      ),
      // Partner's list, plus my own secret plans on it.
      q(
        `SELECT ${ITEM_COLUMNS} FROM wishlist_items
         WHERE couple_id = $1 AND owner_id != $2 AND (secret = false OR added_by = $2)
         ORDER BY gotten ASC, created_at DESC LIMIT 200`,
        [user.couple_id, user.id]
      ),
    ]);
    res.status(200).json({ mine, theirs });
    return;
  }

  const title = requireString(req.body?.title, 'Title', 200);
  const url = req.body?.url ? requireString(req.body.url, 'Link', 500) : null;
  const notes = req.body?.notes ? requireString(req.body.notes, 'Notes', 500) : null;
  const ownerId = typeof req.body?.ownerId === 'string' ? req.body.ownerId : user.id;
  const secret = req.body?.secret === true;

  const owner = await one<{ id: string }>('SELECT id FROM users WHERE id = $1 AND couple_id = $2', [
    ownerId,
    user.couple_id,
  ]);
  if (!owner) throw new HttpError(400, 'Owner must be in your space');
  if (secret && ownerId === user.id) throw new HttpError(400, 'You cannot keep secrets from yourself here');

  const item = await one(
    `INSERT INTO wishlist_items (couple_id, owner_id, added_by, title, url, notes, secret)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING ${ITEM_COLUMNS}`,
    [user.couple_id, ownerId, user.id, title, url, notes, secret]
  );
  await publish(user.couple_id, 'wishlist.updated', { id: item.id, secret });
  if (!secret && ownerId === user.id) {
    await notify(user.couple_id, user.id, 'wishlist', `${user.display_name} added "${title}" to their wishlist`);
  }
  res.status(201).json({ item });
});
