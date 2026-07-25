/**
 * Pure date math for the two couple-level reminders the daily milestone cron
 * fires (kind=milestone): the monthly anniversary ("N months together today")
 * and the app-tenure milestone ("50 days with Ours"). Kept out of the route so
 * the rules can be unit-tested without a DB (same shape as milestone-countdown.ts
 * and streak.ts).
 *
 * UTC day-strings ('YYYY-MM-DD') in and out throughout. The cron passes DATE-cast
 * values, so inputs are already whole UTC days; we slice(0,10) defensively.
 */

function parts(dateStr: string): [number, number, number] {
  const [y, m, d] = dateStr.slice(0, 10).split('-').map(Number);
  return [y, m, d];
}

function toUTCms(dateStr: string): number {
  const [y, m, d] = parts(dateStr);
  return Date.UTC(y, m - 1, d);
}

/** Days in month `m` (1-12) of `year`, honouring leap Februaries. */
export function daysInMonthUTC(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * The day-of-month a monthly anniversary lands on for a given month. Normally
 * the anniversary's own day; for a month too short to hold it (anniversary on
 * the 31st, February) it lands on that month's LAST day instead, so it is never
 * skipped.
 */
export function monthlyAnniversaryFireDay(anniversaryDay: number, year: number, month: number): number {
  return Math.min(anniversaryDay, daysInMonthUTC(year, month));
}

/** Whole days between two UTC date-strings (b - a). Rounded; NaN-safe upstream. */
export function daysBetweenUTC(from: string, to: string): number {
  return Math.round((toUTCms(to) - toUTCms(from)) / 86_400_000);
}

/**
 * Full elapsed months from `anniversary` to `today`, both UTC date-strings. The
 * current month only counts once today reaches that month's fire day.
 */
export function monthsBetween(anniversary: string, today: string): number {
  const [ay, am, ad] = parts(anniversary);
  const [ty, tm, td] = parts(today);
  let months = (ty - ay) * 12 + (tm - am);
  const fireDay = monthlyAnniversaryFireDay(ad, ty, tm);
  if (td < fireDay) months -= 1;
  return months;
}

export interface CoupleMilestoneRow {
  couple_id: string;
  /** couples.created_at, DATE-cast to a UTC day. */
  created_at: string;
  /** The earliest anniversary milestone's date, or null if the couple set none. */
  anniversary: string | null;
  /** couples.last_monthly_anniversary_sent (UTC day), or null. */
  last_monthly_anniversary_sent: string | null;
  /** couples.last_fifty_day_notified: the highest 50-multiple already sent (0 = none). */
  last_fifty_day_notified: number;
}

export interface CoupleMilestoneDue {
  couple_id: string;
  /** Months to announce today, or null. */
  monthly: number | null;
  /** The 50-day tenure multiple to announce today, or null. */
  tenure: number | null;
}

/**
 * Whether a monthly-anniversary push is due today, and for how many months.
 * Fires only on the month's fire day, only from month 1 on, and NOT on a month
 * that coincides with the yearly anniversary (months % 12 === 0) since the
 * milestone countdown already celebrates that day richly. Deduped by the sent
 * stamp so a same-day re-run is silent. Couples with no anniversary are skipped.
 */
export function dueMonthlyAnniversary(row: CoupleMilestoneRow, today: string): number | null {
  if (!row.anniversary) return null;
  const [, , ad] = parts(row.anniversary);
  const [ty, tm, td] = parts(today);
  if (!Number.isFinite(ad) || !Number.isFinite(td)) return null;
  if (td !== monthlyAnniversaryFireDay(ad, ty, tm)) return null;
  const months = monthsBetween(row.anniversary, today);
  if (months < 1) return null;
  if (months % 12 === 0) return null;
  if (row.last_monthly_anniversary_sent === today) return null;
  return months;
}

/** How many days a couple has been ON the app, as a multiple of 50, at least 50. */
export const FIFTY_DAY_STEP = 50;

/**
 * Whether an app-tenure push is due, and which 50-day multiple to announce. Only
 * the HIGHEST multiple reached beyond what was last sent fires, so a cron run
 * that skipped a threshold sends once for the newest one, never backfilling
 * every missed step.
 */
export function dueFiftyDay(createdAt: string, today: string, lastNotified: number): number | null {
  const days = daysBetweenUTC(createdAt, today);
  if (!Number.isFinite(days) || days < FIFTY_DAY_STEP) return null;
  const multiple = Math.floor(days / FIFTY_DAY_STEP) * FIFTY_DAY_STEP;
  if (multiple <= (lastNotified || 0)) return null;
  return multiple;
}

/** Per-couple decisions for today; only couples with something to send are returned. */
export function dueCoupleMilestones(rows: CoupleMilestoneRow[], today: string): CoupleMilestoneDue[] {
  const out: CoupleMilestoneDue[] = [];
  for (const row of rows) {
    const monthly = dueMonthlyAnniversary(row, today);
    const tenure = dueFiftyDay(row.created_at, today, row.last_fifty_day_notified);
    if (monthly !== null || tenure !== null) {
      out.push({ couple_id: row.couple_id, monthly, tenure });
    }
  }
  return out;
}
