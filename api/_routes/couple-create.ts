import { requireUser } from '../_lib/auth';
import { createCoupleForUser } from '../_lib/invite';
import { route, HttpError } from '../_lib/respond';

export default route(['POST'], async (req, res) => {
  const user = await requireUser(req);
  if (user.couple_id) throw new HttpError(409, 'You’re already in a shared space');

  // Shared path also wraps a fresh per-couple encryption key (envelope.ts).
  const couple = await createCoupleForUser(user.id);
  res.status(201).json({ couple });
});
