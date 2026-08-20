import { describe, expect, it } from 'vitest';
import { dayNumber, rotationIndexes, rotationOrder } from './daily-rotation';

const SALT = 'test';

/** Walk `days` consecutive dates from a start date and collect every index served. */
function walk(startDate: string, days: number, size: number, count = 1, salt = SALT): number[] {
  const start = dayNumber(startDate)!;
  const out: number[] = [];
  for (let d = 0; d < days; d++) {
    const iso = new Date((start + d) * 86_400_000).toISOString().slice(0, 10);
    out.push(...rotationIndexes(iso, size, count, salt));
  }
  return out;
}

describe('dayNumber', () => {
  it('counts days from the epoch', () => {
    expect(dayNumber('1970-01-01')).toBe(0);
    expect(dayNumber('1970-01-02')).toBe(1);
    expect(dayNumber('2026-08-20')).toBe(Math.floor(Date.UTC(2026, 7, 20) / 86_400_000));
  });

  it('is null for anything that is not a plain date', () => {
    expect(dayNumber('nonsense')).toBeNull();
    expect(dayNumber('')).toBeNull();
    expect(dayNumber('20-08-2026')).toBeNull();
  });

  it('reads the date out of a longer timestamp', () => {
    expect(dayNumber('2026-08-20T13:45:00.000Z')).toBe(dayNumber('2026-08-20'));
  });
});

describe('rotationOrder', () => {
  it('is a real permutation, every index exactly once', () => {
    const order = rotationOrder(50, SALT);
    expect(order).toHaveLength(50);
    expect(new Set(order).size).toBe(50);
    expect([...order].sort((a, b) => a - b)).toEqual(Array.from({ length: 50 }, (_, i) => i));
  });

  it('is deterministic', () => {
    expect(rotationOrder(30, SALT)).toEqual(rotationOrder(30, SALT));
  });

  it('is not simply the order the list was typed in', () => {
    expect(rotationOrder(40, SALT)).not.toEqual(Array.from({ length: 40 }, (_, i) => i));
  });

  it('gives different schedules to different features', () => {
    // The prompt and the game must not march in lockstep.
    expect(rotationOrder(40, 'prompt')).not.toEqual(rotationOrder(40, 'game'));
  });

  it('does not shuffle a pool it cannot', () => {
    expect(rotationOrder(0, SALT)).toEqual([]);
    expect(rotationOrder(1, SALT)).toEqual([0]);
  });
});

describe('no repeats until the pool is exhausted', () => {
  it('serves every entry exactly once over one full lap', () => {
    const size = 60;
    const seen = walk('2026-08-20', size, size);
    expect(seen).toHaveLength(size);
    expect(new Set(seen).size).toBe(size);
  });

  it('does the same for a pool used twice a day', () => {
    // This-or-That draws two a day, so a 60-entry pool must last 30 days.
    const size = 60;
    const seen = walk('2026-08-20', size / 2, size, 2);
    expect(seen).toHaveLength(size);
    expect(new Set(seen).size).toBe(size);
  });

  it('never repeats within any window shorter than the pool', () => {
    const size = 48;
    const seen = walk('2026-01-01', 200, size, 2);
    for (let i = 0; i < seen.length; i++) {
      const window = seen.slice(i, i + size);
      expect(new Set(window).size).toBe(window.length);
    }
  });

  it('the two rounds of a day are always different questions', () => {
    const size = 48;
    const start = dayNumber('2026-01-01')!;
    for (let d = 0; d < 400; d++) {
      const iso = new Date((start + d) * 86_400_000).toISOString().slice(0, 10);
      const [first, second] = rotationIndexes(iso, size, 2, SALT);
      expect(first).not.toBe(second);
    }
  });

  it('holds the guarantee starting from ANY date, not just a lap boundary', () => {
    // The whole point of a fixed order: the window that matters is the last N
    // draws, wherever you happen to start counting.
    const size = 25;
    for (const start of ['2026-01-01', '2026-03-17', '2027-11-30', '2026-08-20']) {
      const seen = walk(start, size, size);
      expect(new Set(seen).size).toBe(size);
    }
  });

  it('beats the old hash-mod, which wasted most of the pool', () => {
    // The behaviour that was actually reported, kept as a comparison so the
    // reason for this module does not get lost. Hash-mod is a draw WITH
    // replacement, so over a pool-length run it serves roughly 1-1/e of the
    // entries (~63%) and repeats the rest, while never showing the others at
    // all. That is what "it keeps asking things we already answered" is.
    const size = 114;
    const start = dayNumber('2026-08-20')!;
    const legacy: number[] = [];
    for (let d = 0; d < size; d++) {
      const iso = new Date((start + d) * 86_400_000).toISOString().slice(0, 10);
      let h = 0;
      for (let i = 0; i < iso.length; i++) h = (h * 31 + iso.charCodeAt(i)) >>> 0;
      legacy.push(h % size);
    }
    const legacyDistinct = new Set(legacy).size;
    expect(legacyDistinct).toBeLessThan(size * 0.8); // old: a third never appears

    const rotated = walk('2026-08-20', size, size);
    expect(new Set(rotated).size).toBe(size); // new: every one, exactly once
  });
});

describe('bad input', () => {
  it('returns nothing rather than guessing', () => {
    expect(rotationIndexes('nonsense', 10, 1, SALT)).toEqual([]);
    expect(rotationIndexes('2026-08-20', 0, 1, SALT)).toEqual([]);
    expect(rotationIndexes('2026-08-20', 10, 0, SALT)).toEqual([]);
  });

  it('stays in range for dates before the epoch', () => {
    for (const date of ['1969-12-31', '1900-05-04']) {
      const [idx] = rotationIndexes(date, 37, 1, SALT);
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThan(37);
    }
  });

  it('cannot loop forever when asked for more than the pool holds', () => {
    const out = rotationIndexes('2026-08-20', 3, 5, SALT);
    expect(out).toHaveLength(5);
    for (const i of out) expect(i).toBeLessThan(3);
  });
});
