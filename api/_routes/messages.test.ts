import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Guards the pieces added to chat this pass: deleting your own message (and
 * only your own) clears its reactions too, react/unreact upsert vs. delete
 * the single per-user reaction row, the send path skips the push for a
 * recipient the presence check says is already on the chat screen, and the
 * list response attaches each message's reactions.
 */

const h = vi.hoisted(() => ({
  message: { sender_id: 'user-A', image_data: null as string | null, image_thumb: null as string | null },
  calls: [] as { text: string; params: unknown[] }[],
  publishes: [] as { coupleId: string; event: string; data: unknown }[],
  pushes: [] as { userId: string }[],
  active: false,
  qResults: [] as unknown[],
}));

vi.mock('../_lib/auth', () => ({
  requirePairedUser: vi.fn(async () => ({ id: 'user-A', couple_id: 'couple-1', display_name: 'A' })),
}));
vi.mock('../_lib/ably', () => ({
  publish: vi.fn(async (coupleId: string, event: string, data: unknown) => {
    h.publishes.push({ coupleId, event, data });
  }),
  isActiveInChat: vi.fn(async () => h.active),
}));
vi.mock('../_lib/push', () => ({
  sendPush: vi.fn(async (userId: string) => {
    h.pushes.push({ userId });
    return { delivered: true };
  }),
}));
vi.mock('../_lib/notify', () => ({ notify: vi.fn(async () => {}) }));
vi.mock('../_lib/envelope', () => ({
  encryptField: vi.fn(async () => null),
  readField: vi.fn(async (_cid: string, _ct: unknown, plaintext: string) => plaintext),
}));
vi.mock('../_lib/log', () => ({ log: vi.fn(), errorFields: vi.fn(() => ({})), flushLogs: vi.fn(async () => {}) }));
vi.mock('../_lib/db', () => ({
  one: vi.fn(async (text: string, params: unknown[] = []) => {
    h.calls.push({ text, params });
    if (text.startsWith('SELECT sender_id, image_data, image_thumb FROM messages')) return h.message;
    if (text.startsWith('INSERT INTO messages')) return { id: 'm-new', created_at: '2026-07-19T00:00:00.000Z' };
    return undefined;
  }),
  q: vi.fn(async (text: string) => {
    h.calls.push({ text, params: [] });
    if (text.startsWith('SELECT id FROM users')) return [{ id: 'user-B' }];
    if (text.startsWith('SELECT id, sender_id, body')) return h.qResults;
    if (text.startsWith('SELECT message_id, user_id, emoji')) return h.qResults;
    return [];
  }),
}));

import handler from './messages';

