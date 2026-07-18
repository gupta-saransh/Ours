import { requireUser } from '../_lib/auth';
import { one } from '../_lib/db';
import { endpointHost, log, loggingConfigured } from '../_lib/log';
import { missingVapidVars, registerPushToken, sendPush, webPushConfigured } from '../_lib/push';
import { route, HttpError } from '../_lib/respond';

/**
 * Web Push subscription + self-diagnostics.
 *
 *   POST /api/push/subscribe { subscription }  store the browser's subscription
 *   POST /api/push/subscribe { test: true }    send yourself a test push now
 *   GET  /api/push/subscribe                   why notifications are or are not working
 *
 * The GET and the test exist because "notifications don't come" has half a dozen
 * possible causes across server env, browser permission, and an expired
 * subscription, and only the server can see most of them. Settings surfaces both.
 */
export default route(['GET', 'POST'], async (req, res) => {
  const user = await requireUser(req);

  if (req.method === 'GET') {
    const row = await one<{ push_token: string | null; notifications_enabled: boolean }>(
      'SELECT push_token, notifications_enabled FROM users WHERE id = $1',
      [user.id]
    );
    let host: string | undefined;
    if (row?.push_token) {
      try {
        host = endpointHost(JSON.parse(row.push_token)?.endpoint);
      } catch {
        host = 'unparseable';
      }
    }
    res.status(200).json({
      // Server side
      serverConfigured: webPushConfigured(),
      missingEnv: missingVapidVars(),
      loggingConfigured: loggingConfigured(),
      // This account
      notificationsEnabled: !!row?.notifications_enabled,
      hasSubscription: !!row?.push_token,
      endpointHost: host ?? null,
    });
    return;
  }

  if (req.body?.test === true) {
    const result = await sendPush(
      user.id,
      { title: 'Ours', body: 'This is a test. Notifications are working. ♥', url: '/settings' },
      'test'
    );
    log('info', 'push.test', { user_id: user.id, delivered: result.delivered, reason: result.reason });
    res.status(200).json(result);
    return;
  }

  const sub = req.body?.subscription;
  if (!sub || typeof sub !== 'object' || typeof sub.endpoint !== 'string') {
    throw new HttpError(400, 'A valid subscription is required');
  }
  // Overwrites on every call so the stored subscription stays fresh (endpoints
  // rotate, and a stale one fails silently at the push service).
  await registerPushToken(user.id, JSON.stringify(sub));
  res.status(200).json({ ok: true });
});
