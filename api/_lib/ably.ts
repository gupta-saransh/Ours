import 'dotenv/config';
import Ably from 'ably';

let rest: Ably.Rest | undefined;

export function getAbly(): Ably.Rest {
  if (!rest) {
    if (!process.env.ABLY_API_KEY) throw new Error('ABLY_API_KEY is not set');
    rest = new Ably.Rest({ key: process.env.ABLY_API_KEY });
  }
  return rest;
}

export function coupleChannel(coupleId: string): string {
  return `couple:${coupleId}`;
}

/** Publish a realtime event to a couple's private channel. Never fails the request. */
export async function publish(coupleId: string, event: string, data: unknown): Promise<void> {
  try {
    await getAbly().channels.get(coupleChannel(coupleId)).publish(event, data);
  } catch (err) {
    console.error('Ably publish failed', err);
  }
}

/**
 * Is this person currently sitting on the chat screen? The chat screen enters
 * presence (tagged clientId = their user id) while it is mounted, focused, and
 * the tab/app is foregrounded, and leaves the moment any of that stops being
 * true (see useChatPresence in src/lib/realtime.tsx). Used to skip the "new
 * message" push when it would land on someone already watching it arrive live
 * over the same channel.
 *
 * Fails OPEN: if the presence check itself errors, we assume they are NOT
 * there and let the push go out. A missed notification is worse than a
 * redundant one.
 */
export async function isActiveInChat(coupleId: string, userId: string): Promise<boolean> {
  try {
    const page = await getAbly().channels.get(coupleChannel(coupleId)).presence.get({ clientId: userId });
    const members = Array.isArray(page) ? page : page.items;
    return members.length > 0;
  } catch (err) {
    console.error('Ably presence check failed', err);
    return false;
  }
}
