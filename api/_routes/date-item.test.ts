import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Guards the date-proposal state machine:
 *  - only an accepted date can be "completed" (logged after it happens);
 *  - the proposer cannot accept their own proposal (their partner decides);
 *  - an already-resolved proposal cannot be acted on again;
 *  - completing an accepted date stamps completed_at.
 */

const h = vi.hoisted(() => ({
  calls: [] as { text: string; params: unknown[] }[],
  proposalRow: null as Record<string, unknown> | null,
  finalRow: null as Record<string, unknown> | null,
}));

vi.mock('../_lib/auth', () => ({
  // Session is user-B (the partner) throughout.
  requirePairedUser: vi.fn(async () => ({ id: 'user-B', couple_id: 'couple-1', display_name: 'B' })),
}));
vi.mock('../_lib/ably', () => ({ publish: vi.fn(async () => {}) }));
vi.mock('../_lib/notify', () => ({ notify: vi.fn(async () => {}) }));
vi.mock('../_lib/envelope', () => ({
  encryptField: vi.fn(async () => null),
  readField: vi.fn(async (_cid: string, _ct: unknown, plain: unknown) => plain ?? null),
}));
vi.mock('../_lib/db', () => ({
  getPool: () => ({ connect: async () => ({ query: async () => ({ rows: [{ id: 'x' }] }), release() {} }) }),
  one: vi.fn(async (text: string, params: unknown[]) => {
    h.calls.push({ text, params });
    if (text.includes('FROM date_proposals WHERE id = $1 AND couple_id = $2')) return h.proposalRow;
    if (text.includes('reflection_ct')) return h.finalRow;
    return undefined;
  }),
}));

import handler from './date-item';

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

describe('date proposal actions', () => {
  beforeEach(() => {
    h.calls.length = 0;
  });

  it('refuses to complete a date that was not accepted (409)', async () => {
    h.proposalRow = { id: 'd1', proposer_id: 'user-A', title: 'X', title_ct: null, location: null, location_ct: null, proposed_for: null, status: 'open' };
    const req: any = { method: 'PATCH', query: { id: 'd1' }, headers: {}, body: { action: 'complete', rating: 5 } };
    const res = makeRes();
    await handler(req, res);
    expect(res.statusCode).toBe(409);
  });

  it('stops the proposer from accepting their own proposal (403)', async () => {
    // Proposer is user-B, and the session is user-B.
    h.proposalRow = { id: 'd1', proposer_id: 'user-B', title: 'X', title_ct: null, location: null, location_ct: null, proposed_for: null, status: 'open' };
    const req: any = { method: 'PATCH', query: { id: 'd1' }, headers: {}, body: { action: 'accept' } };
    const res = makeRes();
    await handler(req, res);
    expect(res.statusCode).toBe(403);
  });

  it('refuses to act on an already-resolved proposal (409)', async () => {
    h.proposalRow = { id: 'd1', proposer_id: 'user-A', title: 'X', title_ct: null, location: null, location_ct: null, proposed_for: null, status: 'accepted' };
    const req: any = { method: 'PATCH', query: { id: 'd1' }, headers: {}, body: { action: 'accept' } };
    const res = makeRes();
    await handler(req, res);
    expect(res.statusCode).toBe(409);
  });

  it('completes an accepted date and stamps completed_at', async () => {
    h.proposalRow = { id: 'd1', proposer_id: 'user-A', title: 'X', title_ct: null, location: null, location_ct: null, proposed_for: '2026-01-01', status: 'accepted' };
    h.finalRow = { id: 'd1', proposer_id: 'user-A', title: 'X', title_ct: null, location: null, location_ct: null, reflection: 'lovely', reflection_ct: null, status: 'accepted', rating: 5 };
    const req: any = { method: 'PATCH', query: { id: 'd1' }, headers: {}, body: { action: 'complete', rating: 5, reflection: 'lovely' } };
    const res = makeRes();
    await handler(req, res);
    expect(res.statusCode).toBe(200);
    const upd = h.calls.find((c) => c.text.includes('completed_at = now()'));
    expect(upd).toBeTruthy();
    expect((res.body as any).proposal.reflection).toBe('lovely');
  });
});
