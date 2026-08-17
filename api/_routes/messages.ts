import { one, q } from '../_lib/db';
import { requirePairedUser } from '../_lib/auth';
import { publish, isActiveInChat } from '../_lib/ably';
import { sendPush } from '../_lib/push';
import { notify } from '../_lib/notify';
import { encryptField, readField } from '../_lib/envelope';
import { transcodeToAac } from '../_lib/transcode';
import { route, requireString, HttpError } from '../_lib/respond';
import { errorFields, log } from '../_lib/log';

/**
 * Partner chat.
 *   GET    /api/messages[?before=<ISO>]  list (ascending), unread count, partner's read cursor, reactions
 *   POST   /api/messages { body?, imageData?, imageThumb?, audio?, replyToId? }  send (text and/or photo and/or voice note, optionally quoting)
 *   POST   /api/messages/seen            mark the thread read (advance the cursor, tell the partner)
 *   GET    /api/messages/unread          just the unread count (for the badge)
 *   GET    /api/messages/:id             the full-resolution image or full audio clip of one message
 *   POST   /api/messages/:id { action: 'to-timeline', note? }  copy a photo message into the timeline
 *   POST   /api/messages/:id { action: 'react', emoji }        set your reaction (replaces any earlier one)
 *   POST   /api/messages/:id { action: 'unreact' }              remove your reaction
 *   DELETE /api/messages/:id             remove your own message (for both of you; no per-side "delete for me")
 *
 * Bodies are encrypted at rest (envelope.ts); images and voice-note audio are
 * plaintext base64 like memory photos (audio is not among the encrypted
 * fields either). A voice note has no smaller "thumb" the way a photo does
 * (there is no such thing as a low-res but still-playable clip), so the
 * list-weight payload for one is its WAVEFORM + duration, a few dozen small
 * numbers; the full clip is fetched on tap, same as a photo's full
 * resolution is. Delivery is live over Ably (`message.created`, plaintext
 * body + the small thumbnail/waveform over the TLS + subscribe-only channel)
 * plus a best-effort Web Push to the away partner, SKIPPED when the
 * recipient is already sitting on the chat screen (see isActiveInChat in
 * _lib/ably.ts) since the live event is about to show them the message
 * anyway. Chat writes NO notification rows (it would flood the bell); saving
 * a photo to the timeline is a memory, so that one does.
 */

/**
 * Every query here excludes the secret thread (v26). The filter is applied
 * through this helper rather than inlined because a deploy that lands before
 * `npm run migrate` has no `secret` column, and chat is the one feature that
 * must not 500 in that window. Retrying without the filter is SAFE in exactly
 * that case: with no column there are no secret messages to leak. Any error
 * that is not "undefined column" is rethrown untouched.
 */
const UNDEFINED_COLUMN = '42703';

async function withoutSecret<T>(build: (filter: string) => string, params: unknown[], run: (sql: string, p: unknown[]) => Promise<T>): Promise<T> {
  try {
    return await run(build('AND NOT secret'), params);
  } catch (err) {
    if ((err as { code?: string })?.code !== UNDEFINED_COLUMN) throw err;
    return await run(build(''), params);
  }
}

const PAGE = 40;
const MAX_EMOJI_LEN = 16;
/** ~2MB decoded at 64kbps mono for a 3-minute clip, generous headroom either side. */
const MAX_AUDIO_B64_LEN = 6_000_000;
const MAX_WAVEFORM_BARS = 64;

interface Row {
  id: string;
  sender_id: string;
  body: string;
  body_ct: Buffer | null;
  image_thumb: string | null;
  has_image: boolean;
  has_audio: boolean;
  audio_mime: string | null;
  audio_duration_ms: number | null;
  audio_waveform: number[] | null;
  reply_to_id: string | null;
  created_at: string;
}

/** Clamps an incoming waveform to a sane shape: finite numbers in 0..1, capped length. */
function sanitizeWaveform(input: unknown): number[] {
  if (!Array.isArray(input)) return [];
  return input
    .slice(0, MAX_WAVEFORM_BARS)
    .map((v) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0));
}

interface ReactionRow {
  message_id: string;
  user_id: string;
  emoji: string;
}

