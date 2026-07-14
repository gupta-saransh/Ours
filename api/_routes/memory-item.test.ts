import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Regression guard for the "likes are per-user" invariant (P0.2).
 *
 * A ♥ on a memory is keyed by (memory_id, user_id). The route must only ever
 * insert or delete the CALLER's own row, taking the user id from the verified
 * JWT session and never from the request body. This proves Partner B can never
 * remove Partner A's like, no matter what they send.
 */

// vi.hoisted() runs before the mock factories and the module-under-test import,
// so this shared state is safely initialised when the mocked `one` is called.
const h = vi.hoisted(() => ({
  calls: [] as { text: string; params: unknown[] }[],
  memoryRow: null as Record<string, unknown> | null,
}));

vi.mock('../_lib/auth', () => ({
  // The session is Partner B; the memory under test was authored by Partner A.
  requirePairedUser: vi.fn(async () => ({
    id: 'user-B',
    couple_id: 'couple-1',
    display_name: 'Partner B',
  })),
}));
vi.mock('../_lib/ably', () => ({ publish: vi.fn(async () => {}) }));
vi.mock('../_lib/notify', () => ({ notify: vi.fn(async () => {}) }));
vi.mock('../_lib/db', () => ({
  one: vi.fn(async (text: string, params: unknown[]) => {
    h.calls.push({ text, params });
    if (text.includes('SELECT id, author_id')) return h.memoryRow;
    if (text.includes('count(*)')) return { n: 1 };
    return undefined;
  }),
}));

import handler from './memory-item';

function makeRes() {
  const res: {
    statusCode: number;
    body: unknown;
    headers: Record<string, string>;
    setHeader(k: string, v: string): void;
    status(code: number): typeof res;
    json(payload: unknown): typeof res;
    end(): typeof res;
  } = {
    statusCode: 0,
    body: undefined,
    headers: {},
    setHeader(k, v) {
      this.headers[k] = v;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    end() {
      return this;
    },
  };
  return res;
}

function deleteHeartCall() {
  return h.calls.find((c) => c.text.includes('DELETE FROM memory_hearts WHERE memory_id = $1 AND user_id'));
}

describe('memory hearts are per-user', () => {
  beforeEach(() => {
    h.calls.length = 0;
    h.memoryRow = { id: 'mem-1', author_id: 'user-A', sealed_until: null, capsule_opened_at: null };
  });

  it("un-hearting only deletes the caller's own row, keyed by the JWT user id", async () => {
    const req = { method: 'PATCH', query: { id: 'mem-1' }, headers: {}, body: { hearted: false } };
    const res = makeRes();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handler(req as any, res as any);

    const del = deleteHeartCall();
    expect(del).toBeTruthy();
    // user_id parameter is Partner B (the session), never Partner A (the author).
    expect(del!.params).toEqual(['mem-1', 'user-B']);
    expect(del!.params).not.toContain('user-A');
  });

  it('ignores any user id smuggled in the request body', async () => {
    const req = {
      method: 'PATCH',
      query: { id: 'mem-1' },
      headers: {},
      body: { hearted: false, userId: 'user-A', user_id: 'user-A', by: 'user-A' },
    };
    const res = makeRes();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handler(req as any, res as any);

    const del = deleteHeartCall();
    // Still Partner B: the payload cannot redirect the delete at Partner A's row.
    expect(del!.params).toEqual(['mem-1', 'user-B']);
  });
});
