import { describe, expect, it } from 'vitest';
import { daysUntilUTC, dueForCountdown, nextOccurrenceUTC, type MilestoneRow } from './milestone-countdown';

describe('nextOccurrenceUTC', () => {
  it('stays this year when the birthday has not happened yet', () => {
    expect(nextOccurrenceUTC({ date: '1998-08-12', kind: 'birthday' }, '2026-07-19')).toBe('2026-08-12');
  });

  it('rolls to next year once the date has passed', () => {
    expect(nextOccurrenceUTC({ date: '1998-01-05', kind: 'birthday' }, '2026-07-19')).toBe('2027-01-05');
  });

  it('treats today itself as this year, not next', () => {
    expect(nextOccurrenceUTC({ date: '1998-07-19', kind: 'anniversary' }, '2026-07-19')).toBe('2026-07-19');
  });

  it('never recurs a custom date', () => {
    expect(nextOccurrenceUTC({ date: '2027-03-01', kind: 'custom' }, '2026-07-19')).toBe('2027-03-01');
  });
});

describe('daysUntilUTC', () => {
  it('counts whole days ahead', () => {
    expect(daysUntilUTC('2026-07-26', '2026-07-19')).toBe(7);
  });
  it('is zero for today', () => {
    expect(daysUntilUTC('2026-07-19', '2026-07-19')).toBe(0);
  });
  it('is negative for the past', () => {
    expect(daysUntilUTC('2026-07-10', '2026-07-19')).toBe(-9);
  });
});

describe('dueForCountdown', () => {
  const today = '2026-07-19';
  const row = (over: Partial<MilestoneRow> = {}): MilestoneRow => ({
    id: 'm1',
    date: '1998-07-26', // 7 days out
    kind: 'birthday',
    notify_days_before: 7,
    last_reminded_date: null,
    ...over,
  });

  it('is due when inside the window', () => {
    expect(dueForCountdown([row()], today)).toEqual([{ id: 'm1', daysUntil: 7, nextOccurrence: '2026-07-26' }]);
  });

  it('is not due when outside the window', () => {
    expect(dueForCountdown([row({ date: '1998-08-12' })], today)).toEqual([]);
  });

  it('is still due exactly on the day (0 days out)', () => {
    expect(dueForCountdown([row({ date: '1998-07-19' })], today)).toEqual([
      { id: 'm1', daysUntil: 0, nextOccurrence: '2026-07-19' },
    ]);
  });

  it('is off when notify_days_before is 0', () => {
    expect(dueForCountdown([row({ notify_days_before: 0 })], today)).toEqual([]);
  });

  it('does not repeat once already reminded today', () => {
    expect(dueForCountdown([row({ last_reminded_date: today })], today)).toEqual([]);
  });

  it('fires again on a later day even if reminded a previous day', () => {
    expect(dueForCountdown([row({ last_reminded_date: '2026-07-18' })], today)).toHaveLength(1);
  });

  it('never fires for a day that has already passed', () => {
    expect(dueForCountdown([row({ date: '1998-07-01', kind: 'custom' })], today)).toEqual([]);
  });
});