async function unreadCount(coupleId: string, userId: string): Promise<number> {
  const seen = await one<{ chat_seen_at: string }>('SELECT chat_seen_at FROM users WHERE id = $1', [userId]);
  // ::INT4, not ::INT. CockroachDB's INT *is* INT8, which the pg driver returns
  // as a STRING to preserve precision, so `count(*)::int` was yielding '3'
  // rather than 3 (verified against the real database). It happened to work
  // because the only consumer compares `> 0`, but any arithmetic on it would
  // have concatenated instead of added. INT4 is the only cast that changes the
  // wire type here; Number() covers a plain-Postgres deployment too.
  const row = await withoutSecret<{ n: number | string } | undefined>(
    (secretFilter) => `SELECT count(*)::INT4 AS n FROM messages
     WHERE couple_id = $1 AND sender_id != $2 AND created_at > $3 ${secretFilter}`,
    [coupleId, userId, seen?.chat_seen_at ?? new Date(0).toISOString()],
    (sql, p) => one<{ n: number | string }>(sql, p)
  );
  return Number(row?.n ?? 0) || 0;
}

/**
 * How many unread secret messages are waiting. A COUNT ONLY, and deliberately
 * outside the unlock grant so the dot can appear while the thread is still
 * locked (see the /unread branch). Its own cursor, so reading the normal thread
 * never clears it.
 */
async function secretUnreadCount(coupleId: string, userId: string): Promise<number> {
  const seen = await one<{ secret_seen_at: string }>('SELECT secret_seen_at FROM users WHERE id = $1', [userId]);
  const row = await one<{ n: number | string }>(
    `SELECT count(*)::INT4 AS n FROM messages
     WHERE couple_id = $1 AND secret AND sender_id != $2 AND created_at > $3
       AND (expires_at IS NULL OR expires_at > now()) AND system_text IS NULL`,
    [coupleId, userId, seen?.secret_seen_at ?? new Date(0).toISOString()]
  );
  return Number(row?.n ?? 0) || 0;
}

async function partnerSeenAt(coupleId: string, userId: string): Promise<string | null> {
  const row = await one<{ chat_seen_at: string }>(
    'SELECT chat_seen_at::STRING AS chat_seen_at FROM users WHERE couple_id = $1 AND id != $2',
    [coupleId, userId]
  );
  return row?.chat_seen_at ?? null;
}

