import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Guards the countdown window at creation: defaults to 7 days (the user's
 * explicit choice, so existing milestones start with reminders on rather than
 * needing an opt-in), accepts an explicit value, and rejects anything outside
 * a sane 0-60 range.
 */

const h = vi.hoisted(() => ({
  calls: [] as { text: string; params: unknown[] }[],
  insertRow: { id: 'm1' } as Record<string, unknown> | null,
}));

vi.mock('../_lib/auth', () => ({
  requirePairedUser: vi.fn(async () => ({ id: 'user-A', couple_id: 'couple-1', display_name: 'A' })),
}));
vi.mock('../_lib/notify', () => ({ notify: vi.fn(async () => {}) }));
vi.mock('../_lib/db', () => ({
  q: vi.fn(async () => []),
  one: vi.fn(async (text: string, params: unknown[]) => {
    h.calls.push({ text, params });
    if (text.startsWith('INSERT INTO milestones')) return h.insertRow;
    return undefined;
  }),
}));

import handler from './milestones';

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

describe('POST /api/milestones', () => {
  beforeEach(() => {
    h.calls.length = 0;
    h.insertRow = { id: 'm1' };
  });

  it('defaults the countdown window to 7 days', async () => {
    const req: any = {
      method: 'POST',
      query: {},
      headers: {},
      body: { title: 'Her birthday', date: '1998-08-12', kind: 'birthday' },
    };
    const res = makeRes();
    await handler(req, res);
    expect(res.statusCode).toBe(201);
    const insert = h.calls.find((c) => c.text.startsWith('INSERT INTO milestones'));
    expect(insert!.params).toContain(7);
  });

  it('accepts an explicit countdown window', async () => {
    const req: any = {
      method: 'POST',
      query: {},
      headers: {},
      body: { title: 'Trip to the coast', date: '2027-03-01', kind: 'custom', notifyDaysBefore: 3 },
    };
    const res = makeRes();
    await handler(req, res);
    expect(res.statusCode).toBe(201);
    const insert = h.calls.find((c) => c.text.startsWith('INSERT INTO milestones'));
    expect(insert!.params).toContain(3);
  });

  it('rejects a negative countdown window (400)', async () => {
    const req: any = {
      method: 'POST',
      query: {},
      headers: {},
      body: { title: 'X', date: '2027-03-01', kind: 'custom', notifyDaysBefore: -1 },
    };
    const res = makeRes();
    await handler(req, res);
    expect(res.statusCode).toBe(400);
  });

  it('rejects a countdown window over 60 days (400)', async () => {
    const req: any = {
      method: 'POST',
      query: {},
      headers: {},
      body: { title: 'X', date: '2027-03-01', kind: 'custom', notifyDaysBefore: 61 },
    };
    const res = makeRes();
    await handler(req, res);
    expect(res.statusCode).toBe(400);
  });
});
