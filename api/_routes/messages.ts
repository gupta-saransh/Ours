import { one, q } from '../_lib/db';
import { requirePairedUser } from '../_lib/auth';
import { publish } from '../_lib/ably';
import { sendPush } from '../_lib/push';
import { notify } from '../_lib/notify';
import { encryptField, readField } from '../_lib/envelope';
import { route, requireString, HttpError } from '../_lib/respond';
import { errorFields, log } from '../_lib/log';

/**
 * Partner chat.
 *   GET  /api/messages[?before=<ISO>]  list (ascending), unread count, partner's read cursor
 *   POST /api/messages { body?, imageData?, imageThumb?, replyToId? }  send (text and/or photo, optionally quoting)
 *   POST /api/messages/seen            mark the thread read (advance the cursor, tell the partner)
 *   GET  /api/messages/unread          just the unread count (for the badge)
 *   GET  /api/messages/:id             the full-resolution image of one message
 *   POST /api/messages/:id { action: 'to-timeline', note? }  copy a photo message into the timeline
 *
 * Bodies are encrypted at rest (envelope.ts); images are plaintext base64 like
 * memory photos. Delivery is live over Ably (`message.created`, plaintext body +
 * the small thumbnail over the TLS + subscribe-only channel) plus a best-effort
 * Web Push to the away partner. Chat writes NO notification rows (it would flood
 * the bell); saving a photo to the timeline is a memory, so that one does.
 */

const PAGE = 40;

interface Row {
  id: string;
  sender_id: string;
  body: string;
  body_ct: Buffer | null;
  image_thumb: string | null;
  has_image: boolean;
  reply_to_id: string | null;
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

async function partnerSeenAt(coupleId: string, userId: string): Promise<string | null> {
  const row = await one<{ chat_seen_at: string }>(
    'SELECT chat_seen_at::STRING AS chat_seen_at FROM users WHERE couple_id = $1 AND id != $2',
    [coupleId, userId]
  );
  return row?.chat_seen_at ?? null;
}

export default route(['GET', 'POST'], async (req, res) => {
  const user = await requirePairedUser(req);
  const cid = user.couple_id;
  const sub = (req.url ?? '').split('?')[0].replace(/\/+$/, '');
  const id = req.query.id ? String(req.query.id) : null;

  // ---- Single-message operations (/messages/:id) ----
  if (id) {
    const msg = await one<{ sender_id: string; image_data: string | null; image_thumb: string | null }>(
      'SELECT sender_id, image_data, image_thumb FROM messages WHERE id = $1 AND couple_id = $2',
      [id, cid]
    );
    if (!msg) throw new HttpError(404, 'Message not found');

    if (req.method === 'GET') {
      res.status(200).json({ image_data: msg.image_data });
      return;
    }

    // POST: copy a photo message into the shared timeline as a memory.
    if (req.body?.action === 'to-timeline') {
      if (!msg.image_data && !msg.image_thumb) throw new HttpError(400, 'That message has no photo');
      const noteText = req.body?.note ? requireString(req.body.note, 'Note', 2000) : 'From our chat ♥';
      const noteCt = await encryptField(cid, noteText);
      const mem = await one<{ id: string }>(
        `INSERT INTO memories (couple_id, author_id, photo_data, thumb_data, note, note_ct, memory_date)
         VALUES ($1, $2, $3, $4, $5, $6, now()::DATE) RETURNING id`,
        [cid, user.id, msg.image_data, msg.image_thumb, noteCt ? '' : noteText, noteCt]
      );
      await publish(cid, 'memory.created', { id: mem!.id, author_id: user.id });
      await notify(cid, user.id, 'memory', `${user.display_name} saved a photo to your memories`);
      res.status(201).json({ memory: { id: mem!.id } });
      return;
    }
    throw new HttpError(400, 'Unknown action');
  }

  // ---- Advance the read cursor (and tell the partner, for the "Seen" receipt) ----
  if (sub.endsWith('/seen')) {
    await one('UPDATE users SET chat_seen_at = now() WHERE id = $1', [user.id]);
    await publish(cid, 'chat.seen', { by: user.id, at: new Date().toISOString() });
    res.status(200).json({ ok: true });
    return;
  }

  // ---- Lightweight badge poll ----
  if (sub.endsWith('/unread')) {
    res.status(200).json({ unread: await unreadCount(cid, user.id) });
    return;
  }

  // ---- Send ----
  if (req.method === 'POST') {
    const hasBody = typeof req.body?.body === 'string' && req.body.body.trim().length > 0;
    const imageData = typeof req.body?.imageData === 'string' ? req.body.imageData : null;
    const imageThumb = typeof req.body?.imageThumb === 'string' ? req.body.imageThumb : imageData;
    if (!hasBody && !imageData) throw new HttpError(400, 'A message needs some text or a photo');
    const body = hasBody ? requireString(req.body.body, 'Message', 4000) : '';
    const bodyCt = body ? await encryptField(cid, body) : null;

    // Replying quotes an earlier message. Only the id is stored; the client
    // renders the quote from its own copy of the thread.
    let replyToId: string | null = null;
    if (typeof req.body?.replyToId === 'string' && req.body.replyToId) {
      const target = await one('SELECT id FROM messages WHERE id = $1 AND couple_id = $2', [req.body.replyToId, cid]);
      if (!target) throw new HttpError(404, 'That message is gone');
      replyToId = req.body.replyToId;
    }

    const row = await one<{ id: string; created_at: string }>(
      `INSERT INTO messages (couple_id, sender_id, body, body_ct, image_thumb, image_data, reply_to_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, created_at::STRING AS created_at`,
      [cid, user.id, bodyCt ? '' : body, bodyCt, imageThumb, imageData, replyToId]
    );
    const message = {
      id: row!.id,
      sender_id: user.id,
      body,
      reply_to_id: replyToId,
      image_thumb: imageThumb,
      has_image: !!imageData,
      created_at: row!.created_at,
    };

    // The sender has by definition seen their own message.
    await one('UPDATE users SET chat_seen_at = now() WHERE id = $1', [user.id]).catch(() => {});
    // The thumbnail is list-weight (same size lists send); the full image is not
    // carried over the channel.
    await publish(cid, 'message.created', message);

    try {
      const others = await q<{ id: string }>('SELECT id FROM users WHERE couple_id = $1 AND id != $2', [cid, user.id]);
      const push = imageData && !body ? `${user.display_name} sent you a photo` : `${user.display_name} sent you a message`;
      for (const o of others) {
        await sendPush(o.id, { title: 'Ours', body: push, url: '/chat' }, 'chat');
      }
    } catch (err) {
      log('error', 'chat.push_failed', { couple_id: cid, ...errorFields(err) });
    }

    res.status(201).json({ message });
    return;
  }

  // ---- List (ascending, oldest to newest, capped at PAGE; older via ?before=) ----
  const before = typeof req.query.before === 'string' && req.query.before ? req.query.before : null;
  const rows = await q<Row>(
    `SELECT id, sender_id, body, body_ct, image_thumb, (image_data IS NOT NULL) AS has_image,
            reply_to_id, created_at::STRING AS created_at
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

  res.status(200).json({
    messages,
    unread: await unreadCount(cid, user.id),
    partnerSeenAt: await partnerSeenAt(cid, user.id),
    hasMore,
  });
});
