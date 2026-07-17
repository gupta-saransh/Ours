import { one, q } from '../_lib/db';
import { requirePairedUser } from '../_lib/auth';
import { publish } from '../_lib/ably';
import { sendPush } from '../_lib/push';
import { encryptField, readField } from '../_lib/envelope';
import { route, requireString } from '../_lib/respond';

/**
 * Partner chat.
 *   GET  /api/messages[?before=<ISO>]  list (ascending), with the unread count
 *   POST /api/messages { body }        send a message
 *   POST /api/messages/seen            mark the thread read (advance the cursor)
 *   GET  /api/messages/unread          just the unread count (for the badge)
 *
 * Bodies are encrypted at rest (envelope.ts). Delivery is live over Ably
 * (`message.created`, plaintext body over the TLS + subscribe-only channel,
 * same as notes/memories) plus a best-effort Web Push to the away partner.
 * Chat intentionally writes NO notification rows, so it never floods the bell.
 */

const PAGE = 40;

interface Row {
  id: string;
  sender_id: string;
  body: string;
  body_ct: Buffer | null;
  created_at: string;
}

async function unreadCount(coupleId: string, userId: string): Promise<number> {
  const seen = await one<{ chat_seen_at: string }>('SELECT chat_seen_at FROM users WHERE id = $1', [userId]);
  const row = await one<{ n: number }>(
    `SELECT count(*)::int AS n FROM messages
     WHERE couple_id = $1 AND sender_id != $2 AND created_at > $3`,
    [coupleId, userId, seen?.chat_seen_at ?? new Date(0).toISOString()]
  );
  return row?.n ?? 0;
}

export default route(['GET', 'POST'], async (req, res) => {
  const user = await requirePairedUser(req);
  const cid = user.couple_id;
  const sub = (req.url ?? '').split('?')[0].replace(/\/+$/, '');

  // Advance the read cursor.
  if (sub.endsWith('/seen')) {
    await one('UPDATE users SET chat_seen_at = now() WHERE id = $1', [user.id]);
    res.status(200).json({ ok: true });
    return;
  }

  // Lightweight badge poll.
  if (sub.endsWith('/unread')) {
    res.status(200).json({ unread: await unreadCount(cid, user.id) });
    return;
  }

  // Send.
  if (req.method === 'POST') {
    const body = requireString(req.body?.body, 'Message', 4000);
    const bodyCt = await encryptField(cid, body);
    const row = await one<{ id: string; created_at: string }>(
      `INSERT INTO messages (couple_id, sender_id, body, body_ct)
       VALUES ($1, $2, $3, $4) RETURNING id, created_at::STRING AS created_at`,
      [cid, user.id, bodyCt ? '' : body, bodyCt]
    );
    const message = { id: row!.id, sender_id: user.id, body, created_at: row!.created_at };

    // The sender has by definition seen their own message; keep their cursor
    // current so the badge never lights for something they sent.
    await one('UPDATE users SET chat_seen_at = now() WHERE id = $1', [user.id]).catch(() => {});
    await publish(cid, 'message.created', message);

    // Best-effort closed-app nudge to the partner. Generic body: the message
    // content is encrypted at rest and never embedded anywhere durable.
    try {
      const others = await q<{ id: string }>('SELECT id FROM users WHERE couple_id = $1 AND id != $2', [cid, user.id]);
      for (const o of others) {
        await sendPush(o.id, { title: 'Ours', body: `${user.display_name} sent you a message`, url: '/chat' });
      }
    } catch (err) {
      console.error('chat push failed', err);
    }

    res.status(201).json({ message });
    return;
  }

  // List (ascending, oldest to newest, capped at PAGE; older via ?before=).
  const before = typeof req.query.before === 'string' && req.query.before ? req.query.before : null;
  const rows = await q<Row>(
    `SELECT id, sender_id, body, body_ct, created_at::STRING AS created_at
     FROM messages
     WHERE couple_id = $1 ${before ? 'AND created_at < $2' : ''}
     ORDER BY created_at DESC
     LIMIT ${PAGE}`,
    before ? [cid, before] : [cid]
  );
  const hasMore = rows.length === PAGE;
  const messages = await Promise.all(
    rows
      .slice()
      .reverse()
      .map(async ({ body_ct, ...m }) => ({ ...m, body: (await readField(cid, body_ct, m.body)) ?? '' }))
  );

  res.status(200).json({ messages, unread: await unreadCount(cid, user.id), hasMore });
});
