import { describe, expect, it } from 'vitest';
import { addDays, computeStreak, mondayOf } from './streak';

// A fixed "today" (a Wednesday) so the week math is easy to reason about.
const TODAY = '2026-07-15'; // Wed
const d = (n: number) => addDays(TODAY, n); // d(-1) = yesterday, etc.

describe('computeStreak', () => {
  it('is zero with no mutual days', () => {
    expect(computeStreak([], TODAY)).toMatchObject({ current: 0, longest: 0, countedToday: false });
  });

  it('counts a single day answered today as 1', () => {
    expect(computeStreak([TODAY], TODAY)).toMatchObject({ current: 1, longest: 1, countedToday: true });
  });

  it('counts two days in a row as 2, not more (the reported bug)', () => {
    const s = computeStreak([d(-1), TODAY], TODAY);
    expect(s.current).toBe(2);
    expect(s.longest).toBe(2);
    expect(s.countedToday).toBe(true);
  });

  it('counts a long unbroken run exactly', () => {
    const days = [d(-4), d(-3), d(-2), d(-1), TODAY];
    expect(computeStreak(days, TODAY).current).toBe(5);
  });

  it('keeps the streak alive (at risk) when today is not answered yet but yesterday was', () => {
    const s = computeStreak([d(-2), d(-1)], TODAY);
    expect(s.current).toBe(2);
    expect(s.countedToday).toBe(false);
    expect(s.atRisk).toBe(true);
  });

  it('forgives a single missed day within a week (grace)', () => {
    // answered ... 3 days ago, skipped 2 days ago, answered yesterday + today
    const s = computeStreak([d(-3), d(-1), TODAY], TODAY);
    expect(s.current).toBe(3);
  });

  it('breaks on two missed days in a row', () => {
    // answered 3 days ago, then a two-day gap, then today
    const s = computeStreak([d(-3), TODAY], TODAY);
    expect(s.current).toBe(1); // only today survives
  });

  it('lapses to 0 when the last mutual day is too old', () => {
    const s = computeStreak([d(-5), d(-4)], TODAY);
    expect(s.current).toBe(0);
    expect(s.atRisk).toBe(false);
    expect(s.longest).toBe(2); // history is remembered
  });

  it('remembers the longest run even after the current one lapses', () => {
    const days = [d(-20), d(-19), d(-18), d(-17), d(-2), d(-1), TODAY];
    const s = computeStreak(days, TODAY);
    expect(s.current).toBe(3);
    expect(s.longest).toBe(4);
  });

  it('does not let grace bridge two gaps in the same week', () => {
    // Within one Mon-Sun week: answer Mon, skip Tue, answer Wed, skip Thu, answer Fri.
    const mon = mondayOf(TODAY);
    const days = [addDays(mon, 0), addDays(mon, 2), addDays(mon, 4)];
    // Evaluate as of Friday of that week.
    const s = computeStreak(days, addDays(mon, 4));
    // Fri counts (1), grace bridges Thu to Wed (2), grace for this week is now
    // spent, so the Tue gap breaks the walk: Wed is the end of the run.
    expect(s.current).toBe(2);
  });
});
