import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Guards the properties of the secret thread that actually make it secret,
 * rather than the plumbing it shares with the normal one:
 *
 *  - no unlock grant, no thread (the code has to buy something at the API layer
 *    or it is decoration);
 *  - expiry destroys the KEY before the row, in that order;
 *  - the realtime event carries no message content, because a partner who has
 *    not unlocked is still subscribed to the same channel;
 *  - the push names nobody and describes nothing;
 *  - a shredded message (key gone) is skipped, never served as a husk;
 *  - either partner may delete, unlike the sender-only rule everywhere else;
 *  - un-keeping restores the original deadline rather than granting a new one;
 *  - with no master key the route refuses to store anything, instead of
 *    degrading to plaintext the way every other field in this app does.
 */

const h = vi.hoisted(() => ({
  calls: [] as { text: string; params: unknown[] }[],
  publishes: [] as { event: string; data: any }[],
  pushes: [] as { userId: string; payload: any }[],
  active: false,
  encryption: true,
  ttl: 86_400 as number | string,
  listRows: [] as any[],
  keyRows: [] as any[],
  single: undefined as any,
  keyInsertFails: false,
}));

vi.mock('../_lib/auth', () => ({
  requirePairedUser: vi.fn(async () => ({ id: 'user-A', couple_id: 'couple-1', display_name: 'Ana' })),
}));
// secret-session is deliberately NOT mocked: it is the whole point of the gate,
// so these tests sign real tokens against a real JWT_SECRET and exercise the
// actual verification, including that one partner's grant is not another's.
process.env.JWT_SECRET = 'test-secret-for-secret-chat';
vi.mock('../_lib/ably', () => ({
  publish: vi.fn(async (_cid: string, event: string, data: unknown) => {
    h.publishes.push({ event, data });
  }),
  isActiveInChat: vi.fn(async () => h.active),
}));
vi.mock('../_lib/push', () => ({
  sendPush: vi.fn(async (userId: string, payload: unknown) => {
    h.pushes.push({ userId, payload });
    return { delivered: true };
  }),
}));
vi.mock('../_lib/notify', () => ({ SYSTEM_ACTOR: '00000000-0000-0000-0000-000000000000' }));
vi.mock('../_lib/log', () => ({ log: vi.fn(), errorFields: vi.fn(() => ({})), flushLogs: vi.fn(async () => {}) }));
vi.mock('../_lib/transcode', () => ({
  transcodeToAac: vi.fn(async () => ({ ok: true, base64: 'QUFB', mime: 'audio/mp4' })),
}));
vi.mock('../_lib/envelope', () => ({
  encryptionEnabled: vi.fn(() => h.encryption),
  freshMessageKey: vi.fn(() => Buffer.from('k'.repeat(32))),
  wrapMessageKey: vi.fn(async () => (h.encryption ? Buffer.from('wrapped') : null)),
  unwrapMessageKey: vi.fn(async (_cid: string, wrapped: Buffer | undefined) =>
    wrapped ? Buffer.from('k'.repeat(32)) : null
  ),
  sealWithKey: vi.fn((_key: Buffer, plain: string | Buffer) => Buffer.from(`SEALED:${plain}`)),
  openTextWithKey: vi.fn((_key: Buffer, blob: Buffer | null) =>
    blob ? String(blob).replace(/^SEALED:/, '') : null
  ),
}));
vi.mock('../_lib/db', () => ({
  one: vi.fn(async (text: string, params: unknown[] = []) => {
    h.calls.push({ text, params });
    if (text.includes('INSERT INTO secret_message_keys') && h.keyInsertFails) throw new Error('key store down');
    // h.ttl is deliberately typed `number | string`: CockroachDB's INT is INT8,
    // which the pg driver hands back as a STRING, and the route must survive
    // that. See the "int8 arrives as a string" tests below.
    if (text.startsWith('SELECT secret_ttl_seconds')) return { secret_ttl_seconds: h.ttl };
    if (text.includes('FROM messages m')) return h.single;
    if (text.startsWith('INSERT INTO messages')) return { id: 'm-new', created_at: '2026-08-17T12:00:00.000Z' };
    if (text.startsWith('SELECT secret_seen_at')) return { secret_seen_at: '2026-01-01T00:00:00.000Z' };
    if (text.includes('count(*)')) return { n: 0 };
    return undefined;
  }),
  q: vi.fn(async (text: string) => {
    h.calls.push({ text, params: [] });
    if (text.startsWith('SELECT id FROM users')) return [{ id: 'user-B' }];
    if (text.includes('FROM secret_message_keys')) return h.keyRows;
    if (text.includes('FROM messages')) return h.listRows;
    return [];
  }),
}));