function makeRes() {
  const res: any = {
    statusCode: 0,
    body: undefined,
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

describe('DELETE /api/messages/:id', () => {
  beforeEach(() => {
    h.message = { sender_id: 'user-A', image_data: null, image_thumb: null };
    h.calls.length = 0;
    h.publishes.length = 0;
  });

  it('refuses to delete a message you did not send', async () => {
    h.message = { sender_id: 'user-B', image_data: null, image_thumb: null };
    const res = makeRes();
    await handler({ method: 'DELETE', url: '/api/messages/m1', query: { id: 'm1' }, headers: {}, body: {} } as any, res);
    expect(res.statusCode).toBe(403);
  });

  it('deletes your own message and its reactions, and publishes message.deleted', async () => {
    const res = makeRes();
    await handler({ method: 'DELETE', url: '/api/messages/m1', query: { id: 'm1' }, headers: {}, body: {} } as any, res);
    expect(res.statusCode).toBe(200);
    expect(h.calls.some((c) => c.text.startsWith('DELETE FROM message_reactions'))).toBe(true);
    expect(h.calls.some((c) => c.text.startsWith('DELETE FROM messages'))).toBe(true);
    expect(h.publishes.some((p) => p.event === 'message.deleted' && (p.data as any).id === 'm1')).toBe(true);
  });
});

describe('POST /api/messages/:id (react/unreact)', () => {
  beforeEach(() => {
    h.message = { sender_id: 'user-A', image_data: null, image_thumb: null };
    h.calls.length = 0;
    h.publishes.length = 0;
  });

  it('upserts a reaction and publishes it', async () => {
    const res = makeRes();
    await handler(
      { method: 'POST', url: '/api/messages/m1', query: { id: 'm1' }, headers: {}, body: { action: 'react', emoji: '❤️' } } as any,
      res
    );
    expect(res.statusCode).toBe(200);
    const insert = h.calls.find((c) => c.text.startsWith('INSERT INTO message_reactions'));
    expect(insert!.params).toEqual(['m1', 'user-A', '❤️']);
    expect(h.publishes).toContainEqual({
      coupleId: 'couple-1',
      event: 'message.reacted',
      data: { message_id: 'm1', user_id: 'user-A', emoji: '❤️' },
    });
  });

  it('rejects a react with no emoji', async () => {
    const res = makeRes();
    await handler(
      { method: 'POST', url: '/api/messages/m1', query: { id: 'm1' }, headers: {}, body: { action: 'react' } } as any,
      res
    );
    expect(res.statusCode).toBe(400);
  });

  it('unreact deletes the row and publishes a null emoji', async () => {
    const res = makeRes();
    await handler(
      { method: 'POST', url: '/api/messages/m1', query: { id: 'm1' }, headers: {}, body: { action: 'unreact' } } as any,
      res
    );
    expect(res.statusCode).toBe(200);
    const del = h.calls.find((c) => c.text.startsWith('DELETE FROM message_reactions'));
    expect(del!.params).toEqual(['m1', 'user-A']);
    expect(h.publishes).toContainEqual({
      coupleId: 'couple-1',
      event: 'message.reacted',
      data: { message_id: 'm1', user_id: 'user-A', emoji: null },
    });
  });
});

describe('POST /api/messages (send) — presence-based push skip', () => {
  beforeEach(() => {
    h.calls.length = 0;
    h.publishes.length = 0;
    h.pushes.length = 0;
    h.active = false;
  });

  it('sends a push when the recipient is not active in chat', async () => {
    h.active = false;
    const res = makeRes();
    await handler(
      { method: 'POST', url: '/api/messages', query: {}, headers: {}, body: { body: 'hi' } } as any,
      res
    );
    expect(res.statusCode).toBe(201);
    expect(h.pushes).toEqual([{ userId: 'user-B' }]);
  });

  it('skips the push when the recipient is already on the chat screen', async () => {
    h.active = true;
    const res = makeRes();
    await handler(
      { method: 'POST', url: '/api/messages', query: {}, headers: {}, body: { body: 'hi' } } as any,
      res
    );
    expect(res.statusCode).toBe(201);
    expect(h.pushes).toEqual([]);
  });
});

describe('GET /api/messages (list) — reactions attached', () => {
  beforeEach(() => {
    h.calls.length = 0;
    h.qResults = [];
  });

  it('attaches each message its own reactions from a single batched query', async () => {
    h.qResults = [
      { id: 'm1', sender_id: 'user-A', body: 'hey', body_ct: null, image_thumb: null, has_image: false, reply_to_id: null, created_at: 't1' },
    ];
    const res = makeRes();
    // First q() call the mock sees is the message list; swap in reactions for the second.
    const dbMock = await import('../_lib/db');
    (dbMock.q as any).mockImplementationOnce(async () => h.qResults);
    (dbMock.q as any).mockImplementationOnce(async () => [{ message_id: 'm1', user_id: 'user-B', emoji: '👍' }]);

    await handler({ method: 'GET', url: '/api/messages', query: {}, headers: {}, body: {} } as any, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.messages[0].reactions).toEqual([{ user_id: 'user-B', emoji: '👍' }]);
  });
});
