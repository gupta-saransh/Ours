import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  user: null as { id: string; couple_id: string | null } | null,
  logged: [] as { level: string; event: string; fields: Record<string, unknown> }[],
}));

vi.mock('../_lib/auth', () => ({
  requireUser: vi.fn(async () => {
    if (!state.user) throw new Error('Not signed in');
    return state.user;
  }),
}));

vi.mock('../_lib/log', () => ({
  log: vi.fn((level: string, event: string, fields: Record<string, unknown>) => {
    state.logged.push({ level, event, fields });
  }),
  flushLogs: vi.fn(async () => {}),
  errorFields: vi.fn(() => ({})),
}));

import handler from './logs';

function call(body: unknown) {
  const req: any = { method: 'POST', url: '/api/logs', headers: {}, query: {}, body };
  const res: any = {
    statusCode: 200,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.payload = payload;
      return this;
    },
    setHeader() {},
    end() {},
  };
  return handler(req, res).then(() => res);
}

beforeEach(() => {
  state.user = { id: 'user-1', couple_id: 'couple-1' };
  state.logged = [];
});

/** route() logs its own http.request line; these tests care about the batch. */
const forwarded = () => state.logged.filter((l) => l.event !== 'http.request');

describe('POST /api/logs', () => {
  it('forwards client events into the log pipeline', async () => {
    const res = await call({
      session: 'abc123',
      platform: 'web',
      events: [{ t: '2026-07-18T10:00:00.000Z', level: 'warn', event: 'push.subscribe_failed', fields: { step: 'permission' } }],
    });

    expect(res.statusCode).toBe(202);
    expect(forwarded()).toHaveLength(1);
    expect(forwarded()[0].level).toBe('warn');
    expect(forwarded()[0].event).toBe('push.subscribe_failed');
    expect(forwarded()[0].fields).toMatchObject({
      source: 'client',
      session: 'abc123',
      platform: 'web',
      user_id: 'user-1',
      couple_id: 'couple-1',
      c_step: 'permission',
    });
  });

  it('accepts a batch from a signed-out client, unstamped', async () => {
    state.user = null;
    const res = await call({ events: [{ event: 'client.api_failed', fields: { status: 401 } }] });

    expect(res.statusCode).toBe(202);
    expect(forwarded()[0].fields.user_id).toBeUndefined();
    expect(forwarded()[0].fields.c_status).toBe(401);
  });

  it('namespaces client fields so they cannot forge a server one', async () => {
    await call({ events: [{ event: 'client.spoof', fields: { user_id: 'someone-else', level: 'error' } }] });

    // The real identity survives; the client's claim lands under c_*.
    expect(forwarded()[0].fields.user_id).toBe('user-1');
    expect(forwarded()[0].fields.c_user_id).toBe('someone-else');
  });

  it('caps the batch size', async () => {
    const events = Array.from({ length: 120 }, (_, i) => ({ event: `client.e${i}` }));
    await call({ events });

    expect(forwarded()).toHaveLength(50);
  });

  it('drops non-primitive field values and trims long ones', async () => {
    await call({
      events: [{ event: 'client.messy', fields: { blob: { secret: 'note body' }, long: 'y'.repeat(1000), ok: true } }],
    });

    const fields = forwarded()[0].fields;
    expect(fields.c_blob).toBeUndefined();
    expect(String(fields.c_long).length).toBe(200);
    expect(fields.c_ok).toBe(true);
  });

  it('falls back to a safe event name and level', async () => {
    await call({ events: [{ level: 'catastrophe' }] });

    expect(forwarded()[0].event).toBe('client.unknown');
    expect(forwarded()[0].level).toBe('info');
  });

  it('tolerates a body with no events', async () => {
    const res = await call({});
    expect(res.statusCode).toBe(202);
    expect(forwarded()).toHaveLength(0);
  });
});
