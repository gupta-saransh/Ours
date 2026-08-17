import { one, q } from '../_lib/db';
import { requirePairedUser } from '../_lib/auth';
import { publish, isActiveInChat } from '../_lib/ably';
import { sendPush } from '../_lib/push';
import { requireSecretSession } from '../_lib/secret-session';
import {
  DEFAULT_TTL_SECONDS,
  TTL_OPTIONS,
  expiryFor,
  isValidTtl,
  timerChangeNotice,
  ttlLabel,
  unkeepExpiry,
} from '../_lib/secret-chat';
import {
  encryptionEnabled,
  freshMessageKey,
  openTextWithKey,
  sealWithKey,
  unwrapMessageKey,
  wrapMessageKey,
} from '../_lib/envelope';
import { SYSTEM_ACTOR } from '../_lib/notify';
import { transcodeToAac } from '../_lib/transcode';
import { route, requireString, HttpError } from '../_lib/respond';
import { errorFields, log } from '../_lib/log';

/**
 * Secret chat: a second, code-gated thread inside the same couple, whose
 * messages disappear on a per-message timer.
 *
 *   GET    /api/secret-chat[?before=<ISO>]        the thread, the timer, the options
 *   POST   /api/secret-chat                       send (text and/or photo and/or voice)
 *   POST   /api/secret-chat/seen                  advance the secret read cursor
 *   GET    /api/secret-chat/unread                just the count, for the mark on the toggle
 *   POST   /api/secret-chat/settings { ttlSeconds }  change the timer (announced in the thread)
 *   GET    /api/secret-chat/:id                   full-resolution photo or full audio clip
 *   POST   /api/secret-chat/:id { action: 'keep' | 'unkeep' }
 *   DELETE /api/secret-chat/:id                   remove it, for BOTH of you
 *
 * A DELIBERATELY SEPARATE ROUTE from messages.ts, not a mode inside it. The
 * secret thread's every code path must present the unlock grant, and the surest
 * way to guarantee that is a module that does nothing else: there is no branch
 * here that can forget it, and no query in messages.ts that can accidentally
 * serve a secret row (they all carry `AND NOT secret`).
 *
 * THREE RULES THAT ARE NOT OBVIOUS FROM THE CODE:
 *
 *  1. Expiry is crypto-shredding, not deletion. Every message is sealed under
 *     its own key; killing the key (secret_message_keys) is what makes it
 *     unrecoverable, because deleting a row in Cockroach leaves MVCC history,
 *     replicas and weeks of managed backups behind. Keys are always destroyed
 *     BEFORE the rows they open, so a half-finished sweep leaves messages dead
 *     rather than alive.
 *
 *  2. The realtime event carries NO content, unlike message.created on the
 *     normal thread. A partner who has not unlocked is still subscribed to the
 *     couple channel, so shipping the body would put secret text in the memory
 *     of a locked client. Unlocked clients refetch, the way memory.created
 *     already makes clients refetch.
 *
 *  3. Encryption is REQUIRED here. Everywhere else in this app a missing
 *     MASTER_ENCRYPTION_KEY degrades gracefully to plaintext; doing that here
 *     would silently store exactly the content this feature exists to protect,
 *     so it fails loudly instead.
 */

const PAGE = 40;
const MAX_AUDIO_B64_LEN = 6_000_000;
const MAX_WAVEFORM_BARS = 64;

interface Row {
  id: string;
  sender_id: string;
  body_ct: Buffer | null;
  image_thumb_ct: Buffer | null;
  has_image: boolean;
  has_audio: boolean;
  audio_mime: string | null;
  audio_duration_ms: number | null;
  audio_waveform: number[] | null;
  reply_to_id: string | null;
  system_text: string | null;
  expires_at: string | null;
  ttl_seconds: number | null;
  kept_by: string | null;
  timer_started_at: string | null;
  created_at: string;
}

/** What one message looks like on the wire. A timer notice fills system_text and leaves the rest empty. */
interface OutMessage {
  id: string;
  sender_id: string;
  body: string;
  reply_to_id: string | null;
  image_thumb: string | null;
  has_image: boolean;
  has_audio: boolean;
  audio_mime: string | null;
  audio_duration_ms: number | null;
  audio_waveform: number[] | null;
  system_text: string | null;
  expires_at: string | null;
  ttl_seconds: number | null;
  kept_by: string | null;
  /** Null until the other person has opened the thread; that read is what starts the countdown. */
  timer_started_at: string | null;
  created_at: string;
}

