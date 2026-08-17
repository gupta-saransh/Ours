import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TTL_SECONDS,
  FAILURES_PER_LOCKOUT,
  TTL_OPTIONS,
  codeGateState,
  expiryFor,
  isAwaitingRead,
  isExpired,
  isLockedOut,
  isValidCode,
  isValidTtl,
  lockoutMinutesFor,
  lockoutRemainingMinutes,
  lockoutUntil,
  timerChangeNotice,
  ttlLabel,
  unkeepExpiry,
} from './secret-chat';

const T0 = new Date('2026-08-17T12:00:00.000Z');

describe('ttl options', () => {
  it('accepts only the offered durations', () => {
    for (const o of TTL_OPTIONS) expect(isValidTtl(o.seconds)).toBe(true);
    expect(isValidTtl(42)).toBe(false);
    expect(isValidTtl('86400')).toBe(false);
    expect(isValidTtl(null)).toBe(false);
    expect(isValidTtl(-60)).toBe(false);
  });

  it('offers 24 hours as the default and includes an off switch', () => {
    expect(isValidTtl(DEFAULT_TTL_SECONDS)).toBe(true);
    expect(ttlLabel(DEFAULT_TTL_SECONDS)).toBe('24 hours');
    expect(TTL_OPTIONS.some((o) => o.seconds === 0)).toBe(true);
  });
});

describe('expiryFor', () => {
  it('stamps created_at + ttl', () => {
    expect(expiryFor(T0, 60)?.toISOString()).toBe('2026-08-17T12:01:00.000Z');
    expect(expiryFor(T0, 86_400)?.toISOString()).toBe('2026-08-18T12:00:00.000Z');
  });

  it('returns null when the timer is off, so the message persists', () => {
    expect(expiryFor(T0, 0)).toBeNull();
    expect(expiryFor(T0, null)).toBeNull();
    expect(expiryFor(T0, undefined)).toBeNull();
  });

  it('accepts an ISO string as well as a Date', () => {
    expect(expiryFor('2026-08-17T12:00:00.000Z', 3600)?.toISOString()).toBe('2026-08-17T13:00:00.000Z');
  });

  it('never invents an expiry from an unreadable timestamp', () => {
    expect(expiryFor('not a date', 60)).toBeNull();
  });
});

describe('isExpired', () => {
  it('is true only at or past the deadline', () => {
    const at = new Date('2026-08-17T12:01:00.000Z');
    expect(isExpired(at, new Date('2026-08-17T12:00:59.000Z'))).toBe(false);
    expect(isExpired(at, at)).toBe(true);
    expect(isExpired(at, new Date('2026-08-17T12:01:01.000Z'))).toBe(true);
  });

  it('treats null as never expiring (kept, or the timer was off)', () => {
    expect(isExpired(null, T0)).toBe(false);
    expect(isExpired(undefined, T0)).toBe(false);
  });

  it('does not vanish a message whose stamp is unreadable', () => {
    // Failing "open" here is the safe direction: the message stays visible and
    // a human can delete it, rather than content silently disappearing on a
    // parse bug.
    expect(isExpired('garbage', T0)).toBe(false);
  });
});

describe('unkeepExpiry', () => {
  it('restores the original deadline, measured from when it was READ', () => {
    // Read at T0 under a 1-minute timer, kept, then un-kept an hour later: due
    // at T0+1min (long past), NOT an hour from now.
    expect(unkeepExpiry(T0, 60)?.toISOString()).toBe('2026-08-17T12:01:00.000Z');
  });

  it('makes an un-kept message immediately expired', () => {
    const anHourLater = new Date('2026-08-17T13:00:00.000Z');
    expect(isExpired(unkeepExpiry(T0, 60), anHourLater)).toBe(true);
  });

  it('leaves a message sent with the timer off still permanent', () => {
    expect(unkeepExpiry(T0, 0)).toBeNull();
  });

  it('returns a never-read message to WAITING rather than a fresh window', () => {
    // Kept before the partner ever opened it, then un-kept: it has no start, so
    // it goes back to waiting to be read. Handing it "now + ttl" here would let
    // keep-then-unkeep quietly restart a message's life.
    expect(unkeepExpiry(null, 60)).toBeNull();
    expect(unkeepExpiry(undefined, 60)).toBeNull();
  });
});

