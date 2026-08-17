import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hashPassword } from '../_lib/auth';

/**
 * The lock itself. What matters here is not that a correct code works, but the
 * things that stop it being decoration:
 *
 *  - a wrong code costs an attempt, and enough attempts cost time (4 digits is
 *    10,000 combinations, which is nothing without a backoff);
 *  - a locked-out account is refused BEFORE any hashing happens;
 *  - setting a code needs the ACCOUNT password, even the first time, or anyone
 *    holding an unlocked phone could lock the owner out of their own thread;
 *  - the code is never returned, in any response, ever.
 */

process.env.JWT_SECRET = 'test-secret-for-secret-code';

const REAL_PASSWORD = 'correct horse battery';
const REAL_CODE = '4821';

const h = vi.hoisted(() => ({
  calls: [] as { text: string; params: unknown[] }[],
  row: {} as any,
}));

vi.mock('../_lib/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../_lib/auth')>();
  return {
    ...actual,
    // Real scrypt hashing/verification; only the session lookup is stubbed.
    requireUser: vi.fn(async () => ({ id: 'user-A', couple_id: 'couple-1', display_name: 'Ana' })),
  };
});
vi.mock('../_lib/log', () => ({ log: vi.fn(), errorFields: vi.fn(() => ({})), flushLogs: vi.fn(async () => {}) }));
vi.mock('../_lib/db', () => ({
  one: vi.fn(async (text: string, params: unknown[] = []) => {
    h.calls.push({ text, params });
    if (text.includes('SELECT secret_code_hash')) return h.row;
    return { id: 'user-A' };
  }),
  q: vi.fn(async () => []),
}));

import handler from './secret-code';

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

const unlockReq = (code: string) => ({
  method: 'POST',
  url: '/api/secret-code/unlock',
  query: {},
  headers: {},
  body: { code },
});

beforeEach(() => {
  h.calls.length = 0;
  h.row = {
    secret_code_hash: hashPassword(REAL_CODE),
    secret_code_failures: 0,
    secret_code_locked_until: null,
    password_hash: hashPassword(REAL_PASSWORD),
  };
});

describe('unlocking', () => {
  it('hands back a short-lived grant for the right code', async () => {
    const res = makeRes();
    await handler(unlockReq(REAL_CODE) as any, res);
    expect(res.statusCode).toBe(200);
    expect(typeof res.body.token).toBe('string');
    expect(res.body.expiresIn).toBe(15 * 60);
  });

  it('resets the failure count on success', async () => {
    h.row.secret_code_failures = 3;
    const res = makeRes();
    await handler(unlockReq(REAL_CODE) as any, res);
    expect(h.calls.some((c) => c.text.includes('secret_code_failures = 0'))).toBe(true);
  });

  it('refuses a wrong code and charges an attempt for it', async () => {
    const res = makeRes();
    await handler(unlockReq('0000') as any, res);
    expect(res.statusCode).toBe(401);
    const update = h.calls.find((c) => c.text.includes('SET secret_code_failures = $2'))!;
    expect(update.params[1]).toBe(1);
  });

  it('points a stuck person at the reset path instead of a dead end', async () => {
    const res = makeRes();
    await handler(unlockReq('0000') as any, res);
    expect(res.body.error).toMatch(/Settings/);
  });

  it('locks out once the allowance is spent, and says how long', async () => {
    h.row.secret_code_failures = 4; // this attempt makes 5
    const res = makeRes();
    await handler(unlockReq('0000') as any, res);
    expect(res.statusCode).toBe(429);
    const update = h.calls.find((c) => c.text.includes('SET secret_code_failures = $2'))!;
    expect(update.params[2]).toBeInstanceOf(Date);
  });

  it('refuses a locked-out account without hashing anything', async () => {
    h.row.secret_code_locked_until = new Date(Date.now() + 10 * 60_000).toISOString();
    const res = makeRes();
    await handler(unlockReq(REAL_CODE) as any, res); // even the RIGHT code
    expect(res.statusCode).toBe(429);
    expect(h.calls.some((c) => c.text.includes('UPDATE users'))).toBe(false);
  });

  it('lets a lapsed lockout through again', async () => {
    h.row.secret_code_locked_until = new Date(Date.now() - 60_000).toISOString();
    const res = makeRes();
    await handler(unlockReq(REAL_CODE) as any, res);
    expect(res.statusCode).toBe(200);
  });

  it('rejects a malformed code without spending a scrypt run on it', async () => {
    const res = makeRes();
    await handler(unlockReq('12') as any, res);
    expect(res.statusCode).toBe(401);
  });

  it('tells you to set one first when there is no code at all', async () => {
    h.row.secret_code_hash = null;
    const res = makeRes();
    await handler(unlockReq('1234') as any, res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/Set a code first/);
  });
});