function sanitizeWaveform(input: unknown): number[] {
  if (!Array.isArray(input)) return [];
  return input
    .slice(0, MAX_WAVEFORM_BARS)
    .map((v) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0));
}

/**
 * Destroy everything past its deadline for this couple: keys first, then the
 * ciphertext they opened. Runs on EVERY touch of the thread rather than only on
 * a schedule, because the timer can be as short as a minute and no cron can be
 * that prompt. The scheduled sweeper (cron/reminders?kind=shred) is the backstop
 * for couples who simply stop opening the app.
 *
 * Note the read filter never trusts this having run: an expired message is
 * excluded by its own `expires_at` regardless, so the worst case of a failed
 * sweep is dead bytes lingering, never a message reappearing.
 */
async function shredExpired(coupleId: string): Promise<void> {
  const expired = `SELECT id FROM messages
     WHERE couple_id = $1 AND secret AND expires_at IS NOT NULL AND expires_at <= now()`;
  await one(`DELETE FROM secret_message_keys WHERE message_id IN (${expired})`, [coupleId]);
  await one(
    `DELETE FROM messages
     WHERE couple_id = $1 AND secret AND expires_at IS NOT NULL AND expires_at <= now()`,
    [coupleId]
  );
}

async function currentTtl(coupleId: string): Promise<number> {
  const row = await one<{ secret_ttl_seconds: number }>(
    'SELECT secret_ttl_seconds FROM couples WHERE id = $1',
    [coupleId]
  );
  const value = row?.secret_ttl_seconds;
  return isValidTtl(value) ? value : DEFAULT_TTL_SECONDS;
}

async function unreadCount(coupleId: string, userId: string): Promise<number> {
  const seen = await one<{ secret_seen_at: string }>('SELECT secret_seen_at FROM users WHERE id = $1', [userId]);
  // ::INT4, not ::INT. CockroachDB's INT *is* INT8, which the pg driver hands
  // back as a STRING to avoid losing precision, so `count(*)::int` yields '3'
  // rather than 3 and any arithmetic on it silently concatenates. INT4 is the
  // only cast that actually changes the wire type here. Number() belt-and-
  // braces in case this ever runs against a plain Postgres.
  const row = await one<{ n: number | string }>(
    `SELECT count(*)::INT4 AS n FROM messages
     WHERE couple_id = $1 AND secret AND sender_id != $2 AND created_at > $3
       AND (expires_at IS NULL OR expires_at > now())`,
    [coupleId, userId, seen?.secret_seen_at ?? new Date(0).toISOString()]
  );
  return Number(row?.n ?? 0) || 0;
}

async function partnerSeenAt(coupleId: string, userId: string): Promise<string | null> {
  const row = await one<{ secret_seen_at: string }>(
    'SELECT secret_seen_at::STRING AS secret_seen_at FROM users WHERE couple_id = $1 AND id != $2',
    [coupleId, userId]
  );
  return row?.secret_seen_at ?? null;
}

/**
 * Post the contentless notice that records a timer change in the thread itself.
 * Attributed to the SYSTEM_ACTOR sentinel (the same all-zero id notifyCouple
 * uses) rather than the person who made the change: it is not their message,
 * and both partners must see it identically. The text already names them.
 */
async function postTimerNotice(coupleId: string, text: string): Promise<void> {
  await one(
    `INSERT INTO messages (couple_id, sender_id, secret, system_text, body)
     VALUES ($1, $2, true, $3, '') RETURNING id`,
    [coupleId, SYSTEM_ACTOR, text]
  ).catch(() => {});
}