import handler from './secret-chat';
import { signSecretToken } from '../_lib/secret-session';

function makeRes() {
  const res: any = {
    statusCode: 0,
    body: undefined as any,
    setHeader() {},
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
    end() {
      return this;
    },
  };
  return res;
}

// Minted inside beforeEach, AFTER the fake clock is set: a token signed against
// the real clock would already be expired once time is moved.
let UNLOCKED: Record<string, string>;

function req(over: Partial<any> = {}): any {
  return { method: 'GET', url: '/api/secret-chat', query: {}, headers: UNLOCKED, body: {}, ...over };
}

// The handler is wrapped in route(), which turns an HttpError into a written
// response rather than a rejection, so failures are asserted on res, not with
// .rejects (the same shape messages.test.ts uses).
beforeEach(() => {
  h.calls.length = 0;
  h.publishes.length = 0;
  h.pushes.length = 0;
  h.active = false;
  h.encryption = true;
  h.ttl = 86_400;
  h.listRows = [];
  h.keyRows = [];
  h.single = undefined;
  h.keyInsertFails = false;
  // Freeze time: a send stamps created_at + expires_at from the clock, and the
  // whole point of these assertions is the exact arithmetic.
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-08-17T12:00:00.000Z'));
  UNLOCKED = { 'x-secret-token': signSecretToken('user-A').token };
});
afterEach(() => vi.useRealTimers());

describe('the unlock grant', () => {
  it('refuses the thread outright without one', async () => {
    const res = makeRes();
    await handler(req({ headers: {} }), res);
    expect(res.statusCode).toBe(401);
    // Nothing was read, not even a shred pass.
    expect(h.calls).toHaveLength(0);
  });

  it('refuses the partner\'s grant: unlocking is per person, not per couple', async () => {
    const res = makeRes();
    await handler(req({ headers: { 'x-secret-token': signSecretToken('user-B').token } }), res);
    expect(res.statusCode).toBe(401);
    expect(h.calls).toHaveLength(0);
  });

  it('refuses an ordinary session token presented as a grant', async () => {
    // A session Bearer carries no `secret: true` claim, so it can never be
    // swapped in for one. The two credentials are separate on purpose.
    const jwt = (await import('jsonwebtoken')).default;
    const sessionToken = jwt.sign({}, process.env.JWT_SECRET!, { subject: 'user-A', expiresIn: '30d' });
    const res = makeRes();
    await handler(req({ headers: { 'x-secret-token': sessionToken } }), res);
    expect(res.statusCode).toBe(401);
  });

  it('refuses an expired grant', async () => {
    const token = signSecretToken('user-A').token;
    vi.setSystemTime(new Date('2026-08-17T12:20:00.000Z')); // grants last 15 minutes
    const res = makeRes();
    await handler(req({ headers: { 'x-secret-token': token } }), res);
    expect(res.statusCode).toBe(401);
  });
});

describe('encryption is required, never optional', () => {
  it('refuses to send with no master key rather than storing plaintext', async () => {
    h.encryption = false;
    const res = makeRes();
    await handler(req({ method: 'POST', body: { body: 'hi' } }), res);
    expect(res.statusCode).toBe(503);
    expect(res.body.error).toMatch(/encryption/i);
    expect(h.calls.some((c) => c.text.startsWith('INSERT INTO messages'))).toBe(false);
  });
});

