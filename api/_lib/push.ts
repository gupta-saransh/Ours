import webpush from 'web-push';
import { q } from './db';
import { endpointHost, errorFields, log } from './log';

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

/** Which of the three VAPID env vars are missing (empty list = fully set up). */
export function missingVapidVars(): string[] {
  return ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT'].filter((name) => !process.env[name]);
}

/** Configure web-push once per cold start. False if the VAPID env is missing. */
function ensureVapid(): boolean {
  if (vapidReady !== null) return vapidReady;
  const missing = missingVapidVars();
  if (missing.length > 0) {
    log('error', 'push.vapid_missing', { missing_env: missing });
    vapidReady = false;
    return false;
  }
  try {
    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT as string,
      process.env.VAPID_PUBLIC_KEY as string,
      process.env.VAPID_PRIVATE_KEY as string
    );
    vapidReady = true;
  } catch (err) {
    // Malformed keys (wrong length, stray whitespace) fail here, not at send.
    log('error', 'push.vapid_invalid', errorFields(err));
    vapidReady = false;
  }
  return vapidReady;
}

/** True when the server can send Web Push at all. Used by diagnostics. */
export function webPushConfigured(): boolean {
  return ensureVapid();
}

/** Store (or clear, with null) a user's push token / Web Push subscription. */
export async function registerPushToken(userId: string, token: string | null): Promise<void> {
  await q('UPDATE users SET push_token = $2 WHERE id = $1', [userId, token]);
  let host: string | undefined;
  try {
    host = token ? endpointHost(JSON.parse(token)?.endpoint) : undefined;
  } catch {
    host = 'unparseable';
  }
  log('info', token ? 'push.subscription_stored' : 'push.subscription_cleared', {
    user_id: userId,
    endpoint_host: host,
  });
}

export interface PushResult {
  delivered: boolean;
  /** Machine-readable outcome; every non-delivery has one. */
  reason?: PushReason;
}

/**
 * The complete list of ways a push can fail to arrive. These are the strings you
 * search for in the logs when someone says "notifications don't come" — each one
 * points at a different fix (server env, user permission, expired browser
 * subscription, native store credentials).
 */
export type PushReason =
  | 'notifications-off'
  | 'no-subscription'
  | 'vapid-not-configured'
  | 'invalid-subscription-json'
  | 'subscription-expired'
  | 'send-failed'
  | 'native-not-provisioned';

/**
 * Deliver one push. Never throws. `source` names the caller (notify kind, cron
 * kind, 'test') so a log search can answer "did the nightly reminder go out".
 */
export async function sendPush(
  recipientId: string,
  payload: PushPayload,
  source = 'unknown'
): Promise<PushResult> {
  const rows = await q<{ push_token: string | null; notifications_enabled: boolean }>(
    'SELECT push_token, notifications_enabled FROM users WHERE id = $1',
    [recipientId]
  );
  const user = rows[0];

  const done = (result: PushResult, extra: Record<string, unknown> = {}): PushResult => {
    log(result.delivered ? 'info' : 'warn', 'push.send', {
      user_id: recipientId,
      source,
      delivered: result.delivered,
      reason: result.reason,
      url: payload.url,
      ...extra,
    });
    return result;
  };

  if (!user?.notifications_enabled) return done({ delivered: false, reason: 'notifications-off' });

  const token = user.push_token?.trim();
  if (!token) return done({ delivered: false, reason: 'no-subscription' });

  // A Web Push subscription is a JSON object carrying an "endpoint".
  if (token.startsWith('{') && token.includes('"endpoint"')) {
    if (!ensureVapid()) {
      return done({ delivered: false, reason: 'vapid-not-configured' }, { missing_env: missingVapidVars() });
    }
    let subscription: any;
    try {
      subscription = JSON.parse(token);
    } catch {
      return done({ delivered: false, reason: 'invalid-subscription-json' });
    }
    const host = endpointHost(subscription?.endpoint);
    try {
      await webpush.sendNotification(
        subscription,
        JSON.stringify({ title: payload.title, body: payload.body, url: payload.url ?? '/' })
      );
      return done({ delivered: true }, { endpoint_host: host });
    } catch (err: any) {
      const status = err?.statusCode;
      // Subscription expired or was revoked: drop it so we stop retrying.
      if (status === 404 || status === 410) {
        await q('UPDATE users SET push_token = NULL WHERE id = $1', [recipientId]).catch(() => {});
        return done({ delivered: false, reason: 'subscription-expired' }, { endpoint_host: host, push_status: status });
      }
      return done({ delivered: false, reason: 'send-failed' }, {
        endpoint_host: host,
        push_status: status,
        // The push service's own explanation (e.g. Apple's "BadJwtToken").
        push_body: typeof err?.body === 'string' ? err.body.slice(0, 300) : undefined,
        ...errorFields(err),
      });
    }
  }

  // Native Expo/APNs/FCM token — closed-app delivery still needs store creds.
  return done({ delivered: false, reason: 'native-not-provisioned' });
}