export default route(['GET', 'POST', 'DELETE'], async (req, res) => {
  const user = await requirePairedUser(req);
  requireSecretSession(req, user.id);
  const cid = user.couple_id;

  if (!encryptionEnabled()) {
    // Loud, not graceful. See rule 3 in the header comment.
    log('error', 'secret.encryption_unavailable', { couple_id: cid });
    throw new HttpError(503, 'Secret chat needs encryption to be switched on. Nothing was sent.');
  }

  const sub = (req.url ?? '').split('?')[0].replace(/\/+$/, '');
  const id = req.query.id ? String(req.query.id) : null;

  await shredExpired(cid);

  // ---- Single-message operations ----
  if (id) {
    const msg = await one<{
      sender_id: string;
      created_at: string;
      ttl_seconds: number | null;
      timer_started_at: string | null;
      image_data_ct: Buffer | null;
      audio_data_ct: Buffer | null;
      wrapped_key: Buffer | null;
    }>(
      `SELECT m.sender_id, m.created_at::STRING AS created_at, m.ttl_seconds,
              m.timer_started_at::STRING AS timer_started_at,
              m.image_data_ct, m.audio_data_ct, k.wrapped_key
       FROM messages m
       LEFT JOIN secret_message_keys k ON k.message_id = m.id
       WHERE m.id = $1 AND m.couple_id = $2 AND m.secret
         AND (m.expires_at IS NULL OR m.expires_at > now())`,
      [id, cid]
    );
    if (!msg) throw new HttpError(404, 'That message is gone');

    if (req.method === 'DELETE') {
      // BOTH partners may delete anything here, unlike the normal thread's
      // sender-only rule. A secret both people are in is only as private as the
      // less comfortable of the two, so either can end it. Key first, as always.
      await one('DELETE FROM secret_message_keys WHERE message_id = $1', [id]);
      await one('DELETE FROM messages WHERE id = $1 AND couple_id = $2 AND secret', [id, cid]);
      await publish(cid, 'secret.message.deleted', { id, by: user.id });
      res.status(200).json({ ok: true });
      return;
    }

    if (req.method === 'GET') {
      const key = await unwrapMessageKey(cid, msg.wrapped_key);
      if (!key) throw new HttpError(404, 'That message is gone');
      const image = openTextWithKey(key, msg.image_data_ct);
      const audio = openTextWithKey(key, msg.audio_data_ct);
      res.status(200).json({ image_data: image, audio_data: audio });
      return;
    }

    // POST: keep / un-keep. Either partner may do either; see secret-chat.ts.
    const action = req.body?.action;
    if (action === 'keep') {
      await one(
        'UPDATE messages SET expires_at = NULL, kept_by = $3 WHERE id = $1 AND couple_id = $2 AND secret RETURNING id',
        [id, cid, user.id]
      );
      await publish(cid, 'secret.message.kept', { id, by: user.id, kept: true });
      res.status(200).json({ ok: true, kept_by: user.id, expires_at: null });
      return;
    }
    if (action === 'unkeep') {
      // Restores the ORIGINAL deadline, measured from when the other person
      // actually read it (usually already past, so it goes at once) rather than
      // granting a fresh window. A message kept before it was ever read simply
      // goes back to waiting. Computed by the pure, unit-tested helper so this
      // rule lives in exactly one place.
      const expires = unkeepExpiry(msg.timer_started_at, msg.ttl_seconds);
      await one(
        'UPDATE messages SET expires_at = $3, kept_by = NULL WHERE id = $1 AND couple_id = $2 AND secret RETURNING id',
        [id, cid, expires]
      );
      await publish(cid, 'secret.message.kept', { id, by: user.id, kept: false });
      await shredExpired(cid); // it is very likely due right now
      res.status(200).json({ ok: true, kept_by: null, expires_at: expires?.toISOString() ?? null });
      return;
    }
    throw new HttpError(400, 'Unknown action');
  }

  // ---- Read cursor, which is ALSO what starts the timers ----
  if (sub.endsWith('/seen')) {
    await one('UPDATE users SET secret_seen_at = now() WHERE id = $1 RETURNING id', [user.id]);
    // A message counts down from when the OTHER person reads it, not from when
    // it was sent: a 1-minute message sent while your person is asleep should
    // still be there when they wake up. Only their partner's messages start
    // here (`sender_id != me`), only once (`timer_started_at IS NULL`), and
    // never for a kept message or one sent with the timer off.
    const started = await q<{ id: string; expires_at: string }>(
      `UPDATE messages
       SET timer_started_at = now(), expires_at = now() + (ttl_seconds || ' seconds')::INTERVAL
       WHERE couple_id = $1 AND secret AND sender_id != $2
         AND timer_started_at IS NULL AND kept_by IS NULL
         AND ttl_seconds IS NOT NULL AND ttl_seconds > 0
       RETURNING id, expires_at::STRING AS expires_at`,
      [cid, user.id]
    );
    await publish(cid, 'secret.chat.seen', {
      by: user.id,
      at: new Date().toISOString(),
      // The sender's open thread swaps "waiting" for a live countdown off this,
      // without needing to refetch.
      started: started.map((s) => ({ id: s.id, expires_at: s.expires_at })),
    });
    res.status(200).json({ ok: true, started: started.length });
    return;
  }

  if (sub.endsWith('/unread')) {
    res.status(200).json({ unread: await unreadCount(cid, user.id) });
    return;
  }

  // ---- Change the timer ----
  if (sub.endsWith('/settings')) {
    const ttlSeconds = req.body?.ttlSeconds;
    if (!isValidTtl(ttlSeconds)) throw new HttpError(400, 'That is not one of the timer options');
    await one('UPDATE couples SET secret_ttl_seconds = $2 WHERE id = $1 RETURNING id', [cid, ttlSeconds]);
    // Never silent: consent is the point, so the change is written into the
    // thread where both people can see who made it and when.
    await postTimerNotice(cid, timerChangeNotice(user.display_name, ttlSeconds));
    await publish(cid, 'secret.ttl.changed', { by: user.id, ttl_seconds: ttlSeconds });
    log('info', 'secret.ttl_changed', { couple_id: cid, user_id: user.id, ttl_seconds: ttlSeconds });
    res.status(200).json({ ok: true, ttlSeconds, label: ttlLabel(ttlSeconds) });
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

    // Same normalize-everything rule the normal thread uses. Worth knowing: the
    // transcoder writes the clip to a temp file for ffmpeg, so a secret voice
    // note exists as plaintext on the function's own ephemeral disk for the
    // length of one invocation. Cleaned up in transcode.ts's finally, and the
    // container is discarded, but it is a real moment and not worth hiding.
    let audioData: string | null = null;
    let audioMime: string | null = null;
    if (audioRaw) {
      const transcoded = await transcodeToAac(audioRaw);
      if (!transcoded.ok) {
        log('error', 'secret.voice_transcode_failed', { couple_id: cid, reason: transcoded.reason });
        throw new HttpError(500, 'Could not process that voice note. Try again.');
      }
      audioData = `data:${transcoded.mime};base64,${transcoded.base64}`;
      audioMime = transcoded.mime!;
    }

    const body = hasBody ? requireString(req.body.body, 'Message', 4000) : '';

    // A reply may only quote something in THIS thread. Without the `secret`
    // check a secret message could quote a normal one (or the reverse), and the
    // quote preview would carry content across the wall in whichever direction.
    let replyToId: string | null = null;
    if (typeof req.body?.replyToId === 'string' && req.body.replyToId) {
      const target = await one('SELECT id FROM messages WHERE id = $1 AND couple_id = $2 AND secret', [
        req.body.replyToId,
        cid,
      ]);
      if (!target) throw new HttpError(404, 'That message is gone');
      replyToId = req.body.replyToId;
    }

    const messageKey = freshMessageKey();
    const wrapped = await wrapMessageKey(cid, messageKey);
    if (!wrapped) throw new HttpError(503, 'Secret chat needs encryption to be switched on. Nothing was sent.');

    const ttlSeconds = await currentTtl(cid);
    const now = new Date();
    // NOT stamped at send (v27). The message stores the deal it was sent under
    // and waits; the countdown begins when the other person actually opens the
    // thread, in the /seen branch above.
    const expiresAt = null;

    const row = await one<{ id: string; created_at: string }>(
      `INSERT INTO messages
         (couple_id, sender_id, secret, body, body_ct, image_thumb_ct, image_data_ct,
          audio_data_ct, audio_mime, audio_duration_ms, audio_waveform, reply_to_id,
          ttl_seconds, expires_at, created_at)
       VALUES ($1, $2, true, '', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING id, created_at::STRING AS created_at`,
      [
        cid,
        user.id,
        body ? sealWithKey(messageKey, body) : null,
        imageThumb ? sealWithKey(messageKey, imageThumb) : null,
        imageData ? sealWithKey(messageKey, imageData) : null,
        audioData ? sealWithKey(messageKey, audioData) : null,
        audioMime,
        audioDurationMs,
        audioWaveform ? JSON.stringify(audioWaveform) : null,
        replyToId,
        ttlSeconds,
        expiresAt,
        now,
      ]
    );

    // Key second, and compensate if it fails: a message with no key is
    // unreadable, which is the SAFE direction to fail, but leaving it in the
    // thread as a permanent blank would just be a bug.
    try {
      await one('INSERT INTO secret_message_keys (message_id, couple_id, wrapped_key) VALUES ($1, $2, $3) RETURNING message_id', [
        row!.id,
        cid,
        wrapped,
      ]);
    } catch (err) {
      await one('DELETE FROM messages WHERE id = $1', [row!.id]).catch(() => {});
      log('error', 'secret.key_store_failed', { couple_id: cid, ...errorFields(err) });
      throw new HttpError(500, 'Could not send that. Nothing was saved.');
    }

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
      system_text: null,
      kept_by: null,
      ttl_seconds: ttlSeconds,
      expires_at: expiresAt,
      timer_started_at: null,
      created_at: row!.created_at,
    };

    // The sender has by definition seen their own message. This must NOT run
    // the timer-starting UPDATE above: your own reading is not what starts your
    // own message's clock.
    await one('UPDATE users SET secret_seen_at = now() WHERE id = $1 RETURNING id', [user.id]).catch(() => {});

    // Content-free by design (rule 2 in the header comment): a locked partner is
    // still subscribed to this channel. Unlocked clients refetch on this event.
    await publish(cid, 'secret.message.created', {
      id: row!.id,
      sender_id: user.id,
      created_at: row!.created_at,
    });

    try {
      const others = await q<{ id: string }>('SELECT id FROM users WHERE couple_id = $1 AND id != $2', [cid, user.id]);
      for (const o of others) {
        if (await isActiveInChat(cid, o.id)) {
          log('info', 'secret.push_skipped_active', { couple_id: cid, user_id: o.id });
          continue;
        }
        // No name, no kind, no preview. The normal thread's push says who sent
        // what; this one must survive being read over someone's shoulder.
        await sendPush(o.id, { title: 'Ours', body: 'You have a new message', url: '/chat' }, 'chat');
      }
    } catch (err) {
      log('error', 'secret.push_failed', { couple_id: cid, ...errorFields(err) });
    }

    res.status(201).json({ message });
    return;
  }

  // ---- List ----
  const before = typeof req.query.before === 'string' && req.query.before ? req.query.before : null;
  const rows = await q<Row>(
    `SELECT id, sender_id, body_ct, image_thumb_ct,
            (image_data_ct IS NOT NULL) AS has_image, (audio_data_ct IS NOT NULL) AS has_audio,
            audio_mime, audio_duration_ms, audio_waveform, reply_to_id, system_text,
            expires_at::STRING AS expires_at, ttl_seconds, kept_by,
            timer_started_at::STRING AS timer_started_at, created_at::STRING AS created_at
     FROM messages
     WHERE couple_id = $1 AND secret AND (expires_at IS NULL OR expires_at > now())
       ${before ? 'AND created_at < $2' : ''}
     ORDER BY created_at DESC
     LIMIT ${PAGE}`,
    before ? [cid, before] : [cid]
  );
  const hasMore = rows.length === PAGE;

  const ids = rows.map((r) => r.id);
  const keyRows = ids.length
    ? await q<{ message_id: string; wrapped_key: Buffer }>(
        'SELECT message_id, wrapped_key FROM secret_message_keys WHERE message_id = ANY($1::UUID[])',
        [ids]
      )
    : [];
  const wrappedById = new Map(keyRows.map((k) => [k.message_id, k.wrapped_key]));

  const messages: OutMessage[] = [];
  for (const r of rows.slice().reverse()) {
    // A timer notice carries no couple content, so it has no key and needs none.
    if (r.system_text) {
      messages.push({
        id: r.id,
        sender_id: r.sender_id,
        system_text: r.system_text,
        created_at: r.created_at,
        body: '',
        reply_to_id: null,
        image_thumb: null,
        has_image: false,
        has_audio: false,
        audio_mime: null,
        audio_duration_ms: null,
        audio_waveform: null,
        expires_at: null,
        ttl_seconds: null,
        kept_by: null,
        timer_started_at: null,
      });
      continue;
    }
    const key = await unwrapMessageKey(cid, wrappedById.get(r.id));
    // No key means shredded. Skipping is right: an unreadable husk in the
    // thread would be worse than the message simply being gone, which is what
    // the person was promised.
    if (!key) continue;
    const { body_ct, image_thumb_ct, ...rest } = r;
    messages.push({
      ...rest,
      body: openTextWithKey(key, body_ct) ?? '',
      image_thumb: openTextWithKey(key, image_thumb_ct),
    });
  }

  const ttlSeconds = await currentTtl(cid);
  res.status(200).json({
    messages,
    hasMore,
    unread: await unreadCount(cid, user.id),
    partnerSeenAt: await partnerSeenAt(cid, user.id),
    ttlSeconds,
    ttlLabel: ttlLabel(ttlSeconds),
    // One source of truth for the picker: the client renders what it is given
    // rather than keeping its own copy of the list in sync.
    ttlOptions: TTL_OPTIONS,
  });
});