describe('shredding', () => {
  it('destroys keys BEFORE the rows they open, on every touch', async () => {
    const res = makeRes();
    await handler(req(), res);
    const keyDelete = h.calls.findIndex((c) => c.text.includes('DELETE FROM secret_message_keys'));
    const rowDelete = h.calls.findIndex((c) => c.text.includes('DELETE FROM messages'));
    expect(keyDelete).toBeGreaterThanOrEqual(0);
    expect(rowDelete).toBeGreaterThan(keyDelete);
  });

  it('never serves a message whose key is gone', async () => {
    h.listRows = [
      { id: 'alive', sender_id: 'user-B', body_ct: Buffer.from('SEALED:still here'), created_at: 'x' },
      { id: 'shredded', sender_id: 'user-B', body_ct: Buffer.from('SEALED:gone'), created_at: 'y' },
    ];
    h.keyRows = [{ message_id: 'alive', wrapped_key: Buffer.from('wrapped') }];
    const res = makeRes();
    await handler(req(), res);
    expect(res.body.messages.map((m: any) => m.id)).toEqual(['alive']);
  });

  it('filters expired messages in SQL, not just after shredding', async () => {
    const res = makeRes();
    await handler(req(), res);
    const list = h.calls.find((c) => c.text.includes('FROM messages') && c.text.includes('ORDER BY created_at DESC'));
    expect(list!.text).toContain('expires_at IS NULL OR expires_at > now()');
  });
});

describe('sending', () => {
  it('records the timer it was sent under but does NOT start counting yet', async () => {
    h.ttl = 60;
    const res = makeRes();
    await handler(req({ method: 'POST', body: { body: 'hello' } }), res);
    expect(res.statusCode).toBe(201);
    const insert = h.calls.find((c) => c.text.startsWith('INSERT INTO messages'))!;
    expect(insert.params).toContain(60); // the deal it was sent under
    expect(h.calls.some((c) => c.text.includes('INSERT INTO secret_message_keys'))).toBe(true);
    // A message sent while your person is asleep must still be there when they
    // wake up, so the clock waits for their read.
    expect(res.body.message.expires_at).toBeNull();
    expect(res.body.message.timer_started_at).toBeNull();
  });

  it('does not start its own clock by marking the sender as having seen it', async () => {
    const res = makeRes();
    await handler(req({ method: 'POST', body: { body: 'hello' } }), res);
    expect(h.calls.some((c) => c.text.includes('SET timer_started_at'))).toBe(false);
  });

  it('leaves no expiry when the timer is off', async () => {
    h.ttl = 0;
    const res = makeRes();
    await handler(req({ method: 'POST', body: { body: 'hello' } }), res);
    expect(res.body.message.expires_at).toBeNull();
  });

  it('publishes the arrival WITHOUT the message body', async () => {
    const res = makeRes();
    await handler(req({ method: 'POST', body: { body: 'something private' } }), res);
    const event = h.publishes.find((p) => p.event === 'secret.message.created')!;
    expect(event.data).toEqual({
      id: 'm-new',
      sender_id: 'user-A',
      created_at: '2026-08-17T12:00:00.000Z',
    });
    expect(JSON.stringify(event.data)).not.toContain('something private');
  });

  it('pushes a body that names nobody and describes nothing', async () => {
    const res = makeRes();
    await handler(req({ method: 'POST', body: { body: 'something private' } }), res);
    expect(h.pushes).toHaveLength(1);
    expect(h.pushes[0].payload.body).toBe('You have a new message');
    expect(h.pushes[0].payload.body).not.toContain('Ana');
  });

  it('skips the push for a partner already sitting in the thread', async () => {
    h.active = true;
    const res = makeRes();
    await handler(req({ method: 'POST', body: { body: 'hi' } }), res);
    expect(h.pushes).toHaveLength(0);
  });

  it('removes the message if its key could not be stored, rather than leaving a blank', async () => {
    h.keyInsertFails = true;
    const res = makeRes();
    await handler(req({ method: 'POST', body: { body: 'hi' } }), res);
    expect(res.statusCode).toBe(500);
    expect(h.calls.some((c) => c.text === 'DELETE FROM messages WHERE id = $1')).toBe(true);
  });

  it('will not quote a message from the other thread', async () => {
    const res = makeRes();
    await handler(req({ method: 'POST', body: { body: 'hi', replyToId: 'm-normal' } }), res).catch(() => {});
    const lookup = h.calls.find((c) => c.text.includes('SELECT id FROM messages WHERE id = $1'));
    expect(lookup!.text).toContain('AND secret');
  });
});

