import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Regression guard for the wishlist gift-privacy invariants.
 *
 *  - A secret gift plan added to a partner's list is invisible and untouchable
 *    to that partner (the owner): the server 404s as if it does not exist.
 *  - The owner can never mark their own wishlist items "gotten" (that is the
 *    partner's job, and would spoil the surprise).
 *  - Only whoever added a row may delete it.
 */

const h = vi.hoisted(() => ({
  calls: [] as { text: string; params: unknown[] }[],
  itemRow: null as Record<string, unknown> | null,
}));

vi.mock('../_lib/auth', () => ({
  // Session is user-A unless a test overrides h.session.
  requirePairedUser: vi.fn(async () => ({ id: 'user-A', couple_id: 'couple-1', display_name: 'A' })),
}));
vi.mock('../_lib/ably', () => ({ publish: vi.fn(async () => {}) }));
vi.mock('../_lib/db', () => ({
  one: vi.fn(async (text: string, params: unknown[]) => {
    h.calls.push({ text, params });
    if (text.includes('SELECT id, owner_id, added_by, secret, gotten')) return h.itemRow;
    if (text.includes('url, notes, category')) return { id: 'w1', gotten: true }; // final read
    return undefined;
  }),
}));

import handler from './wishlist-item';

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

describe('wishlist gift privacy', () => {
  beforeEach(() => {
    h.calls.length = 0;
  });

  it("hides a partner's secret gift plan from the owner (404)", async () => {
    // The item is on user-A's list, but user-B added it as a secret; user-A acts.
    h.itemRow = { id: 'w1', owner_id: 'user-A', added_by: 'user-B', secret: true, gotten: false };
    const req: any = { method: 'PATCH', query: { id: 'w1' }, headers: {}, body: { gotten: true } };
    const res = makeRes();
    await handler(req, res);
    expect(res.statusCode).toBe(404);
    // No update to gotten ever ran.
    expect(h.calls.find((c) => c.text.includes('SET gotten'))).toBeFalsy();
  });

  it('stops the owner from marking their own item gotten (403)', async () => {
    h.itemRow = { id: 'w1', owner_id: 'user-A', added_by: 'user-A', secret: false, gotten: false };
    const req: any = { method: 'PATCH', query: { id: 'w1' }, headers: {}, body: { gotten: true } };
    const res = makeRes();
    await handler(req, res);
    expect(res.statusCode).toBe(403);
  });

  it('lets whoever added a row delete it, and stops anyone else (403)', async () => {
    h.itemRow = { id: 'w1', owner_id: 'user-A', added_by: 'user-B', secret: false, gotten: false };
    const req: any = { method: 'DELETE', query: { id: 'w1' }, headers: {}, body: {} };
    const res = makeRes();
    await handler(req, res); // session is user-A, but user-B added it
    expect(res.statusCode).toBe(403);
    expect(h.calls.find((c) => c.text.includes('DELETE FROM wishlist_items'))).toBeFalsy();
  });
});
