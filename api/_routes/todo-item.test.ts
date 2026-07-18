import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Guards the shared-list permission split: EITHER partner may tick something
 * off, move it to another day, or reassign it (that is the point of a shared
 * list), but only whoever ADDED an item may reword or delete it. Also guards
 * that a day-move publishes the day it left, so a partner watching that day
 * live notices the item disappear.
 */

const h = vi.hoisted(() => ({
  calls: [] as { text: string; params: unknown[] }[],
  existing: null as Record<string, unknown> | null,
  updated: null as Record<string, unknown> | null,
  published: [] as { event: string; data: Record<string, unknown> }[],
  notified: [] as string[],
}));

// Session is user-B throughout; `existing.author_id` varies per test.
vi.mock('../_lib/auth', () => ({
  requirePairedUser: vi.fn(async () => ({ id: 'user-B', couple_id: 'couple-1', display_name: 'B' })),
}));
vi.mock('../_lib/ably', () => ({
  publish: vi.fn(async (_cid: string, event: string, data: Record<string, unknown>) => {
    h.published.push({ event, data });
  }),
}));
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
  one: vi.fn(async (text: string, params: unknown[]) => {
    h.calls.push({ text, params });
    if (text.startsWith('SELECT id, author_id, assignee_id, due_date')) return h.existing;
    if (text.startsWith('UPDATE todos')) return h.updated;
    if (text.startsWith('DELETE FROM todos')) return h.existing ? { id: h.existing.id } : null;
    return undefined;
  }),
}));

import handler from './todo-item';

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

const row = (over: Record<string, unknown> = {}) => ({
  id: 't1',
  author_id: 'user-A',
  assignee_id: null,
  due_date: '2026-07-20',
  done: false,
  ...over,
});

describe('todo item permissions', () => {
  beforeEach(() => {
    h.calls.length = 0;
    h.published.length = 0;
    h.notified.length = 0;
  });

  it('lets the non-author tick it off (the whole point of a shared list)', async () => {
    h.existing = row(); // authored by user-A, session is user-B
    h.updated = { ...row(), title: 'X', title_ct: null, done: true, done_by: 'user-B', done_at: '2026-07-20T00:00:00Z', created_at: '2026-07-19T00:00:00Z' };
    const res = makeRes();
    await handler({ method: 'PATCH', query: { id: 't1' }, headers: {}, body: { done: true } } as any, res);
    expect(res.statusCode).toBe(200);
    expect(h.notified[0]).toContain('ticked something off');
  });

  it('stops the non-author from rewording it (403)', async () => {
    h.existing = row();
    const res = makeRes();
    await handler({ method: 'PATCH', query: { id: 't1' }, headers: {}, body: { title: 'Rewritten' } } as any, res);
    expect(res.statusCode).toBe(403);
  });

  it('stops the non-author from deleting it (403)', async () => {
    h.existing = row();
    const res = makeRes();
    await handler({ method: 'DELETE', query: { id: 't1' }, headers: {}, body: {} } as any, res);
    expect(res.statusCode).toBe(403);
  });

  it('lets the author delete their own item', async () => {
    h.existing = row({ author_id: 'user-B' });
    const res = makeRes();
    await handler({ method: 'DELETE', query: { id: 't1' }, headers: {}, body: {} } as any, res);
    expect(res.statusCode).toBe(200);
  });

  it('lets the non-author move it to another day', async () => {
    h.existing = row();
    h.updated = { ...row(), due_date: '2026-07-21', title: 'X', title_ct: null, created_at: '2026-07-19T00:00:00Z' };
    const res = makeRes();
    await handler({ method: 'PATCH', query: { id: 't1' }, headers: {}, body: { dueDate: '2026-07-21' } } as any, res);
    expect(res.statusCode).toBe(200);
  });

  it('publishes the day an item left, so a partner watching it live notices', async () => {
    h.existing = row({ due_date: '2026-07-20' });
    h.updated = { ...row(), due_date: '2026-07-21', title: 'X', title_ct: null, created_at: '2026-07-19T00:00:00Z' };
    const res = makeRes();
    await handler({ method: 'PATCH', query: { id: 't1' }, headers: {}, body: { dueDate: '2026-07-21' } } as any, res);
    const evt = h.published.find((p) => p.event === 'todo.updated');
    expect(evt!.data).toMatchObject({ due_date: '2026-07-21', previous_due_date: '2026-07-20' });
  });

  it('omits previous_due_date when the day did not change', async () => {
    h.existing = row({ due_date: '2026-07-20' });
    h.updated = { ...row(), done: true, title: 'X', title_ct: null, done_by: 'user-B', done_at: '2026-07-20T00:00:00Z', created_at: '2026-07-19T00:00:00Z' };
    const res = makeRes();
    await handler({ method: 'PATCH', query: { id: 't1' }, headers: {}, body: { done: true } } as any, res);
    const evt = h.published.find((p) => p.event === 'todo.updated');
    expect(evt!.data.previous_due_date).toBeUndefined();
  });

  it('404s an item from another couple (or already gone)', async () => {
    h.existing = null;
    const res = makeRes();
    await handler({ method: 'PATCH', query: { id: 'nope' }, headers: {}, body: { done: true } } as any, res);
    expect(res.statusCode).toBe(404);
  });
});