describe('deleting', () => {
  it('lets EITHER partner delete, unlike the normal thread', async () => {
    h.single = { sender_id: 'user-B', created_at: 'x', ttl_seconds: 60, wrapped_key: Buffer.from('w') };
    const res = makeRes();
    await handler(
      req({ method: 'DELETE', url: '/api/secret-chat/m1', query: { id: 'm1' } }),
      res
    );
    expect(res.statusCode).toBe(200);
    expect(h.publishes.some((p) => p.event === 'secret.message.deleted')).toBe(true);
  });

  it('clears the key before the row here too', async () => {
    h.single = { sender_id: 'user-B', created_at: 'x', ttl_seconds: 60, wrapped_key: Buffer.from('w') };
    h.calls.length = 0;
    const res = makeRes();
    await handler(req({ method: 'DELETE', url: '/api/secret-chat/m1', query: { id: 'm1' } }), res);
    const key = h.calls.findIndex((c) => c.text === 'DELETE FROM secret_message_keys WHERE message_id = $1');
    const row = h.calls.findIndex((c) => c.text.startsWith('DELETE FROM messages WHERE id = $1'));
    expect(key).toBeGreaterThanOrEqual(0);
    expect(row).toBeGreaterThan(key);
  });
});

describe('the timer starts when the message is read', () => {
  it('starts the partner\'s messages on /seen, and only theirs', async () => {
    const res = makeRes();
    await handler(req({ method: 'POST', url: '/api/secret-chat/seen' }), res);
    const start = h.calls.find((c) => c.text.includes('SET timer_started_at'))!;
    expect(start.text).toContain('sender_id != $2'); // never your own
    expect(start.text).toContain('timer_started_at IS NULL'); // only once
    expect(start.text).toContain('kept_by IS NULL'); // never a kept message
    expect(start.text).toContain('ttl_seconds > 0'); // never when the timer is off
  });

  it('tells the sender the new deadlines so their countdown starts live', async () => {
    const res = makeRes();
    await handler(req({ method: 'POST', url: '/api/secret-chat/seen' }), res);
    const seen = h.publishes.find((p) => p.event === 'secret.chat.seen')!;
    expect(seen.data).toHaveProperty('started');
    expect(Array.isArray(seen.data.started)).toBe(true);
  });
});

