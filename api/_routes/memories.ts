import { one, q } from '../_lib/db';
import { requirePairedUser } from '../_lib/auth';
import { publish } from '../_lib/ably';
import { route, requireString, HttpError } from '../_lib/respond';

const MEMORY_COLUMNS = `m.id, m.author_id, m.photo_data, m.note, m.created_at,
  u.display_name AS author_name`;

export default route(['GET', 'POST'], async (req, res) => {
  const user = await requirePairedUser(req);

  if (req.method === 'GET') {
    const memories = await q(
      `SELECT ${MEMORY_COLUMNS} FROM memories m
       JOIN users u ON u.id = m.author_id
       WHERE m.couple_id = $1 ORDER BY m.created_at DESC LIMIT 200`,
      [user.couple_id]
    );
    res.status(200).json({ memories });
    return;
  }

  const note = requireString(req.body?.note, 'Note', 4000);
  let photoData: string | null = null;
  if (req.body?.photoData) {
    if (typeof req.body.photoData !== 'string' || !req.body.photoData.startsWith('data:image/')) {
      throw new HttpError(400, 'Photo must be an image');
    }
    if (req.body.photoData.length > 3_500_000) throw new HttpError(413, 'Photo is too large');
    photoData = req.body.photoData;
  }

  const created = await one(
    `INSERT INTO memories (couple_id, author_id, photo_data, note)
     VALUES ($1, $2, $3, $4) RETURNING id, author_id, photo_data, note, created_at`,
    [user.couple_id, user.id, photoData, note]
  );
  const memory = { ...created, author_name: user.display_name };
  await publish(user.couple_id, 'memory.created', { ...memory, photo_data: undefined, has_photo: !!photoData });
  res.status(201).json({ memory });
});
