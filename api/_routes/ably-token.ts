import { requirePairedUser } from '../_lib/auth';
import { getAbly, coupleChannel } from '../_lib/ably';
import { route } from '../_lib/respond';

/**
 * GET /api/ably-token — Ably token request scoped to this couple's channel only.
 * The API key never reaches the client; a token can't subscribe to anyone else's space.
 *
 * `presence` (on top of `subscribe`) lets the chat screen mark itself present
 * while it's open, tagged clientId = the user's own id, so the server can ask
 * "is this specific person looking at the chat right now" before sending a
 * push for a new message (see isActiveInChat in _lib/ably.ts).
 */
export default route(['GET'], async (req, res) => {
  const user = await requirePairedUser(req);
  const tokenRequest = await getAbly().auth.createTokenRequest({
    clientId: user.id,
    capability: { [coupleChannel(user.couple_id)]: ['subscribe', 'presence'] },
  });
  res.status(200).json(tokenRequest);
});
