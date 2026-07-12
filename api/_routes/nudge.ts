import { one } from '../_lib/db';
import { requirePairedUser } from '../_lib/auth';
import { publish } from '../_lib/ably';
import { sendPush } from '../_lib/push';
import { route } from '../_lib/respond';

/** POST /api/nudge — "thinking of you", delivered live over Ably while the app is open. */
export default route(['POST'], async (req, res) => {
  const user = await requirePairedUser(req);
  await publish(user.couple_id, 'nudge', { fromId: user.id, fromName: user.display_name });

  // Real hook for closed-app delivery; see api/_lib/push.ts for why it's a no-op today.
  const partner = await one<{ id: string }>(
    'SELECT id FROM users WHERE couple_id = $1 AND id != $2',
    [user.couple_id, user.id]
  );
  if (partner) {
    await sendPush(partner.id, { title: 'Ours', body: `${user.display_name} is thinking of you ♥` });
  }
  res.status(200).json({ ok: true });
});