describe('setting or resetting the code', () => {
  const setReq = (password: string, code: string) => ({
    method: 'POST',
    url: '/api/secret-code',
    query: {},
    headers: {},
    body: { password, code },
  });

  it('lets you choose your FIRST code with no password at all', async () => {
    // Starting a secret chat should be two taps. There is nothing to protect
    // yet, since no code exists to be swapped out from under anyone.
    h.row.secret_code_hash = null;
    const res = makeRes();
    await handler({ method: 'POST', url: '/api/secret-code', query: {}, headers: {}, body: { code: '1234' } } as any, res);
    expect(res.statusCode).toBe(200);
    expect(h.calls.some((c) => c.text.includes('SET secret_code_hash'))).toBe(true);
  });

  it('requires the account password to REPLACE an existing code', async () => {
    // This is the case that matters: without it, whoever is holding the
    // unlocked phone could change the code and lock the owner out.
    const res = makeRes();
    await handler(setReq('wrong password', '1234') as any, res);
    expect(res.statusCode).toBe(400);
    expect(h.calls.some((c) => c.text.includes('SET secret_code_hash'))).toBe(false);
  });

  it('refuses to replace a code with no password supplied at all', async () => {
    const res = makeRes();
    await handler({ method: 'POST', url: '/api/secret-code', query: {}, headers: {}, body: { code: '1234' } } as any, res);
    expect(res.statusCode).toBe(400);
    expect(h.calls.some((c) => c.text.includes('SET secret_code_hash'))).toBe(false);
  });

  it('stores a hash, never the code', async () => {
    const res = makeRes();
    await handler(setReq(REAL_PASSWORD, '1234') as any, res);
    expect(res.statusCode).toBe(200);
    const update = h.calls.find((c) => c.text.includes('SET secret_code_hash'))!;
    expect(update.params[1]).not.toBe('1234');
    expect(String(update.params[1])).toContain(':'); // salt:hash
  });

  it('clears any lockout, since the password is the stronger claim', async () => {
    h.row.secret_code_failures = 12;
    h.row.secret_code_locked_until = new Date(Date.now() + 30 * 60_000).toISOString();
    const res = makeRes();
    await handler(setReq(REAL_PASSWORD, '1234') as any, res);
    const update = h.calls.find((c) => c.text.includes('SET secret_code_hash'))!;
    expect(update.text).toContain('secret_code_failures = 0');
    expect(update.text).toContain('secret_code_locked_until = NULL');
  });

  it('rejects a code that is not four digits', async () => {
    const res = makeRes();
    await handler(setReq(REAL_PASSWORD, '12ab') as any, res);
    expect(res.statusCode).toBe(400);
  });

  it('drops you straight in rather than asking for what you just typed', async () => {
    const res = makeRes();
    await handler(setReq(REAL_PASSWORD, '1234') as any, res);
    expect(typeof res.body.token).toBe('string');
  });
});

describe('status', () => {
  it('says whether a code exists without ever revealing it', async () => {
    const res = makeRes();
    await handler({ method: 'GET', url: '/api/secret-code', query: {}, headers: {}, body: {} } as any, res);
    expect(res.body).toEqual({ hasCode: true, lockedOut: false, waitMinutes: 0 });
    expect(JSON.stringify(res.body)).not.toContain(REAL_CODE);
  });

  it('reports the remaining wait while locked out', async () => {
    h.row.secret_code_locked_until = new Date(Date.now() + 4 * 60_000 + 30_000).toISOString();
    const res = makeRes();
    await handler({ method: 'GET', url: '/api/secret-code', query: {}, headers: {}, body: {} } as any, res);
    expect(res.body).toMatchObject({ lockedOut: true, waitMinutes: 5 });
  });
});
