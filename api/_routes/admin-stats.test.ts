import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Guards the rebuilt admin stats endpoint: admin auth is required, the
 * response never leaks a full couple id or any content, and a missing newer
 * table (a deploy running ahead of `npm run migrate`) degrades to zeroes
 * instead of failing the whole dashboard.
 */

const h = vi.hoisted(() => ({
  admitted: true,
  /** SQL fragments that should throw, simulating a table that does not exist yet. */
  missingTables: [] as string[],
  queries: [] as string[],
}));

vi.mock('../_lib/admin', async () => {
  // The real HttpError, so route() maps it to a 401 exactly as in production.
  const { HttpError } = await vi.importActual<typeof import('../_lib/respond')>('../_lib/respond');
  return {
    requireAdmin: vi.fn(() => {
      if (!h.admitted) throw new HttpError(401, 'Not signed in');
    }),
  };
});
vi.mock('../_lib/log', () => ({ log: vi.fn(), errorFields: vi.fn(() => ({})), flushLogs: vi.fn(async () => {}) }));

function reject(text: string): boolean {
  return h.missingTables.some((t) => text.includes(t));
}

vi.mock('../_lib/db', () => ({
  one: vi.fn(async (text: string) => {
    h.queries.push(text);
    if (reject(text)) throw new Error('relation does not exist');
    if (text.includes('FILTER (WHERE n = 2)')) return { paired: 3, solo: 1 };
    if (text.includes('current_streak_days')) return { on_streak: 2, longest_ever: 9, avg_current: 4 };
    if (text.includes('AS couples')) {
      return { couples: 4, users: 7, encrypted_couples: 4, memories: 10, notes: 5, milestones: 2, prompts: 8, comments: 1, dates: 3, wishlist: 2, messages: 40, bucket: 6, bucket_done: 2 };
    }
    return { n: 5 };
  }),
  q: vi.fn(async (text: string) => {
    h.queries.push(text);
    if (reject(text)) throw new Error('relation does not exist');
    if (text.includes('FROM couples ORDER BY')) {
      return [{ id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', created_at: '2026-01-01', encrypted: true }];
    }
    if (text.includes('AS members')) return [{ couple_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', members: 2 }];
    if (text.includes('max(created_at)')) {
      return [{ couple_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', last_active: new Date().toISOString() }];
    }
    if (text.includes('GROUP BY couple_id, src')) {
      return [{ couple_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', src: 'memories', n: 10 }];
    }
    if (text.includes('GROUP BY day, src')) return [];
    if (text.includes('FROM users WHERE created_at')) return [];
    return [];
  }),
}));

import handler from './admin-stats';

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

const req = () => ({ method: 'GET', url: '/api/admin/stats', query: {}, headers: {}, body: {} }) as any;

describe('GET /api/admin/stats', () => {
  beforeEach(() => {
    h.admitted = true;
    h.missingTables = [];
    h.queries.length = 0;
  });

  it('401s without a valid admin token', async () => {
    h.admitted = false;
    const res = makeRes();
    await handler(req(), res);
    expect(res.statusCode).toBe(401);
  });

  it('returns the full report for an admin', async () => {
    const res = makeRes();
    await handler(req(), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty('generatedAt');
    expect(res.body.signups).toHaveLength(30);
    expect(res.body.activity).toHaveLength(30);
    expect(res.body.totals.couples).toBe(4);
  });

  it('never exposes a full couple id', async () => {
    const res = makeRes();
    await handler(req(), res);
    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toContain('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
    expect(res.body.couples[0].id).toBe('aaaaaaaa');
  });

  it('counts a couple active in the last week', async () => {
    const res = makeRes();
    await handler(req(), res);
    expect(res.body.activeCouples).toBe(1);
  });

  it('degrades to zero (not a 500) when a newer table is missing', async () => {
    h.missingTables = ['message_reactions'];
    const res = makeRes();
    await handler(req(), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.totals.reactions).toBe(0);
  });

  it('falls back to the legacy source list when todos is missing', async () => {
    h.missingTables = ['FROM todos'];
    const res = makeRes();
    await handler(req(), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.activity).toHaveLength(30);
    expect(res.body.couples[0].total).toBe(10);
  });

  it('uses grouped queries, never a per-couple correlated subquery', async () => {
    const res = makeRes();
    await handler(req(), res);
    expect(res.statusCode).toBe(200);
    // The old shape ran one subquery per couple row inside the couples SELECT.
    const coupleListQuery = h.queries.find((t) => t.includes('FROM couples ORDER BY'))!;
    expect(coupleListQuery).not.toContain('SELECT count(*)::int FROM memories m WHERE');
    expect(h.queries.some((t) => t.includes('GROUP BY couple_id, src'))).toBe(true);
  });
});
