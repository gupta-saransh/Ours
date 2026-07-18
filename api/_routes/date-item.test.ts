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

/**
 * Editing and removing a date. The ownership rule: an OPEN proposal is still
 * just an idea and belongs to whoever proposed it, but an ACCEPTED date is a
 * shared plan, so either partner may change or call it off (the same exception
 * memories already make). Session is user-B throughout.
 */
describe('editing and removing a date', () => {
  const open = (proposer: string) => ({
    id: 'd1', proposer_id: proposer, title: 'X', title_ct: null, location: null,
    location_ct: null, proposed_for: '2026-08-14', status: 'open', milestone_id: null, completed_at: null,
  });
  const accepted = (proposer: string, extra: Record<string, unknown> = {}) => ({
    ...open(proposer), status: 'accepted', milestone_id: 'm1', ...extra,
  });

  beforeEach(() => {
    h.calls.length = 0;
    h.finalRow = { id: 'd1', proposer_id: 'user-A', title: 'New', title_ct: null, location: null, location_ct: null, status: 'accepted' };
  });

  it('lets the proposer edit their own open proposal', async () => {
    h.proposalRow = open('user-B');
    const res = makeRes();
    await handler(
      { method: 'PATCH', query: { id: 'd1' }, headers: {}, body: { action: 'edit', title: 'New' } } as any,
      res
    );
    expect(res.statusCode).toBe(200);
  });

  it('stops the other partner editing an open proposal (403)', async () => {
    h.proposalRow = open('user-A'); // proposed by the OTHER person
    const res = makeRes();
    await handler(
      { method: 'PATCH', query: { id: 'd1' }, headers: {}, body: { action: 'edit', title: 'Mine now' } } as any,
      res
    );
    expect(res.statusCode).toBe(403);
  });

  it('lets either partner edit an accepted date (it belongs to both)', async () => {
    h.proposalRow = accepted('user-A');
    const res = makeRes();
    await handler(
      { method: 'PATCH', query: { id: 'd1' }, headers: {}, body: { action: 'edit', title: 'New' } } as any,
      res
    );
    expect(res.statusCode).toBe(200);
  });

  it('refuses to edit a date that was already logged (409)', async () => {
    h.proposalRow = accepted('user-A', { completed_at: '2026-08-15' });
    const res = makeRes();
    await handler(
      { method: 'PATCH', query: { id: 'd1' }, headers: {}, body: { action: 'edit', title: 'New' } } as any,
      res
    );
    expect(res.statusCode).toBe(409);
  });

  it('rejects a malformed date on edit (400)', async () => {
    h.proposalRow = accepted('user-A');
    const res = makeRes();
    await handler(
      { method: 'PATCH', query: { id: 'd1' }, headers: {}, body: { action: 'edit', title: 'New', proposedFor: '14-08-2026' } } as any,
      res
    );
    expect(res.statusCode).toBe(400);
  });

  it('deletes an accepted date for either partner', async () => {
    h.proposalRow = accepted('user-A');
    const res = makeRes();
    await handler({ method: 'DELETE', query: { id: 'd1' }, headers: {}, body: {} } as any, res);
    expect(res.statusCode).toBe(200);
  });

  it('stops the other partner deleting someone elses open proposal (403)', async () => {
    h.proposalRow = open('user-A');
    const res = makeRes();
    await handler({ method: 'DELETE', query: { id: 'd1' }, headers: {}, body: {} } as any, res);
    expect(res.statusCode).toBe(403);
  });

  it('404s a proposal from another couple', async () => {
    h.proposalRow = null; // the couple_id filter found nothing
    const res = makeRes();
    await handler({ method: 'DELETE', query: { id: 'nope' }, headers: {}, body: {} } as any, res);
    expect(res.statusCode).toBe(404);
  });
});
