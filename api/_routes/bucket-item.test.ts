import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Guards the shared "Ours" list behaviour: completing an item stamps its
 * completed_at (so it stays on the list, dated), un-completing clears it, and a
 * bad category is rejected.
 */

const h = vi.hoisted(() => ({
  calls: [] as { text: string; params: unknown[] }[],
  itemRow: { id: 'b1' } as Record<string, unknown> | null,
}));

vi.mock('../_lib/auth', () => ({
  requirePairedUser: vi.fn(async () => ({ id: 'user-A', couple_id: 'couple-1', display_name: 'A' })),
}));
vi.mock('../_lib/ably', () => ({ publish: vi.fn(async () => {}) }));
vi.mock('../_lib/db', () => ({
  one: vi.fn(async (text: string, params: unknown[]) => {
    h.calls.push({ text, params });
    if (text.startsWith('SELECT id FROM bucket_items')) return h.itemRow;
    return { id: 'b1', done: true, completed_at: '2026-07-17' }; // updates / final read
  }),
}));

import handler from './bucket-item';

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

describe('bucket item completion', () => {
  beforeEach(() => {
    h.calls.length = 0;
    h.itemRow = { id: 'b1' };
  });

  it('stamps completed_at when an item is marked done', async () => {
    const req: any = { method: 'PATCH', query: { id: 'b1' }, headers: {}, body: { done: true } };
    const res = makeRes();
    await handler(req, res);
    expect(res.statusCode).toBe(200);
    const upd = h.calls.find((c) => c.text.includes('SET done = $2, completed_at = CASE'));
    expect(upd).toBeTruthy();
    expect(upd!.params).toEqual(['b1', true]);
  });

  it('clears completed_at when an item is un-done', async () => {
    const req: any = { method: 'PATCH', query: { id: 'b1' }, headers: {}, body: { done: false } };
    const res = makeRes();
    await handler(req, res);
    const upd = h.calls.find((c) => c.text.includes('completed_at = CASE'));
    expect(upd!.params).toEqual(['b1', false]);
  });

  it('rejects an unknown category (400)', async () => {
    const req: any = { method: 'PATCH', query: { id: 'b1' }, headers: {}, body: { category: 'nonsense' } };
    const res = makeRes();
    await handler(req, res);
    expect(res.statusCode).toBe(400);
  });

  it('404s a missing item', async () => {
    h.itemRow = null;
    const req: any = { method: 'PATCH', query: { id: 'nope' }, headers: {}, body: { done: true } };
    const res = makeRes();
    await handler(req, res);
    expect(res.statusCode).toBe(404);
  });
});
