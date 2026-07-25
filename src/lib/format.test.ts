import { describe, expect, it } from 'vitest';
import { formatChatDay, sameLocalDay } from './format';

// Local weekday names, computed the same way the code does, so the assertions
// hold in any timezone the suite runs in.
const WD = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const at = (y: number, m0: number, d: number) => new Date(y, m0, d, 12, 0, 0);

describe('formatChatDay', () => {
  const now = at(2026, 6, 15); // noon, 15 July 2026

  it('labels today and yesterday', () => {
    expect(formatChatDay(at(2026, 6, 15).toISOString(), now)).toBe('Today');
    expect(formatChatDay(at(2026, 6, 14).toISOString(), now)).toBe('Yesterday');
  });

  it('uses the weekday name for the rest of the past week', () => {
    const threeAgo = at(2026, 6, 12);
    expect(formatChatDay(threeAgo.toISOString(), now)).toBe(WD[threeAgo.getDay()]);
  });

  it('uses a dated form for older days in the same year, no year shown', () => {
    const jan5 = at(2026, 0, 5);
    expect(formatChatDay(jan5.toISOString(), now)).toBe(`${WD[jan5.getDay()]}, 5 January`);
  });

  it('appends the year once the day is in a different year', () => {
    const dec20 = at(2025, 11, 20);
    expect(formatChatDay(dec20.toISOString(), now)).toBe(`${WD[dec20.getDay()]}, 20 December 2025`);
  });
});

describe('sameLocalDay', () => {
  it('is true for two instants on the same calendar day', () => {
    expect(sameLocalDay(at(2026, 6, 15).toISOString(), new Date(2026, 6, 15, 8, 30).toISOString())).toBe(true);
  });
  it('is false across a day boundary', () => {
    expect(sameLocalDay(at(2026, 6, 15).toISOString(), at(2026, 6, 14).toISOString())).toBe(false);
  });
});
