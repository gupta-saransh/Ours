const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_FULL = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const WEEKDAYS_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();

export function formatDay(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffDays = Math.round((startOfDay(now) - startOfDay(d)) / 86_400_000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/**
 * A chat day-separator label, WhatsApp-style: Today / Yesterday, then the
 * weekday name for the rest of the past week ("Wednesday"), then a dated form
 * for anything older ("Tuesday, 14 July", with the year appended when it is not
 * the current one). `now` is injectable so the rule is unit-testable.
 */
export function formatChatDay(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  const diffDays = Math.round((startOfDay(now) - startOfDay(d)) / 86_400_000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays > 1 && diffDays < 7) return WEEKDAYS_FULL[d.getDay()];
  const dated = `${WEEKDAYS_FULL[d.getDay()]}, ${d.getDate()} ${MONTHS_FULL[d.getMonth()]}`;
  return d.getFullYear() === now.getFullYear() ? dated : `${dated} ${d.getFullYear()}`;
}

/** Whether two ISO timestamps fall on the same local calendar day. */
export function sameLocalDay(a: string, b: string): boolean {
  return startOfDay(new Date(a)) === startOfDay(new Date(b));
}

export function formatTime(iso: string): string {
  const d = new Date(iso);
  const h = d.getHours() % 12 || 12;
  const m = d.getMinutes().toString().padStart(2, '0');
  return `${h}:${m} ${d.getHours() >= 12 ? 'pm' : 'am'}`;
}

/** Milestone date as a local Date (dates come back as YYYY-MM-DD or ISO). */
export function milestoneDate(date: string): Date {
  const [y, m, d] = date.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** Anniversaries and birthdays recur yearly; custom dates don't. */
export function nextOccurrence(date: string, kind: string, now = new Date()): Date {
  const base = milestoneDate(date);
  if (kind === 'custom') return base;
  const next = new Date(now.getFullYear(), base.getMonth(), base.getDate());
  if (next.getTime() < new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) {
    next.setFullYear(now.getFullYear() + 1);
  }
  return next;
}

/** Whole days from a date (YYYY-MM-DD or ISO) to today, never negative. */
export function daysSince(date: string, now = new Date()): number {
  const start = milestoneDate(date.slice(0, 10));
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.max(0, Math.round((today.getTime() - start.getTime()) / 86_400_000));
}

export interface Countdown {
  past: boolean;
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
}

export function countdownTo(target: Date, now = new Date()): Countdown {
  let ms = target.getTime() - now.getTime();
  const past = ms < 0;
  if (past) ms = -ms;
  const days = Math.floor(ms / 86_400_000);
  const hours = Math.floor((ms % 86_400_000) / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  const seconds = Math.floor((ms % 60_000) / 1000);
  return { past, days, hours, minutes, seconds };
}
