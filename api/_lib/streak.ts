/**
 * Prompt streak, computed from the source of truth.
 *
 * A day counts toward the streak ONLY when both partners answered that day's
 * prompt (a "mutual day"). Rather than maintain a running counter that can
 * drift (double reveals, a partial write, a timezone edge), we derive the whole
 * streak from the set of mutual days every time. Days are UTC, matching the
 * prompt's own day boundary and the reflection weeks.
 *
 * Grace: one missed day per Monday-to-Sunday (UTC) week is forgiven, so a
 * single slip keeps the streak alive. Two misses in a row, or a second miss in
 * the same week, ends it.
 *
 * These functions are pure (no DB, no clock) so they are unit-testable; the
 * route supplies the mutual-day list and today's UTC date.
 */

export interface StreakState {
  current: number;
  longest: number;
  countedToday: boolean;
  atRisk: boolean; // the streak is alive but today has not been counted yet
  graceUsed?: boolean; // the current run is only alive because a weekly grace covered a miss
  /** This week's single grace day is still unspent, so one slip is survivable. */
  graceAvailable?: boolean;
  /** The day this week's grace covered, when it has been spent (UTC, YYYY-MM-DD). */
  graceDay?: string | null;
}

export function addDays(dateStr: string, n: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Monday (UTC) of the week that owns `dateStr`. Weeks run Monday to Sunday. */
export function mondayOf(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  return addDays(dateStr, -((d.getUTCDay() + 6) % 7));
}

/**
 * Length of the run of mutual days ending exactly at `endDay` (which must
 * itself be a mutual day), walking backward. One gap per week is bridged by
 * grace; a second gap in a week, or two adjacent gaps, stops the walk.
 */
function runEndingAt(set: Set<string>, endDay: string): number {
  if (!set.has(endDay)) return 0;
  let count = 0;
  let day = endDay;
  const graceSpent = new Set<string>();
  while (true) {
    if (set.has(day)) {
      count++;
      day = addDays(day, -1);
      continue;
    }
    // `day` is a gap. Try to fund it from its week's single grace.
    const wk = mondayOf(day);
    if (graceSpent.has(wk)) break; // this week's grace is already spent
    if (!set.has(addDays(day, -1))) break; // nothing before the gap to keep going
    graceSpent.add(wk);
    day = addDays(day, -1);
  }
  return count;
}

/**
 * The full streak view for a couple, given every mutual day (ascending) and
 * today's UTC date.
 */
export function computeStreak(mutualDaysAsc: string[], today: string): StreakState {
  const set = new Set(mutualDaysAsc);
  if (set.size === 0) {
    return {
      current: 0,
      longest: 0,
      countedToday: false,
      atRisk: false,
      graceUsed: false,
      // No streak to protect yet, but the week's grace is genuinely untouched.
      graceAvailable: true,
      graceDay: null,
    };
  }

  // Current run: walk backward from today. Today, if not yet answered, is
  // "pending" (not a miss) so the streak carried from yesterday stays alive; it
  // never consumes grace. Every earlier unanswered day is a real gap.
  const countedToday = set.has(today);
  let current = 0;
  let day = today;
  let pendingToday = !countedToday;
  const graceSpent = new Set<string>();
  // Which day this week's grace ended up covering, for the UI to name it.
  let graceDay: string | null = null;
  while (true) {
    if (set.has(day)) {
      current++;
      day = addDays(day, -1);
      pendingToday = false;
      continue;
    }
    if (pendingToday) {
      // Today is simply not answered yet; move to yesterday without penalty.
      day = addDays(day, -1);
      pendingToday = false;
      continue;
    }
    const wk = mondayOf(day);
    if (graceSpent.has(wk)) break;
    if (!set.has(addDays(day, -1))) break;
    graceSpent.add(wk);
    if (wk === mondayOf(today)) graceDay = day;
    day = addDays(day, -1);
  }

  // Longest run anywhere in history.
  let longest = current;
  for (const d of set) {
    const r = runEndingAt(set, d);
    if (r > longest) longest = r;
  }

  const graceUsed = graceSpent.has(mondayOf(today));
  return {
    current,
    longest,
    countedToday,
    atRisk: current > 0 && !countedToday,
    graceUsed,
    graceAvailable: !graceUsed,
    graceDay,
  };
}
