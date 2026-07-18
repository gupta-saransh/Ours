import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Guards milestone-item.ts: only the countdown window is editable via PATCH
 * (title/date/kind stay fixed once added), a bad value is rejected, an empty
 * PATCH body is rejected rather than silently no-op'd, and DELETE still works.
 */

const h = vi.hoisted(() => ({
  updated: { id: 'm1' } as Record<string, unknown> | null,
  deleted: { id: 'm1' } as Record<string, unknown> | null,
}));

vi.mock('../_lib/auth', () => ({
  requirePairedUser: vi.fn(async () => ({ id: 'user-A', couple_id: 'couple-1', display_name: 'A' })),
}));
vi.mock('../_lib/db', () => ({
  one: vi.fn(async (text: string) => {
    if (text.startsWith('UPDATE milestones')) return h.updated;
    if (text.startsWith('DELETE FROM milestones')) return h.deleted;
    return undefined;
  }),
}));

import handler from './milestone-item';

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

describe('milestone-item', () => {
  beforeEach(() => {
    h.updated = { id: 'm1' };
    h.deleted = { id: 'm1' };
  });

  it('updates the countdown window', async () => {
    const res = makeRes();
    await handler({ method: 'PATCH', query: { id: 'm1' }, headers: {}, body: { notifyDaysBefore: 3 } } as any, res);
    expect(res.statusCode).toBe(200);
  });

  it('turns the countdown off with 0', async () => {
    const res = makeRes();
    await handler({ method: 'PATCH', query: { id: 'm1' }, headers: {}, body: { notifyDaysBefore: 0 } } as any, res);
    expect(res.statusCode).toBe(200);
  });

  it('rejects a value outside 0-60 (400)', async () => {
    const res = makeRes();
    await handler({ method: 'PATCH', query: { id: 'm1' }, headers: {}, body: { notifyDaysBefore: 90 } } as any, res);
    expect(res.statusCode).toBe(400);
  });

  it('rejects an empty body instead of silently no-oping (400)', async () => {
    const res = makeRes();
    await handler({ method: 'PATCH', query: { id: 'm1' }, headers: {}, body: {} } as any, res);
    expect(res.statusCode).toBe(400);
  });

  it('404s a missing milestone', async () => {
    h.updated = null;
    const res = makeRes();
    await handler(
      { method: 'PATCH', query: { id: 'nope' }, headers: {}, body: { notifyDaysBefore: 3 } } as any,
      res
    );
    expect(res.statusCode).toBe(404);
  });

  it('still deletes', async () => {
    const res = makeRes();
    await handler({ method: 'DELETE', query: { id: 'm1' }, headers: {}, body: {} } as any, res);
    expect(res.statusCode).toBe(200);
  });
});
