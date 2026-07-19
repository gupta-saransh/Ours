import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Guards the composer merge: a memory may now be a photo with NO caption (the
 * single Timeline composer lets you post either half alone), words with no
 * photo still work, and an entirely empty submission is still rejected. Also
 * pins the rule that a captionless photo stores no ciphertext.
 */

const h = vi.hoisted(() => ({
  inserts: [] as { text: string; params: unknown[] }[],
  notifications: [] as string[],
  encryptCalls: [] as string[],
}));

vi.mock('../_lib/auth', () => ({
  requirePairedUser: vi.fn(async () => ({ id: 'user-A', couple_id: 'couple-1', display_name: 'A' })),
}));
vi.mock('../_lib/ably', () => ({ publish: vi.fn(async () => {}) }));
vi.mock('../_lib/notify', () => ({
  notify: vi.fn(async (_c: string, _a: string, _k: string, text: string) => {
    h.notifications.push(text);
  }),
}));
vi.mock('../_lib/envelope', () => ({
  encryptField: vi.fn(async (_cid: string, plaintext: string) => {
    h.encryptCalls.push(plaintext);
    return Buffer.from('ct');
  }),
  readField: vi.fn(async (_cid: string, _ct: unknown, plaintext: string) => plaintext),
}));
vi.mock('../_lib/log', () => ({ log: vi.fn(), errorFields: vi.fn(() => ({})), flushLogs: vi.fn(async () => {}) }));
vi.mock('../_lib/db', () => ({
  q: vi.fn(async () => []),
  one: vi.fn(async (text: string, params: unknown[]) => {
    h.inserts.push({ text, params });
    return { id: 'm1', author_id: 'user-A', memory_date: '2026-07-19', created_at: 'now', has_photo: true };
  }),
}));

import handler from './memories';

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

const PHOTO = 'data:image/jpeg;base64,abc';
const post = (body: Record<string, unknown>) =>
  ({ method: 'POST', url: '/api/memories', query: {}, headers: {}, body }) as any;

describe('POST /api/memories', () => {
  beforeEach(() => {
    h.inserts.length = 0;
    h.notifications.length = 0;
    h.encryptCalls.length = 0;
  });

  it('accepts a photo with no caption', async () => {
    const res = makeRes();
    await handler(post({ photoData: PHOTO, thumbData: PHOTO }), res);
    expect(res.statusCode).toBe(201);
  });

  it('accepts words with no photo', async () => {
    const res = makeRes();
    await handler(post({ note: 'a backdated thought' }), res);
    expect(res.statusCode).toBe(201);
  });

  it('rejects a submission with neither words nor a photo', async () => {
    const res = makeRes();
    await handler(post({}), res);
    expect(res.statusCode).toBe(400);
  });

  it('rejects whitespace-only words with no photo', async () => {
    const res = makeRes();
    await handler(post({ note: '   ' }), res);
    expect(res.statusCode).toBe(400);
  });

  it('encrypts nothing when the photo has no caption', async () => {
    const res = makeRes();
    await handler(post({ photoData: PHOTO }), res);
    expect(res.statusCode).toBe(201);
    expect(h.encryptCalls).toEqual([]);
  });

  it('still encrypts a caption when one is written', async () => {
    const res = makeRes();
    await handler(post({ photoData: PHOTO, note: 'the sea that day' }), res);
    expect(res.statusCode).toBe(201);
    expect(h.encryptCalls).toEqual(['the sea that day']);
  });

  it('says "added a photo" for a photo, "added a memory" for words alone', async () => {
    await handler(post({ photoData: PHOTO }), makeRes());
    await handler(post({ note: 'just words' }), makeRes());
    expect(h.notifications[0]).toContain('added a photo');
    expect(h.notifications[1]).toContain('added a memory');
  });

  it('rejects a non-image photo payload', async () => {
    const res = makeRes();
    await handler(post({ photoData: 'javascript:alert(1)' }), res);
    expect(res.statusCode).toBe(400);
  });
});
