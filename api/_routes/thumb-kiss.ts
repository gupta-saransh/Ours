import { one } from '../_lib/db';
import { requirePairedUser } from '../_lib/auth';
import { publish } from '../_lib/ably';
import { route } from '../_lib/respond';

/**
 * POST /api/thumb-kiss — a match was detected client-side (both partners were
 * simultaneously holding the touch target). Only ONE of the two clients calls
 * this per match (the caller picks itself by comparing user ids, the same
 * ordered-pair tie-break agreementStatsFor uses in game.ts), so the atomic
 * UPDATE below only ever runs once per match. The new count is published so
 * the OTHER partner's screen, which never called this route, still learns the
 * real number rather than guessing.
 */
export default route(['POST'], async (req, res) => {
  const user = await requirePairedUser(req);
  const row = await one<{ thumb_kiss_count: number }>(
    'UPDATE couples SET thumb_kiss_count = thumb_kiss_count + 1 WHERE id = $1 RETURNING thumb_kiss_count',
    [user.couple_id]
  );
  const count = row?.thumb_kiss_count ?? 0;
  await publish(user.couple_id, 'thumbkiss.matched', { count });
  res.status(200).json({ count });
});
