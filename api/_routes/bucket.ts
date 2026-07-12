import { one, q } from '../_lib/db';
import { requirePairedUser } from '../_lib/auth';
import { notify } from '../_lib/notify';
import { route, requireString } from '../_lib/respond';

/** Shared bucket list: things you two want to do together. */
export default route(['GET', 'POST'], async (req, res) => {
  const user = await requirePairedUser(req);

  if (req.method === 'GET') {
    const items = await q(
      `SELECT id, author_id, title, done, created_at FROM bucket_items
       WHERE couple_id = $1 ORDER BY done ASC, created_at DESC LIMIT 200`,
      [user.couple_id]
    );
    res.status(200).json({ items });
    return;
  }

  const title = requireString(req.body?.title, 'Title', 200);
  const item = await one(
    `INSERT INTO bucket_items (couple_id, author_id, title)
     VALUES ($1, $2, $3) RETURNING id, author_id, title, done, created_at`,
    [user.couple_id, user.id, title]
  );
  await notify(user.couple_id, user.id, 'bucket', `${user.display_name} added "${title}" to your list`);
  res.status(201).json({ item });
});