describe('isAwaitingRead', () => {
  const base = { ttl_seconds: 60, timer_started_at: null, kept_by: null, expires_at: null };

  it('is true for a message sent but not yet read', () => {
    expect(isAwaitingRead(base)).toBe(true);
  });

  it('is false once the clock has started', () => {
    expect(isAwaitingRead({ ...base, timer_started_at: T0, expires_at: T0 })).toBe(false);
  });

  it('is false for a kept message, which is paused rather than waiting', () => {
    expect(isAwaitingRead({ ...base, kept_by: 'user-A' })).toBe(false);
  });

  it('is false when the timer is off entirely', () => {
    expect(isAwaitingRead({ ...base, ttl_seconds: 0 })).toBe(false);
    expect(isAwaitingRead({ ...base, ttl_seconds: null })).toBe(false);
  });
});

describe('code validation', () => {
  it('requires exactly four digits', () => {
    expect(isValidCode('0000')).toBe(true);
    expect(isValidCode('9137')).toBe(true);
    expect(isValidCode('123')).toBe(false);
    expect(isValidCode('12345')).toBe(false);
    expect(isValidCode('12a4')).toBe(false);
    expect(isValidCode('')).toBe(false);
    expect(isValidCode(1234)).toBe(false);
  });

  it('keeps leading zeros meaningful by staying a string', () => {
    expect(isValidCode('0007')).toBe(true);
  });
});

describe('lockout backoff', () => {
  it('does not lock before the allowance is spent', () => {
    for (let i = 0; i < FAILURES_PER_LOCKOUT; i++) expect(lockoutMinutesFor(i)).toBe(0);
  });

  it('escalates by doubling and caps at an hour', () => {
    expect(lockoutMinutesFor(5)).toBe(1);
    expect(lockoutMinutesFor(9)).toBe(1);
    expect(lockoutMinutesFor(10)).toBe(2);
    expect(lockoutMinutesFor(15)).toBe(4);
    expect(lockoutMinutesFor(20)).toBe(8);
    expect(lockoutMinutesFor(30)).toBe(32);
    expect(lockoutMinutesFor(35)).toBe(60);
    expect(lockoutMinutesFor(500)).toBe(60);
  });

  it('turns failures into a real deadline', () => {
    expect(lockoutUntil(5, T0)?.toISOString()).toBe('2026-08-17T12:01:00.000Z');
    expect(lockoutUntil(1, T0)).toBeNull();
  });

  it('reports whether a lock is still in force', () => {
    const until = new Date('2026-08-17T12:05:00.000Z');
    expect(isLockedOut(until, T0)).toBe(true);
    expect(isLockedOut(until, new Date('2026-08-17T12:05:00.000Z'))).toBe(false);
    expect(isLockedOut(null, T0)).toBe(false);
  });

  it('rounds the wait up so it never says "0 minutes"', () => {
    expect(lockoutRemainingMinutes(new Date('2026-08-17T12:00:01.000Z'), T0)).toBe(1);
    expect(lockoutRemainingMinutes(new Date('2026-08-17T12:04:30.000Z'), T0)).toBe(5);
    expect(lockoutRemainingMinutes(null, T0)).toBe(0);
  });
});

describe('codeGateState', () => {
  it('reports an account with no code set', () => {
    expect(codeGateState({ secret_code_hash: null, secret_code_locked_until: null }, T0)).toBe('unset');
  });

  it('reports a locked account before any hashing happens', () => {
    expect(
      codeGateState(
        { secret_code_hash: 'salt:hash', secret_code_locked_until: '2026-08-17T12:30:00.000Z' },
        T0
      )
    ).toBe('locked');
  });

  it('lets an expired lock through', () => {
    expect(
      codeGateState(
        { secret_code_hash: 'salt:hash', secret_code_locked_until: '2026-08-17T11:30:00.000Z' },
        T0
      )
    ).toBe('ok');
  });

  it('prefers "unset" over "locked" when there is no code at all', () => {
    expect(
      codeGateState(
        { secret_code_hash: null, secret_code_locked_until: '2026-08-17T12:30:00.000Z' },
        T0
      )
    ).toBe('unset');
  });
});

describe('timerChangeNotice', () => {
  it('names the person and the duration, never any message content', () => {
    expect(timerChangeNotice('Anisha', 60)).toBe('Anisha set messages to disappear after 1 minute');
    expect(timerChangeNotice('Saransh', 86_400)).toBe('Saransh set messages to disappear after 24 hours');
  });

  it('has its own wording for turning the timer off', () => {
    expect(timerChangeNotice('Anisha', 0)).toBe('Anisha turned off disappearing messages');
  });

  it('never uses an em dash (house copy rule)', () => {
    for (const o of TTL_OPTIONS) expect(timerChangeNotice('Anisha', o.seconds)).not.toContain('—');
  });
});
