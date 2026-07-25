import { describe, expect, it } from 'vitest';
import {
  RESET_CODE_TTL_MS,
  generateResetCode,
  hashResetCode,
  resetCodeStatus,
  verifyResetCodeHash,
  type StoredResetCode,
} from './password-reset';

const PEPPER = 'test-secret';

describe('generateResetCode', () => {
  it('is always a 6-digit numeric string, zero-padded', () => {
    for (let i = 0; i < 500; i++) {
      const code = generateResetCode();
      expect(code).toMatch(/^\d{6}$/);
    }
  });
});

describe('hashResetCode / verifyResetCodeHash', () => {
  it('is deterministic for the same code and pepper', () => {
    expect(hashResetCode('123456', PEPPER)).toBe(hashResetCode('123456', PEPPER));
  });

  it('never stores the code itself', () => {
    expect(hashResetCode('123456', PEPPER)).not.toContain('123456');
  });

  it('depends on the pepper, so a leaked hash is useless without the server secret', () => {
    expect(hashResetCode('123456', PEPPER)).not.toBe(hashResetCode('123456', 'other-secret'));
  });

  it('verifies the right code and rejects a wrong one', () => {
    const stored = hashResetCode('123456', PEPPER);
    expect(verifyResetCodeHash('123456', PEPPER, stored)).toBe(true);
    expect(verifyResetCodeHash('654321', PEPPER, stored)).toBe(false);
  });

  it('rejects a malformed stored hash instead of throwing', () => {
    expect(verifyResetCodeHash('123456', PEPPER, 'not-hex-zzz')).toBe(false);
    expect(verifyResetCodeHash('123456', PEPPER, 'abcd')).toBe(false);
    expect(verifyResetCodeHash('123456', PEPPER, '')).toBe(false);
  });
});

describe('resetCodeStatus', () => {
  const now = 1_000_000_000_000;
  const live = (over: Partial<StoredResetCode> = {}): StoredResetCode => ({
    code_hash: hashResetCode('123456', PEPPER),
    expires_at: new Date(now + RESET_CODE_TTL_MS).toISOString(),
    used_at: null,
    ...over,
  });

  it('accepts a valid, unused, unexpired, matching code', () => {
    expect(resetCodeStatus(live(), '123456', PEPPER, now)).toBe('ok');
  });

  it('reports missing when there is no code on file', () => {
    expect(resetCodeStatus(null, '123456', PEPPER, now)).toBe('missing');
    expect(resetCodeStatus(undefined, '123456', PEPPER, now)).toBe('missing');
  });

  it('reports used once the code has been spent', () => {
    expect(resetCodeStatus(live({ used_at: new Date(now).toISOString() }), '123456', PEPPER, now)).toBe('used');
  });

  it('reports expired at or after the expiry instant', () => {
    const row = live({ expires_at: new Date(now).toISOString() });
    expect(resetCodeStatus(row, '123456', PEPPER, now)).toBe('expired');
    expect(resetCodeStatus(row, '123456', PEPPER, now + 1)).toBe('expired');
  });

  it('reports mismatch for the wrong code even when live', () => {
    expect(resetCodeStatus(live(), '000000', PEPPER, now)).toBe('mismatch');
  });

  it('treats a used AND expired code as used (used is checked first)', () => {
    const row = live({ used_at: new Date(now).toISOString(), expires_at: new Date(now - 1).toISOString() });
    expect(resetCodeStatus(row, '123456', PEPPER, now)).toBe('used');
  });
});
