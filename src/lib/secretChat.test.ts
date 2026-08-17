import { describe, expect, it } from 'vitest';
import { formatRemaining, remainingMs, tickIntervalMs } from './secretChat';

const NOW = new Date('2026-08-17T12:00:00.000Z').getTime();
const at = (iso: string) => iso;

describe('remainingMs', () => {
  it('measures the gap to the deadline', () => {
    expect(remainingMs(at('2026-08-17T12:01:00.000Z'), NOW)).toBe(60_000);
    expect(remainingMs(at('2026-08-18T12:00:00.000Z'), NOW)).toBe(86_400_000);
  });

  it('is null when there is no timer (kept, or the timer was off)', () => {
    expect(remainingMs(null, NOW)).toBeNull();
    expect(remainingMs(undefined, NOW)).toBeNull();
  });

  it('never goes negative', () => {
    expect(remainingMs(at('2026-08-17T11:00:00.000Z'), NOW)).toBe(0);
  });

  it('returns null rather than a wrong number for an unreadable stamp', () => {
    expect(remainingMs('nonsense', NOW)).toBeNull();
  });
});

describe('formatRemaining', () => {
  it('shows one unit, the largest that is still true', () => {
    expect(formatRemaining(12_000)).toBe('12s');
    expect(formatRemaining(45 * 60_000)).toBe('45m');
    expect(formatRemaining(23 * 3_600_000)).toBe('23h');
    expect(formatRemaining(6 * 86_400_000)).toBe('6d');
  });

  it('rounds up inside a unit so a live message never reads as 0', () => {
    expect(formatRemaining(1)).toBe('1s');
    // Rounding up can carry into the next unit, which is the point: better to
    // promise slightly more time than to understate it and have a message
    // vanish "early" from the reader's perspective.
    expect(formatRemaining(59_001)).toBe('1m');
    expect(formatRemaining(60_001)).toBe('2m');
  });

  it('crosses each boundary into the larger unit rather than saying "60s"', () => {
    expect(formatRemaining(60_000)).toBe('1m');
    expect(formatRemaining(3_600_000)).toBe('1h');
    expect(formatRemaining(86_400_000)).toBe('1d');
    // Rounding up cascades: 59m59s is 60 minutes once rounded, which is an
    // hour, so it shows "1h". Comfortably inside a unit it stays in that unit.
    expect(formatRemaining(3_599_000)).toBe('1h');
    expect(formatRemaining(59_000)).toBe('59s');
    expect(formatRemaining(59 * 60_000)).toBe('59m');
    expect(formatRemaining(23 * 3_600_000)).toBe('23h');
  });

  it('says gone at and past zero', () => {
    expect(formatRemaining(0)).toBe('gone');
    expect(formatRemaining(-5)).toBe('gone');
  });

  it('shows nothing when there is no timer', () => {
    expect(formatRemaining(null)).toBeNull();
  });
});

describe('tickIntervalMs', () => {
  it('ticks every second only while seconds are on screen', () => {
    expect(tickIntervalMs(5_000)).toBe(1_000);
    expect(tickIntervalMs(60_000)).toBe(1_000);
  });

  it('slows down once nothing is counting seconds', () => {
    expect(tickIntervalMs(60_001)).toBe(30_000);
    expect(tickIntervalMs(86_400_000)).toBe(30_000);
  });

  it('does not tick at all with no timers in the thread', () => {
    expect(tickIntervalMs(null)).toBeNull();
  });
});
