import { one, q } from './db';
import { publish } from './ably';
import { sendPush } from './push';
import { routeForKind } from './notification-routes';
import { errorFields, log } from './log';

export type NotificationKind =
  | 'nudge'
  | 'memory'
  | 'note'
  | 'milestone'
  | 'partner'
  | 'bucket'
  | 'prompt'
  | 'capsule'
  | 'date'
  | 'wishlist'
  | 'comment'
  | 'game';

/**
 * The notification service: every meaningful action lands in the
 * notifications table (for the bell + history) and on the couple's Ably
 * channel (for the live dot). Never fails the calling request.
 */
export async function notify(
  coupleId: string,
  actorId: string,
  kind: NotificationKind,
  text: string
): Promise<void> {
  try {
    const row = await one(
      `INSERT INTO notifications (couple_id, actor_id, kind, text)
       VALUES ($1, $2, $3, $4) RETURNING id, actor_id, kind, text, created_at`,
      [coupleId, actorId, kind, text]
    );
    await publish(coupleId, 'notification', row);

    // Best-effort background/closed-app push to the other partner(s). sendPush
    // checks each recipient's own preference and never throws.
    const others = await q<{ id: string }>(
      'SELECT id FROM users WHERE couple_id = $1 AND id != $2',
      [coupleId, actorId]
    );
    const url = routeForKind(kind);
    let delivered = 0;
    for (const o of others) {
      const result = await sendPush(o.id, { title: 'Ours', body: text, url }, `notify:${kind}`);
      if (result.delivered) delivered += 1;
    }
    // The notification text itself is never logged: it names people and can echo
    // couple content. Kind + counts are enough to trace a delivery.
    log('info', 'notify.sent', {
      couple_id: coupleId,
      actor_id: actorId,
      kind,
      recipients: others.length,
      pushes_delivered: delivered,
    });
  } catch (err) {
    log('error', 'notify.failed', { couple_id: coupleId, actor_id: actorId, kind, ...errorFields(err) });
  }
}
