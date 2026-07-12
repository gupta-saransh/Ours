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
