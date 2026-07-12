import { requirePairedUser } from '../_lib/auth';
import { publish } from '../_lib/ably';
import { notify } from '../_lib/notify';
import { route } from '../_lib/respond';

/**
 * POST /api/nudge — "thinking of you". Delivered live over Ably while the app
 * is open; notify() also sends the background/closed-app Web Push to the partner.
 */
export default route(['POST'], async (req, res) => {
  const user = await requirePairedUser(req);
  await publish(user.couple_id, 'nudge', { fromId: user.id, fromName: user.display_name });
  await notify(user.couple_id, user.id, 'nudge', `${user.display_name} was thinking of you`);
  res.status(200).json({ ok: true });
});
