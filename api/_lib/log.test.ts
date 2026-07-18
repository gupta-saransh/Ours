import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { endpointHost, errorFields, flushLogs, log, loggingConfigured } from './log';

/**
 * The logger's job is to be harmless: it must never throw, never block on a
 * failing collector, and never carry more of a value than it was given room for.
 * These tests pin the parts a future edit could quietly break.
 */

const OLD_ENV = { ...process.env };

beforeEach(() => {
  process.env.AXIOM_TOKEN = 'test-token';
  process.env.AXIOM_DATASET = 'ours-test';
  delete process.env.AXIOM_URL;
});

afterEach(async () => {
  await flushLogs().catch(() => {});
  process.env = { ...OLD_ENV };
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('log + flushLogs', () => {
  it('ships buffered lines to Axiom in one batch', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => '' });
    vi.stubGlobal('fetch', fetchMock);

    log('info', 'test.one', { user_id: 'u1' });
    log('warn', 'test.two', { count: 2 });
    await flushLogs();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.axiom.co/v1/datasets/ours-test/ingest');
    expect(init.headers.Authorization).toBe('Bearer test-token');

    const batch = JSON.parse(init.body);
    expect(batch).toHaveLength(2);
    expect(batch[0]).toMatchObject({ level: 'info', event: 'test.one', user_id: 'u1', service: 'ours-api' });
    expect(batch[1]).toMatchObject({ level: 'warn', event: 'test.two', count: 2 });
    expect(typeof batch[0]._time).toBe('string');
  });

  it('drains the buffer so a second flush sends nothing', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => '' });
    vi.stubGlobal('fetch', fetchMock);

    log('info', 'test.once');
    await flushLogs();
    await flushLogs();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('truncates long strings so a stray field cannot dump user content', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => '' });
    vi.stubGlobal('fetch', fetchMock);

    log('info', 'test.long', { note: 'x'.repeat(5000) });
    await flushLogs();

    const record = JSON.parse(fetchMock.mock.calls[0][1].body)[0];
    expect(record.note.length).toBeLessThan(500);
    expect(record.note.endsWith('…')).toBe(true);
  });

  it('swallows a failing collector instead of throwing at the caller', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    log('error', 'test.boom');
    await expect(flushLogs()).resolves.toBeUndefined();
  });

  it('does nothing at all when Axiom is not configured', async () => {
    delete process.env.AXIOM_TOKEN;
    delete process.env.AXIOM_DATASET;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    expect(loggingConfigured()).toBe(false);
    log('info', 'test.local-only');
    await flushLogs();

    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('errorFields', () => {
  it('flattens an Error, keeping the message and a short stack', () => {
    const fields = errorFields(new Error('nope'));
    expect(fields.error).toBe('nope');
    expect(fields.error_name).toBe('Error');
    expect(typeof fields.stack).toBe('string');
  });

  it('carries a driver error code and an HTTP status through', () => {
    const err = Object.assign(new Error('rejected'), { code: '42P10', statusCode: 410 });
    expect(errorFields(err)).toMatchObject({ error_code: '42P10', error_status: 410 });
  });

  it('handles a thrown non-Error', () => {
    expect(errorFields('just a string')).toMatchObject({ error: 'just a string' });
  });
});

describe('endpointHost', () => {
  it('keeps only the host, never the secret path of a push endpoint', () => {
    expect(endpointHost('https://web.push.apple.com/AAAA-secret-token-BBBB')).toBe('web.push.apple.com');
    expect(endpointHost('https://fcm.googleapis.com/fcm/send/abc123')).toBe('fcm.googleapis.com');
  });

  it('is safe on missing or malformed input', () => {
    expect(endpointHost(null)).toBeUndefined();
    expect(endpointHost('not a url')).toBe('invalid-endpoint');
  });
});
