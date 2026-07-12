import { q } from './db';

/**
 * Push notifications — the honest state of things.
 *
 * Delivering a push to a CLOSED app requires APNs (Apple) and FCM (Google)
 * credentials tied to real developer accounts, which can't be provisioned here.
 * While the app is OPEN, realtime delivery already works via Ably.
 *
 * This module is the real integration point for later:
 *  - `users.push_token` is a real column, populated via registerPushToken.
 *  - `sendPush` is called from the nudge route; today it only checks the
 *    recipient's preference and returns. Wire an Expo Push / FCM / APNs call
 *    inside it and closed-app delivery lights up with no other changes.
 */
export async function registerPushToken(userId: string, token: string | null): Promise<void> {
  await q('UPDATE users SET push_token = $2 WHERE id = $1', [userId, token]);
}

export async function sendPush(
  recipientId: string,
  _payload: { title: string; body: string }
): Promise<{ delivered: false; reason: string }> {
  const rows = await q<{ push_token: string | null; notifications_enabled: boolean }>(
    'SELECT push_token, notifications_enabled FROM users WHERE id = $1',
    [recipientId]
  );
  const user = rows[0];
  if (!user?.notifications_enabled) {
    return { delivered: false, reason: 'recipient has notifications turned off' };
  }
  return { delivered: false, reason: 'push credentials (APNs/FCM) not provisioned yet' };
}
