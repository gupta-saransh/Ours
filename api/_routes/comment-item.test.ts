import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Guards the comment-hearts rule (mirrors note hearts): only the PARTNER can
 * heart a comment, never its author, and hearting grants no edit rights.
 */

const h = vi.hoisted(() => ({
  comment: { id: 'c1', author_id: 'user-A', memory_id: 'm1' } as Record<string, unknown> | null,
  calls: [] as { text: string; params: unknown[] }[],
  published: [] as { event: string; data: Record<string, unknown> }[],
  me: { id: 'user-A', couple_id: 'couple-1', display_name: 'A' },
}));

vi.mock('../_lib/auth', () => ({
  requirePairedUser: vi.fn(async () => h.me),
}));
vi.mock('../_lib/ably', () => ({
  publish: vi.fn(async (_cid: string, event: string, data: Record<string, unknown>) => {
    h.published.push({ event, data });
  }),
}));
vi.mock('../_lib/envelope', () => ({ encryptField: vi.fn(async () => null) }));
vi.mock('../_lib/db', () => ({
  one: vi.fn(async (text: string, params: unknown[]) => {
    h.calls.push({ text, params });
    if (text.startsWith('SELECT id, author_id, memory_id')) return h.comment;
    if (text.includes('count(*)::INT AS hearts')) return { hearts: 1 };
    return { id: 'c1' };
  }),
}));

import handler from './comment-item';

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

describe('comment hearts', () => {
  beforeEach(() => {
    h.comment = { id: 'c1', author_id: 'user-A', memory_id: 'm1' };
    h.calls.length = 0;
    h.published.length = 0;
    h.me = { id: 'user-A', couple_id: 'couple-1', display_name: 'A' };
  });

  it('lets the partner heart a comment and publishes the settled count', async () => {
    h.me = { id: 'user-B', couple_id: 'couple-1', display_name: 'B' };
    const res = makeRes();
    await handler({ method: 'PATCH', query: { id: 'c1' }, headers: {}, body: { hearted: true } } as any, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ id: 'c1', hearts: 1, hearted_by_me: true });
    const ins = h.calls.find((c) => c.text.includes('INSERT INTO comment_hearts'));
    expect(ins!.params).toEqual(['c1', 'user-B']);
    expect(h.published[0].event).toBe('comment.hearted');
  });

  it('refuses hearting your own comment (403)', async () => {
    const res = makeRes();
    await handler({ method: 'PATCH', query: { id: 'c1' }, headers: {}, body: { hearted: true } } as any, res);
    expect(res.statusCode).toBe(403);
    expect(h.calls.some((c) => c.text.includes('comment_hearts'))).toBe(false);
  });

  it('unhearting deletes only my own heart row', async () => {
    h.me = { id: 'user-B', couple_id: 'couple-1', display_name: 'B' };
    const res = makeRes();
    await handler({ method: 'PATCH', query: { id: 'c1' }, headers: {}, body: { hearted: false } } as any, res);
    const del = h.calls.find((c) => c.text.includes('DELETE FROM comment_hearts'));
    expect(del!.params).toEqual(['c1', 'user-B']);
  });

  it('hearting rights do not grant editing rights (403 on partner edit)', async () => {
    h.me = { id: 'user-B', couple_id: 'couple-1', display_name: 'B' };
    const res = makeRes();
    await handler({ method: 'PATCH', query: { id: 'c1' }, headers: {}, body: { body: 'rewritten' } } as any, res);
    expect(res.statusCode).toBe(403);
  });
});