export default route(['GET', 'POST', 'DELETE'], async (req, res) => {
  const user = await requirePairedUser(req);
  const cid = user.couple_id;
  const sub = (req.url ?? '').split('?')[0].replace(/\/+$/, '');
  const id = req.query.id ? String(req.query.id) : null;

  // ---- Single-message operations (/messages/:id) ----
  if (id) {
    const msg = await one<{
      sender_id: string;
      image_data: string | null;
      image_thumb: string | null;
      audio_data: string | null;
    }>(
      // `AND NOT secret` is what keeps every single-message operation (full
      // image fetch, delete, react, and above all to-timeline, which copies a
      // photo into permanent non-expiring storage) off the secret thread.
      // Secret messages have their own route with its own unlock check.
      'SELECT sender_id, image_data, image_thumb, audio_data FROM messages WHERE id = $1 AND couple_id = $2 AND NOT secret',
      [id, cid]
    );
    if (!msg) throw new HttpError(404, 'Message not found');

    if (req.method === 'GET') {
      res.status(200).json({ image_data: msg.image_data, audio_data: msg.audio_data });
      return;
    }

    if (req.method === 'DELETE') {
      // No "delete for me" / "delete for everyone" split: same own-content
      // rule as everywhere else in the app, and with only two people in the
      // thread a partner-only hide would not mean much anyway.
      if (msg.sender_id !== user.id) throw new HttpError(403, 'You can only delete your own messages');
      await one('DELETE FROM message_reactions WHERE message_id = $1', [id]);
      await one('DELETE FROM messages WHERE id = $1 AND couple_id = $2', [id, cid]);
      await publish(cid, 'message.deleted', { id, by: user.id });
      res.status(200).json({ ok: true });
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

    // POST: react/unreact. One reaction per person per message; setting a new
    // emoji replaces whatever you had. Never notifies (would flood the bell
    // for a tap), just the live event so the other side's bubble updates.
    if (req.body?.action === 'react') {
      const emoji = requireString(req.body.emoji, 'Emoji', MAX_EMOJI_LEN);
      await one(
        `INSERT INTO message_reactions (message_id, user_id, emoji) VALUES ($1, $2, $3)
         ON CONFLICT (message_id, user_id) DO UPDATE SET emoji = excluded.emoji, created_at = now()`,
        [id, user.id, emoji]
      );
      await publish(cid, 'message.reacted', { message_id: id, user_id: user.id, emoji });
      res.status(200).json({ ok: true });
      return;
    }
    if (req.body?.action === 'unreact') {
      await one('DELETE FROM message_reactions WHERE message_id = $1 AND user_id = $2', [id, user.id]);
      await publish(cid, 'message.reacted', { message_id: id, user_id: user.id, emoji: null });
      res.status(200).json({ ok: true });
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
    // `secretUnread` deliberately needs NO unlock grant. A bare count reveals
    // only "something arrived", which the visible-but-locked Secret toggle
    // already announces, and without it the dot could never appear until after
    // you had unlocked, which is precisely backwards: the dot is the thing that
    // tells you to go and unlock. Nothing else about the thread is reachable
    // here. Catch-guarded for a deploy running ahead of `npm run migrate`.
    const secretUnread = await secretUnreadCount(cid, user.id).catch(() => 0);
    res.status(200).json({ unread: await unreadCount(cid, user.id), secretUnread });
    return;
  }

  // ---- Send ----
  if (req.method === 'POST') {
    const hasBody = typeof req.body?.body === 'string' && req.body.body.trim().length > 0;
    const imageData = typeof req.body?.imageData === 'string' ? req.body.imageData : null;
    const imageThumb = typeof req.body?.imageThumb === 'string' ? req.body.imageThumb : imageData;

    const audioIn = req.body?.audio;
    const audioRaw = audioIn && typeof audioIn.data === 'string' ? audioIn.data : null;
    if (audioRaw && audioRaw.length > MAX_AUDIO_B64_LEN) throw new HttpError(400, 'That voice note is too long');
    const audioDurationMs = audioRaw
      ? Math.max(0, Math.min(600_000, Math.round(Number(audioIn.durationMs) || 0)))
      : null;
    const audioWaveform = audioRaw ? sanitizeWaveform(audioIn.waveform) : null;

    if (!hasBody && !imageData && !audioRaw) {
      throw new HttpError(400, 'A message needs some text, a photo, or a voice note');
    }

    // Normalize EVERY voice note to one canonical, guaranteed-everywhere-
    // playable format before it is ever stored: a clip recorded in a browser
    // can be audio/webm, which iOS's native player cannot reliably decode, so
    // "record on Android web, play back on a partner's iPhone" would
    // otherwise silently fail. Runs even on an already-mp4 native recording
    // (cheap, one code path rather than a "skip if already mp4" branch).
    // Fails LOUD (no silent pretend-send) rather than store an untranscoded
    // clip that might not play for the other person.
    let audioData: string | null = null;
    let audioMime: string | null = null;
    if (audioRaw) {
      const transcoded = await transcodeToAac(audioRaw);
      if (!transcoded.ok) {
        log('error', 'chat.voice_transcode_failed', { couple_id: cid, reason: transcoded.reason });
        throw new HttpError(500, 'Could not process that voice note. Try again.');
      }
      audioData = `data:${transcoded.mime};base64,${transcoded.base64}`;
      audioMime = transcoded.mime!;
    }
    const body = hasBody ? requireString(req.body.body, 'Message', 4000) : '';
    const bodyCt = body ? await encryptField(cid, body) : null;

    // Replying quotes an earlier message. Only the id is stored; the client
    // renders the quote from its own copy of the thread.
    let replyToId: string | null = null;
    if (typeof req.body?.replyToId === 'string' && req.body.replyToId) {
      // A normal message may only quote another normal one: without `NOT
      // secret` a quote preview would carry secret content into this thread.
      const target = await one('SELECT id FROM messages WHERE id = $1 AND couple_id = $2 AND NOT secret', [
        req.body.replyToId,
        cid,
      ]);
      if (!target) throw new HttpError(404, 'That message is gone');
      replyToId = req.body.replyToId;
    }

    const row = await one<{ id: string; created_at: string }>(
      `INSERT INTO messages
         (couple_id, sender_id, body, body_ct, image_thumb, image_data, audio_data, audio_mime, audio_duration_ms, audio_waveform, reply_to_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id, created_at::STRING AS created_at`,
      [
        cid,
        user.id,
        bodyCt ? '' : body,
        bodyCt,
        imageThumb,
        imageData,
        audioData,
        audioMime,
        audioDurationMs,
        audioWaveform ? JSON.stringify(audioWaveform) : null,
        replyToId,
      ]
    );
    const message = {
      id: row!.id,
      sender_id: user.id,
      body,
      reply_to_id: replyToId,
      image_thumb: imageThumb,
      has_image: !!imageData,
      has_audio: !!audioData,
      audio_mime: audioMime,
      audio_duration_ms: audioDurationMs,
      audio_waveform: audioWaveform,
      created_at: row!.created_at,
    };

    // The sender has by definition seen their own message.
    await one('UPDATE users SET chat_seen_at = now() WHERE id = $1', [user.id]).catch(() => {});
    // The thumbnail/waveform is list-weight (same size lists send); the full
    // image or audio clip is not carried over the channel.
    await publish(cid, 'message.created', message);

    try {
      const others = await q<{ id: string }>('SELECT id FROM users WHERE couple_id = $1 AND id != $2', [cid, user.id]);
      const push = audioData
        ? `${user.display_name} sent you a voice note`
        : imageData && !body
          ? `${user.display_name} sent you a photo`
          : `${user.display_name} sent you a message`;
      for (const o of others) {
        // Skip the push for whoever is already sitting on the chat screen:
        // they're about to see this arrive live over Ably, and a push on top
        // of that is exactly the "notified while already looking at it" bug.
        if (await isActiveInChat(cid, o.id)) {
          log('info', 'chat.push_skipped_active', { couple_id: cid, user_id: o.id });
          continue;
        }
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
  const rows = await withoutSecret<Row[]>(
    // audio_duration_ms::INT4 for the same reason as every other cast in this
    // file: CockroachDB INT is INT8, which the driver returns as a string, and
    // formatClipDuration's Number.isFinite() guard then rejects it and renders
    // every voice note as 0:00.
    (secretFilter) => `SELECT id, sender_id, body, body_ct, image_thumb, (image_data IS NOT NULL) AS has_image,
            (audio_data IS NOT NULL) AS has_audio, audio_mime,
            audio_duration_ms::INT4 AS audio_duration_ms, audio_waveform,
            reply_to_id, created_at::STRING AS created_at
     FROM messages
     WHERE couple_id = $1 ${secretFilter} ${before ? 'AND created_at < $2' : ''}
     ORDER BY created_at DESC
     LIMIT ${PAGE}`,
    before ? [cid, before] : [cid],
    (sql, p) => q<Row>(sql, p)
  );
  const hasMore = rows.length === PAGE;
  const decoded = await Promise.all(
    rows
      .slice()
      .reverse()
      .map(async ({ body_ct, ...m }) => ({ ...m, body: (await readField(cid, body_ct, m.body)) ?? '' }))
  );

  // One batched reaction query for the whole page rather than N+1.
  const ids = decoded.map((m) => m.id);
  const reactionRows = ids.length
    ? await q<ReactionRow>('SELECT message_id, user_id, emoji FROM message_reactions WHERE message_id = ANY($1::UUID[])', [ids])
    : [];
  const reactionsByMessage = new Map<string, { user_id: string; emoji: string }[]>();
  for (const r of reactionRows) {
    const list = reactionsByMessage.get(r.message_id) ?? [];
    list.push({ user_id: r.user_id, emoji: r.emoji });
    reactionsByMessage.set(r.message_id, list);
  }
  const messages = decoded.map((m) => ({ ...m, reactions: reactionsByMessage.get(m.id) ?? [] }));

  res.status(200).json({
    messages,
    unread: await unreadCount(cid, user.id),
    partnerSeenAt: await partnerSeenAt(cid, user.id),
    hasMore,
  });
});
