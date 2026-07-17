import { describe, expect, it, vi } from 'vitest';

// dates.ts imports the data/realtime libs at module scope; stub them so the
// pure parseTime helper can be imported and tested in isolation.
vi.mock('../_lib/auth', () => ({ requirePairedUser: vi.fn() }));
vi.mock('../_lib/ably', () => ({ publish: vi.fn() }));
vi.mock('../_lib/notify', () => ({ notify: vi.fn() }));
vi.mock('../_lib/envelope', () => ({ encryptField: vi.fn(), readField: vi.fn() }));
vi.mock('../_lib/db', () => ({ one: vi.fn(), q: vi.fn() }));

import { parseTime } from './dates';

describe('parseTime', () => {
  it('treats absent/empty values as no time', () => {
    expect(parseTime(undefined)).toBeNull();
    expect(parseTime(null)).toBeNull();
    expect(parseTime('')).toBeNull();
  });

  it('accepts a well-formed HH:MM', () => {
    expect(parseTime('19:30')).toBe('19:30');
    expect(parseTime('00:00')).toBe('00:00');
    expect(parseTime('23:59')).toBe('23:59');
  });

  it('rejects a malformed time', () => {
    expect(() => parseTime('9:5')).toThrow();
    expect(() => parseTime('7pm')).toThrow();
    expect(() => parseTime(1930 as unknown)).toThrow();
  });

  it('rejects an out-of-range time', () => {
    expect(() => parseTime('25:00')).toThrow();
    expect(() => parseTime('19:60')).toThrow();
  });
});
