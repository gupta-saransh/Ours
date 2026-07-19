import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NAME_DELIM } from '../_lib/admin-aggregate';

/**
 * Guards the rebuilt admin stats endpoint: admin auth is required, the window
 * is validated rather than trusted, the response carries names but never a full
 * couple id or any content, and a missing newer table (a deploy running ahead
 * of `npm run migrate`) degrades to zeroes instead of failing the dashboard.
 */

const COUPLE = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

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
    if (text.includes('AS spaces')) return { spaces: 7, paired: 6, solo: 1, empty: 5 };
    if (text.includes('AS no_push')) return { no_push: 4, notifs_off: 2, unpaired_people: 0 };
    if (text.includes('current_streak_days')) return { on_streak: 2, longest_ever: 9, avg_current: 4 };
    if (text.includes('AS messages')) {
      return { messages: 326, memories: 18, notes: 23, prompts: 25, comments: 14, dates: 7, bucket: 16, wishlist: 10, milestones: 17 };
    }
    return { n: 5 };
  }),
  q: vi.fn(async (text: string) => {
    h.queries.push(text);
    if (reject(text)) throw new Error('relation does not exist');
    if (text.includes('FROM couples ORDER BY')) {
      return [{ id: COUPLE, created_at: '2026-07-11', encrypted: true, streak: 3 }];
    }
    if (text.includes('string_agg')) {
      return [{ couple_id: COUPLE, members: 2, names: `Anisha${NAME_DELIM}Saransh` }];
    }
    if (text.includes('max(created_at)')) {
      return [{ couple_id: COUPLE, last_active: new Date().toISOString() }];
    }
    if (text.includes('GROUP BY couple_id, src')) return [{ couple_id: COUPLE, src: 'memories', n: 10 }];
    if (text.includes('DISTINCT created_at')) return [{ day: '2026-07-19', couple_id: COUPLE }];
    if (text.includes('GROUP BY day, src')) return [];
    if (text.includes('GROUP BY src')) return [{ src: 'messages', n: 20 }];
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

const req = (query: Record<string, string> = {}) =>
  ({ method: 'GET', url: '/api/admin/stats', query, headers: {}, body: {} }) as any;

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
    expect(res.body.activity).toHaveLength(30);
    expect(res.body.kpis).toHaveProperty('activeSpaces');
  });

  it('defaults to a 30 day window and honours an allowed one', async () => {
    const a = makeRes();
    await handler(req(), a);
    expect(a.body.window.days).toBe(30);

    const b = makeRes();
    await handler(req({ days: '7' }), b);
    expect(b.body.window.days).toBe(7);
    expect(b.body.activity).toHaveLength(7);
  });

  it('rejects an arbitrary window rather than interpolating it into SQL', async () => {
    // `days` reaches an INTERVAL literal, so it must never be caller-controlled.
    const res = makeRes();
    await handler(req({ days: '999; DROP TABLE users' }), res);
    expect(res.body.window.days).toBe(30);
    expect(h.queries.join(' ')).not.toContain('DROP TABLE');
  });

  it('counts spaces as couples WITH members, not couple rows', async () => {
    // The headline bug: 12 couple rows, 5 of them empty, 7 real spaces.
    const res = makeRes();
    await handler(req(), res);
    expect(res.body.membership.spaces).toBe(7);
    expect(res.body.membership.paired + res.body.membership.solo).toBe(7);
    expect(res.body.membership.empty).toBe(5);
  });

  it('surfaces delivery health, not just growth', async () => {
    const res = makeRes();
    await handler(req(), res);
    expect(res.body.health.noPushSubscription).toBe(4);
    expect(res.body.health.notificationsOff).toBe(2);
    expect(res.body.health.emptySpaces).toBe(5);
  });

  it('carries member names for the leaderboard', async () => {
    const res = makeRes();
    await handler(req(), res);
    expect(res.body.couples[0].names).toEqual(['Anisha', 'Saransh']);
  });

  it('never exposes a full couple id', async () => {
    const res = makeRes();
    await handler(req(), res);
    expect(JSON.stringify(res.body)).not.toContain(COUPLE);
    expect(res.body.couples[0].id).toBe('aaaaaaaa');
  });

  it('never selects any content column or an email', async () => {
    const res = makeRes();
    await handler(req(), res);
    const sql = h.queries.join(' ').toLowerCase();
    for (const forbidden of ['body_ct', 'note_ct', 'title_ct', 'photo_data', 'thumb_data', 'email', 'password_hash']) {
      expect(sql).not.toContain(forbidden);
    }
  });

  it('gives each KPI a baseline and a sparkline', async () => {
    const res = makeRes();
    await handler(req(), res);
    const k = res.body.kpis;
    expect(k.content).toHaveProperty('previous');
    expect(k.content).toHaveProperty('deltaPct');
    expect(Array.isArray(k.activeSpaces.spark)).toBe(true);
  });

  it('degrades to zero (not a 500) when a newer table is missing', async () => {
    h.missingTables = ['message_reactions'];
    const res = makeRes();
    await handler(req(), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.engagement.reactions).toBe(0);
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
