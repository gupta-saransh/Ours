/**
 * Pure countdown math for milestone reminders (used by home.ts for the Home
 * banner and cron-reminders.ts, kind=milestone, for the daily push). Kept out
 * of both routes so it can be unit-tested without a DB.
 *
 * UTC day-strings in and out throughout, matching every other day-boundary
 * calculation in the app (streak.ts, date-reminders.ts, todos.ts) rather than
 * JS Date local-time math, which would drift by a day depending on server vs.
 * client timezone.
 */

export interface MilestoneCountdownInput {
  date: string; // YYYY-MM-DD, the ORIGINAL date (year is irrelevant for a recurring one)
  kind: string; // anniversary | birthday | custom
}

function toUTCms(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

/**
 * The next time this milestone lands, as YYYY-MM-DD. Anniversaries and
 * birthdays recur yearly; a custom date does not and always returns itself.
 */
export function nextOccurrenceUTC(m: MilestoneCountdownInput, todayUTC: string): string {
  const day = m.date.slice(0, 10);
  if (m.kind === 'custom') return day;
  const [, mm, dd] = day.split('-');
  const [ty] = todayUTC.split('-');
  let candidate = `${ty}-${mm}-${dd}`;
  if (candidate < todayUTC) candidate = `${Number(ty) + 1}-${mm}-${dd}`;
  return candidate;
}

/** Whole days from today (UTC) to a target YYYY-MM-DD. 0 = today, negative = past. */
export function daysUntilUTC(target: string, todayUTC: string): number {
  return Math.round((toUTCms(target) - toUTCms(todayUTC)) / 86_400_000);
}

export interface MilestoneRow extends MilestoneCountdownInput {
  id: string;
  notify_days_before: number;
  last_reminded_date: string | null;
}

export interface DueCountdown {
  id: string;
  daysUntil: number;
  nextOccurrence: string;
}

/**
 * Which milestones are due a countdown reminder right now: their window is
 * open (0 <= days until <= notify_days_before) and today has not already sent
 * one. notify_days_before <= 0 means the countdown is off for that milestone.
 */
export function dueForCountdown(rows: MilestoneRow[], todayUTC: string): DueCountdown[] {
  const out: DueCountdown[] = [];
  for (const m of rows) {
    if (m.notify_days_before <= 0) continue;
    if (m.last_reminded_date === todayUTC) continue;
    const next = nextOccurrenceUTC(m, todayUTC);
    const daysUntil = daysUntilUTC(next, todayUTC);
    if (daysUntil >= 0 && daysUntil <= m.notify_days_before) {
      out.push({ id: m.id, daysUntil, nextOccurrence: next });
    }
  }
  return out;
}
