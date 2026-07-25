import { describe, expect, it } from 'vitest';
import {
  daysBetweenUTC,
  daysInMonthUTC,
  dueCoupleMilestones,
  dueFiftyDay,
  dueMonthlyAnniversary,
  monthlyAnniversaryFireDay,
  monthsBetween,
  type CoupleMilestoneRow,
} from './couple-milestones';

describe('daysInMonthUTC', () => {
  it('knows month lengths including leap February', () => {
    expect(daysInMonthUTC(2026, 1)).toBe(31); // Jan
    expect(daysInMonthUTC(2026, 2)).toBe(28); // Feb, non-leap
    expect(daysInMonthUTC(2024, 2)).toBe(29); // Feb, leap
    expect(daysInMonthUTC(2026, 4)).toBe(30); // Apr
  });
});

describe('monthlyAnniversaryFireDay', () => {
  it('is the anniversary day when the month is long enough', () => {
    expect(monthlyAnniversaryFireDay(15, 2026, 7)).toBe(15);
  });

  it('falls back to the last day of a month too short to hold it', () => {
    expect(monthlyAnniversaryFireDay(31, 2026, 2)).toBe(28); // Feb, non-leap
    expect(monthlyAnniversaryFireDay(31, 2024, 2)).toBe(29); // Feb, leap
    expect(monthlyAnniversaryFireDay(31, 2026, 4)).toBe(30); // 30-day April
  });
});

describe('monthsBetween', () => {
  it('counts full elapsed months', () => {
    expect(monthsBetween('2020-01-15', '2020-02-15')).toBe(1);
    expect(monthsBetween('2020-01-15', '2021-01-15')).toBe(12);
    expect(monthsBetween('2020-01-15', '2026-07-15')).toBe(78);
  });

  it('does not count the current month until its fire day arrives', () => {
    expect(monthsBetween('2020-01-15', '2020-02-14')).toBe(0);
    expect(monthsBetween('2020-01-15', '2020-02-15')).toBe(1);
  });
});

describe('daysBetweenUTC', () => {
  it('counts whole days', () => {
    expect(daysBetweenUTC('2026-01-01', '2026-02-20')).toBe(50);
    expect(daysBetweenUTC('2026-01-01', '2026-01-01')).toBe(0);
  });
});

describe('dueMonthlyAnniversary', () => {
  const base: CoupleMilestoneRow = {
    couple_id: 'c1',
    created_at: '2020-01-15',
    anniversary: '2020-01-15',
    last_monthly_anniversary_sent: null,
    last_fifty_day_notified: 0,
  };

  it('fires on the fire day with the elapsed month count', () => {
    expect(dueMonthlyAnniversary(base, '2020-02-15')).toBe(1);
    expect(dueMonthlyAnniversary(base, '2026-08-15')).toBe(79);
  });

  it('does not fire on other days of the month', () => {
    expect(dueMonthlyAnniversary(base, '2020-02-14')).toBeNull();
    expect(dueMonthlyAnniversary(base, '2020-02-16')).toBeNull();
  });

  it('fires on the last day for a short month (anniversary on the 31st)', () => {
    const row = { ...base, anniversary: '2020-01-31', created_at: '2020-01-31' };
    expect(dueMonthlyAnniversary(row, '2020-02-29')).toBe(1); // 2020 Feb has 29 days
    expect(dueMonthlyAnniversary(row, '2020-02-28')).toBeNull();
  });

  it('skips the month that coincides with the yearly anniversary', () => {
    // 12 months would double up with the anniversary countdown, so stay quiet.
    expect(dueMonthlyAnniversary(base, '2021-01-15')).toBeNull();
    expect(dueMonthlyAnniversary(base, '2022-01-15')).toBeNull();
  });

  it('never fires in the anniversary month itself (month 0)', () => {
    expect(dueMonthlyAnniversary(base, '2020-01-15')).toBeNull();
  });

  it('does not re-send when already sent today', () => {
    expect(dueMonthlyAnniversary({ ...base, last_monthly_anniversary_sent: '2020-02-15' }, '2020-02-15')).toBeNull();
  });

  it('is null for a couple with no anniversary set', () => {
    expect(dueMonthlyAnniversary({ ...base, anniversary: null }, '2020-02-15')).toBeNull();
  });
});

describe('dueFiftyDay', () => {
  it('fires at the first 50-day mark', () => {
    expect(dueFiftyDay('2026-01-01', '2026-02-20', 0)).toBe(50); // 50 days later
  });

  it('does not fire before 50 days', () => {
    expect(dueFiftyDay('2026-01-01', '2026-02-19', 0)).toBeNull(); // 49 days
    expect(dueFiftyDay('2026-01-01', '2026-01-01', 0)).toBeNull();
  });

  it('fires once per multiple, not every day', () => {
    expect(dueFiftyDay('2026-01-01', '2026-02-21', 50)).toBeNull(); // day 51, already sent 50
  });

  it('sends only the HIGHEST multiple when a run was missed', () => {
    // Day 103, last sent 50: announce 100 once, not 100 then 50 backfilled.
    expect(dueFiftyDay('2026-01-01', '2026-04-14', 50)).toBe(100);
  });

  it('advances to the next multiple after the previous was sent', () => {
    expect(dueFiftyDay('2026-01-01', '2026-05-31', 100)).toBe(150); // day 150
  });

  it('is NaN-safe for an unreadable created_at', () => {
    expect(dueFiftyDay('not-a-date', '2026-02-20', 0)).toBeNull();
  });
});

describe('dueCoupleMilestones', () => {
  it('returns only couples with something to send', () => {
    const rows: CoupleMilestoneRow[] = [
      // Anniversary on the 20th -> fires this Feb 20; created recently -> no tenure.
      { couple_id: 'monthly', created_at: '2026-02-10', anniversary: '2020-06-20', last_monthly_anniversary_sent: null, last_fifty_day_notified: 0 },
      // No anniversary, but 50 days on the app today.
      { couple_id: 'tenure', created_at: '2026-01-01', anniversary: null, last_monthly_anniversary_sent: null, last_fifty_day_notified: 0 },
      // Anniversary on the 15th (not today), created 1 day ago -> nothing.
      { couple_id: 'neither', created_at: '2026-02-19', anniversary: '2020-01-15', last_monthly_anniversary_sent: null, last_fifty_day_notified: 0 },
    ];
    const due = dueCoupleMilestones(rows, '2026-02-20');
    const ids = due.map((d) => d.couple_id);
    expect(ids).toContain('monthly');
    expect(ids).toContain('tenure');
    expect(ids).not.toContain('neither');
  });

  it('can carry both a monthly and a tenure hit for one couple', () => {
    const rows: CoupleMilestoneRow[] = [
      // 50 days on the app today, and a (non-yearly) monthly anniversary on the 20th.
      { couple_id: 'both', created_at: '2026-01-01', anniversary: '2020-06-20', last_monthly_anniversary_sent: null, last_fifty_day_notified: 0 },
    ];
    const due = dueCoupleMilestones(rows, '2026-02-20');
    expect(due[0].monthly).not.toBeNull();
    expect(due[0].tenure).toBe(50);
  });
});
