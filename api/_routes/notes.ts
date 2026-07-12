import { one, q } from '../_lib/db';
import { requirePairedUser } from '../_lib/auth';
import { publish } from '../_lib/ably';
import { notify } from '../_lib/notify';
import { route, requireString, HttpError } from '../_lib/respond';

/**
 * Love notes, optionally sealed as time capsules. Sealed rows authored by
 * your partner come back with the body stripped until the reveal date; the
 * stripping is server-side and must stay that way.
 */
const NOTE_COLUMNS = `n.id, n.author_id, n.pinned, n.created_at,
  CASE WHEN n.sealed_until IS NOT NULL AND n.sealed_until > now()::DATE AND n.author_id != $2
       THEN '' ELSE n.body END AS body,
  n.sealed_until::STRING AS sealed_until,
  (n.sealed_until IS NOT NULL AND n.sealed_until > now()::DATE) AS sealed,
  (n.capsule_opened_at IS NOT NULL) AS opened,
  u.display_name AS author_name`;

export default route(['GET', 'POST'], async (req, res) => {
  const user = await requirePairedUser(req);

  if (req.method === 'GET') {
    const notes = await q(
      `SELECT ${NOTE_COLUMNS} FROM love_notes n
       JOIN users u ON u.id = n.author_id
       WHERE n.couple_id = $1 ORDER BY n.pinned DESC, n.created_at DESC LIMIT 200`,
      [user.couple_id, user.id]
    );
    res.status(200).json({ notes });
    return;
  }

  const body = requireString(req.body?.body, 'Note', 2000);
  let sealedUntil: string | null = null;
  if (req.body?.sealedUntil) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(req.body.sealedUntil)) throw new HttpError(400, 'sealedUntil must be YYYY-MM-DD');
    if (req.body.sealedUntil <= new Date().toISOString().slice(0, 10)) {
      throw new HttpError(400, 'A capsule needs a date in the future');
    }
    sealedUntil = req.body.sealedUntil;
  }

  const created = await one(
    `INSERT INTO love_notes (couple_id, author_id, body, sealed_until)
     VALUES ($1, $2, $3, $4)
     RETURNING id, author_id, body, pinned, created_at, sealed_until::STRING AS sealed_until`,
    [user.couple_id, user.id, body, sealedUntil]
  );
  const note = {
    ...created,
    author_name: user.display_name,
    sealed: !!sealedUntil,
    opened: false,
    // never leak a sealed body over the wire to the other subscriber
    body: sealedUntil ? '' : created.body,
  };
  await publish(user.couple_id, 'note.created', note);
  await notify(
    user.couple_id,
    user.id,
    sealedUntil ? 'capsule' : 'note',
    sealedUntil ? `${user.display_name} sealed a time capsule for you` : `${user.display_name} left you a note`
  );
  res.status(201).json({ note: { ...note, body: created.body } });
});
