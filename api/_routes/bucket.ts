import { one, q } from '../_lib/db';
import { requirePairedUser } from '../_lib/auth';
import { notify } from '../_lib/notify';
import { publish } from '../_lib/ably';
import { route, requireString, HttpError } from '../_lib/respond';

// experience = something to do together; item = something to get. The category
// lets the "Ours" segment of the Wishes tab read in two groups.
const CATEGORIES = ['experience', 'item'];
const RETURNING =
  "id, author_id, title, category, done, completed_at::STRING AS completed_at, created_at";

function readCategory(raw: unknown): string {
  if (raw === undefined || raw === null) return 'experience';
  if (typeof raw !== 'string' || !CATEGORIES.includes(raw)) throw new HttpError(400, 'Unknown category');
  return raw;
}

/** Shared "Ours" list: things you two want to do or get together. */
export default route(['GET', 'POST'], async (req, res) => {
  const user = await requirePairedUser(req);

  if (req.method === 'GET') {
    const items = await q(
      `SELECT ${RETURNING} FROM bucket_items
       WHERE couple_id = $1 ORDER BY done ASC, completed_at DESC, created_at DESC LIMIT 200`,
      [user.couple_id]
    );
    res.status(200).json({ items });
    return;
  }

  const title = requireString(req.body?.title, 'Title', 200);
  const category = readCategory(req.body?.category);
  const item = await one(
    `INSERT INTO bucket_items (couple_id, author_id, title, category)
     VALUES ($1, $2, $3, $4) RETURNING ${RETURNING}`,
    [user.couple_id, user.id, title, category]
  );
  await publish(user.couple_id, 'bucket.updated', { id: (item as { id: string }).id });
  await notify(user.couple_id, user.id, 'bucket', `${user.display_name} added "${title}" to your list`);
  res.status(201).json({ item });
});
