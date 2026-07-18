import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Guards the shared to-do list's write path: a malformed date is rejected, an
 * assignee must actually be a member of the couple, and the notification text
 * differs depending on who something was added for (never the encrypted title).
 */

const h = vi.hoisted(() => ({
  calls: [] as { text: string; params: unknown[] }[],
  memberRow: { id: 'user-B' } as Record<string, unknown> | null,
  insertRow: { id: 't1', author_id: 'user-A', assignee_id: null, due_date: '2026-07-20', done: false, done_by: null, done_at: null, created_at: '2026-07-19T00:00:00Z' } as Record<string, unknown> | null,
  notified: [] as string[],
}));

vi.mock('../_lib/auth', () => ({
  requirePairedUser: vi.fn(async () => ({ id: 'user-A', couple_id: 'couple-1', display_name: 'A' })),
}));
vi.mock('../_lib/ably', () => ({ publish: vi.fn(async () => {}) }));
vi.mock('../_lib/notify', () => ({
  notify: vi.fn(async (_cid: string, _actor: string, _kind: string, text: string) => {
    h.notified.push(text);
  }),
}));
vi.mock('../_lib/envelope', () => ({
  encryptField: vi.fn(async () => null),
  readField: vi.fn(async (_cid: string, _ct: unknown, plain: unknown) => plain ?? null),
}));
vi.mock('../_lib/db', () => ({
  q: vi.fn(async () => []),
  one: vi.fn(async (text: string, params: unknown[]) => {
    h.calls.push({ text, params });
    if (text.startsWith('SELECT id FROM users')) return h.memberRow;
    if (text.startsWith('INSERT INTO todos')) return h.insertRow;
    if (text.includes('count(*) AS n')) return { n: '0', earliest_due: null };
    return undefined;
  }),
}));

import handler, { monthBounds, readDate } from './todos';

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

describe('readDate', () => {
  it('accepts a real YYYY-MM-DD date', () => {
    expect(readDate('2026-07-20')).toBe('2026-07-20');
  });
  it('falls back when nothing was sent', () => {
    expect(readDate(undefined, '2026-01-01')).toBe('2026-01-01');
  });
  it('rejects a malformed string', () => {
    expect(() => readDate('20-07-2026')).toThrow();
  });
  it('rejects a calendar date that does not exist', () => {
    expect(() => readDate('2026-02-31')).toThrow();
  });
});

describe('monthBounds', () => {
  it('spans the whole month, including a 31-day one', () => {
    expect(monthBounds('2026-07-15')).toEqual({ from: '2026-07-01', to: '2026-07-31' });
  });
  it('handles February correctly in a leap year', () => {
    expect(monthBounds('2028-02-10')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
  });
});

describe('POST /api/todos', () => {
  beforeEach(() => {
    h.calls.length = 0;
    h.notified.length = 0;
    h.memberRow = { id: 'user-B' };
  });

  it('rejects a malformed due date (400)', async () => {
    const req: any = { method: 'POST', query: {}, headers: {}, body: { title: 'Submit assignment', dueDate: 'not-a-date' } };
    const res = makeRes();
    await handler(req, res);
    expect(res.statusCode).toBe(400);
  });

  it('rejects an assignee who is not in the couple (400)', async () => {
    h.memberRow = null;
    const req: any = {
      method: 'POST',
      query: {},
      headers: {},
      body: { title: 'Submit assignment', dueDate: '2026-07-20', assigneeId: 'stranger' },
    };
    const res = makeRes();
    await handler(req, res);
    expect(res.statusCode).toBe(400);
  });

  it('creates a "both of us" item by default and notifies generically', async () => {
    const req: any = { method: 'POST', query: {}, headers: {}, body: { title: 'Submit assignment', dueDate: '2026-07-20' } };
    const res = makeRes();
    await handler(req, res);
    expect(res.statusCode).toBe(201);
    expect(h.notified[0]).toContain('shared list');
  });

  it('notifies the specific partner when it is assigned to them', async () => {
    const req: any = {
      method: 'POST',
      query: {},
      headers: {},
      body: { title: 'Submit assignment', dueDate: '2026-07-20', assigneeId: 'user-B' },
    };
    const res = makeRes();
    await handler(req, res);
    expect(h.notified[0]).toContain('your list');
    // The encrypted title must never appear in the plaintext notification text.
    expect(h.notified[0]).not.toContain('Submit assignment');
  });
});
