import { one } from '../_lib/db';
import { requireUser } from '../_lib/auth';
import { publish } from '../_lib/ably';
import { route, requireString, HttpError } from '../_lib/respond';

export default route(['POST'], async (req, res) => {
  const user = await requireUser(req);
  if (user.couple_id) throw new HttpError(409, 'You’re already in a shared space');

  const code = requireString(req.body?.code, 'Invite code', 12).toUpperCase().replace(/\s/g, '');
  const couple = await one<{ id: string; invite_code: string }>(
    'SELECT id, invite_code FROM couples WHERE invite_code = $1',
    [code]
  );
  if (!couple) throw new HttpError(404, 'That code doesn’t match any space');

  const members = await one<{ n: number }>(
    'SELECT count(*)::int AS n FROM users WHERE couple_id = $1',
    [couple.id]
  );
  if ((members?.n ?? 0) >= 2) throw new HttpError(409, 'That space already has two people in it');

  await one('UPDATE users SET couple_id = $2 WHERE id = $1', [user.id, couple.id]);
  await publish(couple.id, 'partner.joined', { name: user.display_name });
  res.status(200).json({ couple });
});