describe('keep and un-keep', () => {
  const read = {
    sender_id: 'user-A',
    created_at: '2026-08-17T11:00:00.000Z',
    timer_started_at: '2026-08-17T12:00:00.000Z',
    ttl_seconds: 60,
    wrapped_key: Buffer.from('w'),
  };

  it('keeping clears the expiry', async () => {
    h.single = read;
    const res = makeRes();
    await handler(
      req({ method: 'POST', url: '/api/secret-chat/m1', query: { id: 'm1' }, body: { action: 'keep' } }),
      res
    );
    expect(res.body).toMatchObject({ kept_by: 'user-A', expires_at: null });
  });

  it('un-keeping restores the deadline measured from the READ, not from sending', async () => {
    h.single = read; // sent 11:00, read 12:00, 60s timer
    const res = makeRes();
    await handler(
      req({ method: 'POST', url: '/api/secret-chat/m1', query: { id: 'm1' }, body: { action: 'unkeep' } }),
      res
    );
    // read + 60s, NOT created + 60s (which would be 11:01).
    expect(res.body.expires_at).toBe('2026-08-17T12:01:00.000Z');
    expect(res.body.kept_by).toBeNull();
  });

  it('un-keeping something never read returns it to waiting, not to a fresh window', async () => {
    h.single = { ...read, timer_started_at: null };
    const res = makeRes();
    await handler(
      req({ method: 'POST', url: '/api/secret-chat/m1', query: { id: 'm1' }, body: { action: 'unkeep' } }),
      res
    );
    expect(res.body.expires_at).toBeNull();
  });
});

/**
 * The bug that made the whole feature look broken, and the reason these are
 * worth keeping: CockroachDB's INT *is* INT8, and the pg driver returns int8 as
 * a STRING to preserve precision. `isValidTtl` correctly demands a number, so
 * an unguarded read of `secret_ttl_seconds` failed validation EVERY time and
 * silently fell back to 24 hours. The setting saved fine and was thrown away on
 * the way out, so choosing "1 minute" changed nothing anyone could see.
 */
describe('int8 arrives as a string, and must not silently reset the timer', () => {
  it('honours a string timer instead of falling back to 24 hours', async () => {
    h.ttl = '60'; // exactly what the driver hands back
    const res = makeRes();
    await handler(req(), res);
    expect(res.body.ttlSeconds).toBe(60);
    expect(res.body.ttlLabel).toBe('1 minute');
  });

  it('stamps the real timer onto a sent message, not the fallback', async () => {
    h.ttl = '60';
    const res = makeRes();
    await handler(req({ method: 'POST', body: { body: 'hi' } }), res);
    expect(res.body.message.ttl_seconds).toBe(60);
    const insert = h.calls.find((c) => c.text.startsWith('INSERT INTO messages'))!;
    expect(insert.params).toContain(60);
    expect(insert.params).not.toContain('60');
  });

  it('honours a string "0" as the timer being OFF, not as a falsy fallback', async () => {
    h.ttl = '0';
    const res = makeRes();
    await handler(req(), res);
    expect(res.body.ttlSeconds).toBe(0);
  });

  it('still falls back for a genuinely unusable value', async () => {
    h.ttl = 'nonsense';
    const res = makeRes();
    await handler(req(), res);
    expect(res.body.ttlSeconds).toBe(86_400);
  });

  it('casts the columns it reads, so the fix holds at the source', async () => {
    const res = makeRes();
    await handler(req(), res);
    const ttlRead = h.calls.find((c) => c.text.includes('secret_ttl_seconds'))!;
    expect(ttlRead.text).toContain('::INT4');
    const list = h.calls.find((c) => c.text.includes('ORDER BY created_at DESC'))!;
    expect(list.text).toContain('ttl_seconds::INT4');
  });
});

describe('the timer', () => {
  it('rejects a duration that is not on the list', async () => {
    const res = makeRes();
    await handler(req({ method: 'POST', url: '/api/secret-chat/settings', body: { ttlSeconds: 37 } }), res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/timer options/);
    expect(h.calls.some((c) => c.text.includes('UPDATE couples SET secret_ttl_seconds'))).toBe(false);
  });

  it('announces a change in the thread, naming the person and never any content', async () => {
    const res = makeRes();
    await handler(req({ method: 'POST', url: '/api/secret-chat/settings', body: { ttlSeconds: 60 } }), res);
    const notice = h.calls.find((c) => c.text.includes('system_text'))!;
    expect(notice.params).toContain('Ana set messages to disappear after 1 minute');
    expect(h.publishes.some((p) => p.event === 'secret.ttl.changed')).toBe(true);
  });
});
