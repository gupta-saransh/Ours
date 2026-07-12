import { one, q } from './db';
import { publish } from './ably';
import { sendPush } from './push';
import { routeForKind } from './notification-routes';

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
  | 'wishlist';

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
    for (const o of others) {
      await sendPush(o.id, { title: 'Ours', body: text, url });
    }
  } catch (err) {
    console.error('notify failed', err);
  }
}
