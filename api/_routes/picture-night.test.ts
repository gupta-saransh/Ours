import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Guards the parts of the shared board that only exist at the route level: the
 * mystery film's identity is never handed out early, the attempt pool is truly
 * shared between both partners, a guess broadcasts in FULL (the deliberate
 * opposite of This-or-That's privacy shape), and the two races that a
 * two-person board actually has are refused.
 */

const MYSTERY = 'mystery-id';

const h = vi.hoisted(() => ({
  guesses: [] as any[],
  publishes: [] as { event: string; data: any }[],
  notifies: [] as string[],
  eligible: [] as string[],
}));

vi.mock('../_lib/auth', () => ({
  requirePairedUser: vi.fn(async () => ({ id: 'user-A', couple_id: 'couple-1', display_name: 'A' })),
}));
vi.mock('../_lib/ably', () => ({
  publish: vi.fn(async (_c: string, event: string, data: unknown) => {
    h.publishes.push({ event, data: data as any });
  }),
}));
vi.mock('../_lib/notify', () => ({
  notify: vi.fn(async (_c: string, _a: string, _k: string, text: string) => {
    h.notifies.push(text);
  }),
}));
vi.mock('../_lib/log', () => ({ log: vi.fn(), errorFields: vi.fn(() => ({})), flushLogs: vi.fn(async () => {}) }));

const FILMS: Record<string, any> = {
  [MYSTERY]: {
    id: MYSTERY,
    title: 'Jawan',
    year: 2023,
    genres: ['Action', 'Thriller'],
    director: ['Atlee'],
    cast_members: ['Shah Rukh Khan', 'Nayanthara', 'Vijay Sethupathi', 'Deepika Padukone'],
  },
  other: {
    id: 'other',
    title: 'Devdas',
    year: 2002,
    genres: ['Drama'],
    director: ['Sanjay Leela Bhansali'],
    cast_members: ['Shah Rukh Khan', 'Aishwarya Rai', 'Madhuri Dixit', 'Jackie Shroff'],
  },
};

vi.mock('../_lib/db', () => ({
  one: vi.fn(async () => ({ created_at: '2026-07-26T12:00:00.000Z' })),
  q: vi.fn(async (text: string, params: any[] = []) => {
    if (text.includes('WHERE eligible = true')) return h.eligible.map((id) => ({ id }));
    if (text.includes('FROM movies WHERE id = ANY')) {
      return (params[0] as string[]).map((id) => FILMS[id]).filter(Boolean);
    }
    if (text.includes('title ILIKE')) return [{ id: 'other', title: 'Devdas', year: 2002 }];
    if (text.includes('FROM picture_night_guesses') && text.includes('GROUP BY')) return [];
    if (text.includes('FROM picture_night_guesses')) return h.guesses;
    return [];
  }),
}));

import handler from './picture-night';

function makeRes() {
  const res: any = {
    statusCode: 0,
    body: undefined,
    setHeader() {},
    status(c: number) {
      this.statusCode = c;
      return this;
    },
    json(p: unknown) {
      this.body = p;
      return this;
    },
    end() {
      return this;
    },
  };
  return res;
}

const DATE = '2026-07-26';
const get = (query: Record<string, string> = {}) =>
  ({ method: 'GET', url: '/api/picture-night', query: { date: DATE, ...query }, headers: {}, body: {} }) as any;
const post = (body: Record<string, unknown>) =>
  ({ method: 'POST', url: '/api/picture-night', query: {}, headers: {}, body: { date: DATE, ...body } }) as any;

/** Force both of the day's rounds onto the known mystery film. */
function poolOfOne() {
  h.eligible = [MYSTERY];
}

describe('GET /api/picture-night', () => {
  beforeEach(() => {
    h.guesses = [];
    h.publishes = [];
    h.notifies = [];
    poolOfOne();
  });

  it('returns both of the day two boards', async () => {
    const res = makeRes();
    await handler(get(), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.boards.map((b: any) => b.round)).toEqual([1, 2]);
  });

  it('never reveals the answer while the board is still live', async () => {
    const res = makeRes();
    await handler(get(), res);
    expect(res.body.boards[0].answer).toBeNull();
    expect(JSON.stringify(res.body)).not.toContain('Jawan');
  });

  it('reveals the answer once the board is over', async () => {
    h.guesses = Array.from({ length: 7 }, () => ({
      round: 1,
      movie_id: 'other',
      user_id: 'user-A',
      correct: false,
      created_at: '2026-07-26T10:00:00.000Z',
    }));
    const res = makeRes();
    await handler(get(), res);
    expect(res.body.boards[0].state.lost).toBe(true);
    expect(res.body.boards[0].answer).toEqual({ title: 'Jawan', year: 2023 });
  });

  it('refuses a future date rather than handing tomorrow over', async () => {
    const res = makeRes();
    await handler(get({ date: '2099-01-01' }), res);
    expect(res.statusCode).toBe(400);
  });

  it('autocompletes against the catalogue and carries the year for duplicate titles', async () => {
    const res = makeRes();
    await handler(get({ search: 'dev' }), res);
    expect(res.body.results[0]).toEqual({ id: 'other', title: 'Devdas', year: 2002 });
  });

  it('ignores a search too short to mean anything', async () => {
    const res = makeRes();
    await handler(get({ search: 'd' }), res);
    expect(res.body.results).toEqual([]);
  });
});

describe('POST /api/picture-night', () => {
  beforeEach(() => {
    h.guesses = [];
    h.publishes = [];
    h.notifies = [];
    poolOfOne();
  });

  it('scores a wrong guess with tiles and keeps the answer hidden', async () => {
    const res = makeRes();
    await handler(post({ round: 1, movieId: 'other' }), res);
    expect(res.statusCode).toBe(201);
    expect(res.body.guess.correct).toBe(false);
    expect(res.body.answer).toBeNull();
    const cast = res.body.guess.tiles.find((t: any) => t.key === 'cast');
    expect(cast).toMatchObject({ state: 'near', shared: ['Shah Rukh Khan'] });
  });

  it('broadcasts the guess IN FULL, unlike This-or-That which hides picks', async () => {
    const res = makeRes();
    await handler(post({ round: 1, movieId: 'other' }), res);
    const ev = h.publishes.find((p) => p.event === 'riddle.guessed')!;
    expect(ev).toBeDefined();
    expect(ev.data.guess.title).toBe('Devdas');
    expect(ev.data.guess.tiles).toHaveLength(4);
    expect(ev.data.state.attemptsUsed).toBe(1);
    expect(ev.data.answer).toBeNull();
  });

  it('a correct guess ends the board and releases the answer to both at once', async () => {
    const res = makeRes();
    await handler(post({ round: 1, movieId: MYSTERY }), res);
    expect(res.body.state).toMatchObject({ solved: true, over: true, solvedBy: 'user-A' });
    expect(res.body.answer).toEqual({ title: 'Jawan', year: 2023 });
    expect(h.publishes[0].data.answer).toEqual({ title: 'Jawan', year: 2023 });
  });

  it('spends ONE shared pool: your partner guesses count against yours', async () => {
    h.guesses = [
      { round: 1, movie_id: 'other', user_id: 'user-B', correct: false, created_at: '2026-07-26T09:00:00.000Z' },
      { round: 1, movie_id: 'x', user_id: 'user-B', correct: false, created_at: '2026-07-26T09:01:00.000Z' },
    ];
    const res = makeRes();
    await handler(post({ round: 1, movieId: MYSTERY }), res);
    // Two of the seven were spent by the other partner, so this is the third.
    expect(res.body.state.attemptsUsed).toBe(3);
  });

  it('refuses a guess once your partner has already solved it', async () => {
    h.guesses = [
      { round: 1, movie_id: MYSTERY, user_id: 'user-B', correct: true, created_at: '2026-07-26T09:00:00.000Z' },
    ];
    const res = makeRes();
    await handler(post({ round: 1, movieId: 'other' }), res);
    expect(res.statusCode).toBe(409);
  });

  it('refuses a guess once the shared pool is spent', async () => {
    h.guesses = Array.from({ length: 7 }, (_, i) => ({
      round: 1,
      movie_id: `x${i}`,
      user_id: 'user-B',
      correct: false,
      created_at: '2026-07-26T09:00:00.000Z',
    }));
    const res = makeRes();
    await handler(post({ round: 1, movieId: 'other' }), res);
    expect(res.statusCode).toBe(409);
  });

  it('refuses the same film twice, which would waste a shared attempt', async () => {
    h.guesses = [
      { round: 1, movie_id: 'other', user_id: 'user-B', correct: false, created_at: '2026-07-26T09:00:00.000Z' },
    ];
    const res = makeRes();
    await handler(post({ round: 1, movieId: 'other' }), res);
    expect(res.statusCode).toBe(409);
  });

  it('validates the round rather than trusting it', async () => {
    for (const round of [0, 3, 'x']) {
      const res = makeRes();
      await handler(post({ round, movieId: 'other' }), res);
      expect(res.statusCode).toBe(400);
    }
  });

  it('writes ONE bell row when the board finishes, and none per guess', async () => {
    const res1 = makeRes();
    await handler(post({ round: 1, movieId: 'other' }), res1);
    expect(h.notifies).toEqual([]);

    const res2 = makeRes();
    await handler(post({ round: 1, movieId: MYSTERY }), res2);
    expect(h.notifies).toHaveLength(1);
    expect(h.notifies[0]).toContain('solved');
  });

  it('unlocks a hint after the 4th failed guess, and never names the director', async () => {
    h.guesses = Array.from({ length: 3 }, (_, i) => ({
      round: 1,
      movie_id: `x${i}`,
      user_id: 'user-B',
      correct: false,
      created_at: '2026-07-26T09:00:00.000Z',
    }));
    const res = makeRes();
    await handler(post({ round: 1, movieId: 'other' }), res);
    expect(res.body.hints).toEqual([{ label: 'The decade', value: '2020s' }]);
    expect(JSON.stringify(res.body.hints)).not.toContain('Atlee');
  });
});
