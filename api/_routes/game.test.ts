import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Guards the This-or-That privacy shape: the partner's pick and guess stay
 * hidden until BOTH have played, playing twice is rejected, and only 'a'/'b'
 * are accepted. Mirrors the daily prompt's mutual-reveal rule.
 */

const h = vi.hoisted(() => ({
  rows: [] as { user_id: string; pick: string; guess: string }[],
  insertReturns: { id: 'g1' } as Record<string, unknown> | null,
  published: [] as { event: string; data: Record<string, unknown> }[],
  notified: [] as string[],
}));

vi.mock('../_lib/auth', () => ({
  requirePairedUser: vi.fn(async () => ({ id: 'user-A', couple_id: 'couple-1', display_name: 'A' })),
}));
vi.mock('../_lib/ably', () => ({
  publish: vi.fn(async (_cid: string, event: string, data: Record<string, unknown>) => {
    h.published.push({ event, data });
  }),
}));
vi.mock('../_lib/notify', () => ({
  notify: vi.fn(async (_cid: string, _actor: string, kind: string) => {
    h.notified.push(kind);
  }),
}));
vi.mock('../_lib/db', () => ({
  q: vi.fn(async () => h.rows),
  one: vi.fn(async () => h.insertReturns),
}));

import handler, { GAME_POOL, todaysGame } from './game';

function makeRes() {
  const res: any = {
    statusCode: 0,
    body: undefined as any,
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

describe('This-or-That', () => {
  beforeEach(() => {
    h.rows = [];
    h.insertReturns = { id: 'g1' };
    h.published.length = 0;
    h.notified.length = 0;
  });

  it('is deterministic for a date and always a valid pool pair', () => {
    const game = todaysGame();
    expect(GAME_POOL.some((p) => p.a === game.a && p.b === game.b)).toBe(true);
    expect(todaysGame()).toEqual(game);
  });

  it('hides the partner state before I have played (no picks leak)', async () => {
    // Partner played; I have not.
    h.rows = [{ user_id: 'user-B', pick: 'a', guess: 'b' }];
    const res = makeRes();
    await handler({ method: 'GET', query: {}, headers: {}, url: '/api/game/today' } as any, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.partnerPlayed).toBe(true);
    expect(res.body.reveal).toBeNull();
    // The serialized response must not contain their letters anywhere.
    expect(JSON.stringify(res.body)).not.toContain('partnerPick');
  });

  it('reveals only when both have played, and scores the guesses', async () => {
    h.rows = [
      { user_id: 'user-A', pick: 'a', guess: 'b' },
      { user_id: 'user-B', pick: 'b', guess: 'b' },
    ];
    const res = makeRes();
    await handler({ method: 'GET', query: {}, headers: {}, url: '/api/game/today' } as any, res);
    expect(res.body.reveal).toEqual({
      partnerPick: 'b',
      iGuessedRight: true, // I guessed b, they picked b
      theyGuessedRight: false, // they guessed b, I picked a
    });
  });

  it('rejects playing twice (409) via the conflict-free insert', async () => {
    h.insertReturns = null; // ON CONFLICT DO NOTHING returned no row
    const res = makeRes();
    await handler(
      { method: 'POST', query: {}, headers: {}, url: '/api/game/today', body: { pick: 'a', guess: 'b' } } as any,
      res
    );
    expect(res.statusCode).toBe(409);
  });

  it('rejects anything but a or b (400)', async () => {
    const res = makeRes();
    await handler(
      { method: 'POST', query: {}, headers: {}, url: '/api/game/today', body: { pick: 'coffee', guess: 'a' } } as any,
      res
    );
    expect(res.statusCode).toBe(400);
  });

  it('publishes an id-free event and notifies only on the reveal', async () => {
    // I am the second answerer: after my insert both rows exist.
    h.rows = [
      { user_id: 'user-A', pick: 'a', guess: 'b' },
      { user_id: 'user-B', pick: 'b', guess: 'a' },
    ];
    const res = makeRes();
    await handler(
      { method: 'POST', query: {}, headers: {}, url: '/api/game/today', body: { pick: 'a', guess: 'b' } } as any,
      res
    );
    expect(res.statusCode).toBe(201);
    const event = h.published.find((p) => p.event === 'game.updated');
    expect(event).toBeTruthy();
    // The event must never carry a pick or guess.
    expect(JSON.stringify(event!.data)).not.toMatch(/pick|guess/);
    expect(h.notified).toEqual(['game']);
  });
});
