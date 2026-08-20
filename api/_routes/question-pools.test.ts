import { describe, expect, it } from 'vitest';
import { PROMPT_POOL, promptIndexFor } from './prompts';
import { GAME_POOL } from './game';
import { dayNumber, rotationIndexes } from '../_lib/daily-rotation';

/**
 * The question pools themselves, guarded against the two ways this feature
 * quietly rots:
 *
 *  1. A DUPLICATE ENTRY. The rotation guarantees each *index* is served once
 *     per lap, which is worthless if two indexes hold the same question. The
 *     pools are hand-written and long, so this is a real risk every time
 *     somebody adds a batch, and it fails silently: it just feels like the
 *     repetition bug came back.
 *  2. SHRINKING RUNWAY. Pool size IS the promise here (N entries = N draws
 *     before anything repeats), so a floor on the size is a floor on the
 *     promise. This-or-That burns two a day, which halves its runway in days.
 */

const normalise = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]/g, '');

function duplicatesIn(values: string[]): string[] {
  const seen = new Set<string>();
  const dupes: string[] = [];
  for (const v of values) {
    const key = normalise(v);
    if (seen.has(key)) dupes.push(v);
    seen.add(key);
  }
  return dupes;
}

/** Every index the rotation serves over `draws` consecutive days. */
function schedule(startDate: string, days: number, size: number, count: number, salt: string): number[] {
  const start = dayNumber(startDate)!;
  const out: number[] = [];
  for (let d = 0; d < days; d++) {
    const iso = new Date((start + d) * 86_400_000).toISOString().slice(0, 10);
    out.push(...rotationIndexes(iso, size, count, salt));
  }
  return out;
}

describe('the daily prompt pool', () => {
  it('asks no question twice', () => {
    expect(duplicatesIn(PROMPT_POOL)).toEqual([]);
  });

  it('holds enough for months before anything comes round again', () => {
    expect(PROMPT_POOL.length).toBeGreaterThanOrEqual(150);
  });

  it('has no blank or stub entries', () => {
    for (const p of PROMPT_POOL) expect(p.trim().length).toBeGreaterThan(10);
  });

  it('never uses an em dash (house copy rule)', () => {
    expect(PROMPT_POOL.filter((p) => p.includes('—'))).toEqual([]);
  });

  it('serves every question exactly once before repeating any', () => {
    // The actual promise, measured against the real pool rather than a toy one.
    const start = dayNumber('2026-08-20')!;
    const seen: number[] = [];
    for (let d = 0; d < PROMPT_POOL.length; d++) {
      const iso = new Date((start + d) * 86_400_000).toISOString().slice(0, 10);
      seen.push(promptIndexFor(iso));
    }
    expect(new Set(seen).size).toBe(PROMPT_POOL.length);
  });

  it('is stable for a given day, so a reload does not change the question', () => {
    expect(promptIndexFor('2026-08-20')).toBe(promptIndexFor('2026-08-20'));
  });
});

describe('the This-or-That pool', () => {
  it('offers no pair twice', () => {
    expect(duplicatesIn(GAME_POOL.map((p) => `${p.a}|${p.b}`))).toEqual([]);
  });

  it('does not reuse the same option text across pairs', () => {
    // Two different questions sharing an option reads as a repeat even when the
    // pair is technically new.
    expect(duplicatesIn(GAME_POOL.flatMap((p) => [p.a, p.b]))).toEqual([]);
  });

  it('holds enough for two a day for a couple of months', () => {
    expect(GAME_POOL.length).toBeGreaterThanOrEqual(120);
  });

  it('keeps both sides short enough to read in a glance', () => {
    for (const pair of GAME_POOL) {
      expect(pair.a.trim().length).toBeGreaterThan(1);
      expect(pair.b.trim().length).toBeGreaterThan(1);
      // The two options sit side by side in one row on a phone.
      expect(pair.a.length).toBeLessThanOrEqual(30);
      expect(pair.b.length).toBeLessThanOrEqual(30);
    }
  });

  it('never uses an em dash (house copy rule)', () => {
    expect(GAME_POOL.flatMap((p) => [p.a, p.b]).filter((o) => o.includes('—'))).toEqual([]);
  });

  it('serves every pair exactly once before repeating any, two rounds a day', () => {
    const size = GAME_POOL.length;
    const seen = schedule('2026-08-20', Math.floor(size / 2), size, 2, 'ours-this-or-that-v1');
    expect(new Set(seen).size).toBe(seen.length);
  });

  it('never plays the same pair twice in one day', () => {
    const start = dayNumber('2026-08-20')!;
    for (let d = 0; d < 400; d++) {
      const iso = new Date((start + d) * 86_400_000).toISOString().slice(0, 10);
      const [first, second] = rotationIndexes(iso, GAME_POOL.length, 2, 'ours-this-or-that-v1');
      expect(first).not.toBe(second);
    }
  });
});
