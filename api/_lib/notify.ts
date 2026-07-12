import { one } from './db';
import { publish } from './ably';

export type NotificationKind = 'nudge' | 'memory' | 'note' | 'milestone' | 'partner' | 'bucket';

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
  } catch (err) {
    console.error('notify failed', err);
  }
}
