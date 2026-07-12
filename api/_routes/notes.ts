import { one, q } from '../_lib/db';
import { requirePairedUser } from '../_lib/auth';
import { publish } from '../_lib/ably';
import { notify } from '../_lib/notify';
import { route, requireString } from '../_lib/respond';

const NOTE_COLUMNS = `n.id, n.author_id, n.body, n.pinned, n.created_at,
  u.display_name AS author_name`;

export default route(['GET', 'POST'], async (req, res) => {
  const user = await requirePairedUser(req);

  if (req.method === 'GET') {
    const notes = await q(
      `SELECT ${NOTE_COLUMNS} FROM love_notes n
       JOIN users u ON u.id = n.author_id
       WHERE n.couple_id = $1 ORDER BY n.pinned DESC, n.created_at DESC LIMIT 200`,
      [user.couple_id]
    );
    res.status(200).json({ notes });
    return;
  }

  const body = requireString(req.body?.body, 'Note', 2000);
  const created = await one(
    `INSERT INTO love_notes (couple_id, author_id, body)
     VALUES ($1, $2, $3) RETURNING id, author_id, body, pinned, created_at`,
    [user.couple_id, user.id, body]
  );
  const note = { ...created, author_name: user.display_name };
  await publish(user.couple_id, 'note.created', note);
  await notify(user.couple_id, user.id, 'note', `${user.display_name} left you a note`);
  res.status(201).json({ note });
});
