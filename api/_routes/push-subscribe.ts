import { requireUser } from '../_lib/auth';
import { registerPushToken } from '../_lib/push';
import { route, HttpError } from '../_lib/respond';

/**
 * POST /api/push/subscribe — store the browser's Web Push subscription in
 * users.push_token. Overwrites on every call so the stored subscription stays
 * fresh (endpoints rotate).
 */
export default route(['POST'], async (req, res) => {
  const user = await requireUser(req);
  const sub = req.body?.subscription;
  if (!sub || typeof sub !== 'object' || typeof sub.endpoint !== 'string') {
    throw new HttpError(400, 'A valid subscription is required');
  }
  await registerPushToken(user.id, JSON.stringify(sub));
  res.status(200).json({ ok: true });
});
