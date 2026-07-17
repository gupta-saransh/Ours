import { one, q } from '../_lib/db';
import { requirePairedUser } from '../_lib/auth';
import { publish } from '../_lib/ably';
import { notify } from '../_lib/notify';
import { encryptField, readField } from '../_lib/envelope';
import { route, requireString, HttpError } from '../_lib/respond';

// title/url/notes are encrypted at rest (envelope.ts): each has a _ct column,
// resolved to plaintext in JS after the query.
const ITEM_COLUMNS =
  'id, owner_id, added_by, title, title_ct, url, url_ct, notes, notes_ct, category, secret, gotten, gotten_by, created_at';

const CATEGORIES = ['experience', 'item'];

async function decodeItem(coupleId: string, row: Record<string, any>) {
  const { title_ct, url_ct, notes_ct, ...rest } = row;
  return {
    ...rest,
    title: (await readField(coupleId, title_ct, rest.title)) ?? '',
    url: (await readField(coupleId, url_ct, rest.url)) ?? rest.url ?? null,
    notes: (await readField(coupleId, notes_ct, rest.notes)) ?? rest.notes ?? null,
  };
}

/**
 * Each partner keeps their own wishlist; the other sees it read-only.
 * `secret` rows are gift plans added to your PARTNER's list: hidden from the
 * owner forever, visible only to the person who added them. The filtering is
 * server-side and must never move to the client.
 */
export default route(['GET', 'POST'], async (req, res) => {
  const user = await requirePairedUser(req);

  if (req.method === 'GET') {
    const [mineRows, theirsRows] = await Promise.all([
      // My list, minus any secret gift plans my partner added for me.
      q<Record<string, any>>(
        `SELECT ${ITEM_COLUMNS} FROM wishlist_items
         WHERE couple_id = $1 AND owner_id = $2 AND secret = false
         ORDER BY gotten ASC, created_at DESC LIMIT 200`,
        [user.couple_id, user.id]
      ),
      // Partner's list, plus my own secret plans on it.
      q<Record<string, any>>(
        `SELECT ${ITEM_COLUMNS} FROM wishlist_items
         WHERE couple_id = $1 AND owner_id != $2 AND (secret = false OR added_by = $2)
         ORDER BY gotten ASC, created_at DESC LIMIT 200`,
        [user.couple_id, user.id]
      ),
    ]);
    const [mine, theirs] = await Promise.all([
      Promise.all(mineRows.map((r) => decodeItem(user.couple_id, r))),
      Promise.all(theirsRows.map((r) => decodeItem(user.couple_id, r))),
    ]);
    res.status(200).json({ mine, theirs });
    return;
  }

  const title = requireString(req.body?.title, 'Title', 200);
  const url = req.body?.url ? requireString(req.body.url, 'Link', 500) : null;
  const notes = req.body?.notes ? requireString(req.body.notes, 'Notes', 500) : null;
  const ownerId = typeof req.body?.ownerId === 'string' ? req.body.ownerId : user.id;
  const secret = req.body?.secret === true;
  const category =
    req.body?.category === undefined || req.body?.category === null
      ? 'item'
      : typeof req.body.category === 'string' && CATEGORIES.includes(req.body.category)
        ? req.body.category
        : (() => {
            throw new HttpError(400, 'Unknown category');
          })();

  const owner = await one<{ id: string }>('SELECT id FROM users WHERE id = $1 AND couple_id = $2', [
    ownerId,
    user.couple_id,
  ]);
  if (!owner) throw new HttpError(400, 'Owner must be in your space');
  if (secret && ownerId === user.id) throw new HttpError(400, 'You cannot keep secrets from yourself here');

  const titleCt = await encryptField(user.couple_id, title);
  const urlCt = url ? await encryptField(user.couple_id, url) : null;
  const notesCt = notes ? await encryptField(user.couple_id, notes) : null;
  const created = await one(
    `INSERT INTO wishlist_items (couple_id, owner_id, added_by, title, title_ct, url, url_ct, notes, notes_ct, category, secret)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING id, owner_id, added_by, category, secret, gotten, gotten_by, created_at`,
    [
      user.couple_id,
      ownerId,
      user.id,
      titleCt ? '' : title,
      titleCt,
      urlCt ? null : url,
      urlCt,
      notesCt ? null : notes,
      notesCt,
      category,
      secret,
    ]
  );
  const item = { ...created, title, url, notes };
  await publish(user.couple_id, 'wishlist.updated', { id: item.id, secret });
  if (!secret && ownerId === user.id) {
    // Keep the encrypted title out of the plaintext notifications table.
    await notify(user.couple_id, user.id, 'wishlist', `${user.display_name} added something to their wishlist`);
  }
  res.status(201).json({ item });
});
