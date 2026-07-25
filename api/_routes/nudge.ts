import { requirePairedUser } from '../_lib/auth';
import { publish } from '../_lib/ably';
import { notify } from '../_lib/notify';
import { pickNudgeMessage } from '../_lib/nudge-messages';
import { route } from '../_lib/respond';

/**
 * POST /api/nudge — "thinking of you", with a bit of variety. One random line
 * is picked HERE, once, so the live toast, the push notification, and the
 * notifications-pane history all show the exact same message rather than
 * each end guessing its own text.
 */
export default route(['POST'], async (req, res) => {
  const user = await requirePairedUser(req);
  const message = pickNudgeMessage(user.display_name);
  await publish(user.couple_id, 'nudge', { fromId: user.id, fromName: user.display_name, message });
  await notify(user.couple_id, user.id, 'nudge', message);
  res.status(200).json({ ok: true });
});
