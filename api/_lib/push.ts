import webpush from 'web-push';
import { q } from './db';

/**
 * Push notifications.
 *
 * WEB (PWA on the iPhone home screen, or any browser): fully real. The browser
 * subscribes via the VAPID public key, we store the subscription JSON in
 * `users.push_token`, and this module delivers through the Web Push protocol so
 * notifications arrive with the app closed or backgrounded. Requires the three
 * VAPID_* env vars (see .env.example / scripts/generate-vapid.ts).
 *
 * NATIVE (a real iOS/Android binary): still needs APNs/FCM credentials tied to
 * a developer account, which we do not have. A native token is stored but not
 * delivered to; in-app realtime over Ably covers the foreground.
 */
export interface PushPayload {
  title: string;
  body: string;
  /** Deep-link path the notification opens on tap. */
  url?: string;
}

let vapidReady: boolean | null = null;

/** Configure web-push once per cold start. False if the VAPID env is missing. */
function ensureVapid(): boolean {
  if (vapidReady !== null) return vapidReady;
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  if (!pub || !priv || !subject) {
    vapidReady = false;
    return false;
  }
  webpush.setVapidDetails(subject, pub, priv);
  vapidReady = true;
  return true;
}

/** Store (or clear, with null) a user's push token / Web Push subscription. */
export async function registerPushToken(userId: string, token: string | null): Promise<void> {
  await q('UPDATE users SET push_token = $2 WHERE id = $1', [userId, token]);
}

export async function sendPush(
  recipientId: string,
  payload: PushPayload
): Promise<{ delivered: boolean; reason?: string }> {
  const rows = await q<{ push_token: string | null; notifications_enabled: boolean }>(
    'SELECT push_token, notifications_enabled FROM users WHERE id = $1',
    [recipientId]
  );
  const user = rows[0];
  if (!user?.notifications_enabled) return { delivered: false, reason: 'notifications off' };

  const token = user.push_token?.trim();
  if (!token) return { delivered: false, reason: 'no push token' };

  // A Web Push subscription is a JSON object carrying an "endpoint".
  if (token.startsWith('{') && token.includes('"endpoint"')) {
    if (!ensureVapid()) return { delivered: false, reason: 'VAPID keys not configured' };
    let subscription: any;
    try {
      subscription = JSON.parse(token);
    } catch {
      return { delivered: false, reason: 'invalid subscription JSON' };
    }
    try {
      await webpush.sendNotification(
        subscription,
        JSON.stringify({ title: payload.title, body: payload.body, url: payload.url ?? '/' })
      );
      return { delivered: true };
    } catch (err: any) {
      const status = err?.statusCode;
      // Subscription expired or was revoked: drop it so we stop retrying.
      if (status === 404 || status === 410) {
        await q('UPDATE users SET push_token = NULL WHERE id = $1', [recipientId]).catch(() => {});
        return { delivered: false, reason: 'subscription gone (cleared)' };
      }
      console.error('web push failed', status, err?.body ?? err?.message);
      return { delivered: false, reason: 'send failed' };
    }
  }

  // Native Expo/APNs/FCM token — closed-app delivery still needs store creds.
  return { delivered: false, reason: 'native push credentials not provisioned' };
}
