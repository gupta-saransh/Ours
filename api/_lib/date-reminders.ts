/**
 * Pure logic for the upcoming-date reminders (used by cron-reminders.ts,
 * kind=dates). Kept out of the route so it can be unit-tested without a DB.
 */

export interface ReminderFlags {
  reminded_24: boolean;
  reminded_6: boolean;
  reminded_1: boolean;
}

export interface ReminderDecision {
  body: string;
  /** The flag state to persist after sending (earlier thresholds marked sent too). */
  flags: ReminderFlags;
}

/**
 * Given how many hours away a date is and which of its reminders have already
 * fired, decide the single most-urgent reminder to send right now, or null.
 *
 * The cron runs hourly, so a date added inside a window (e.g. only 40 minutes
 * away) should send just the most-urgent applicable reminder and mark every
 * earlier threshold as sent, so it never bursts all three at once and none ever
 * repeats. Dates more than ~2 hours in the past get nothing (the reflection flow
 * takes over there).
 */
export function pickDateReminder(hoursUntil: number, flags: ReminderFlags): ReminderDecision | null {
  const { reminded_24, reminded_6, reminded_1 } = flags;

  if (hoursUntil <= 1.5 && hoursUntil > -2 && !reminded_1) {
    return { body: 'Your date is almost here. ♥', flags: { reminded_24: true, reminded_6: true, reminded_1: true } };
  }
  if (hoursUntil <= 6 && hoursUntil > 1.5 && !reminded_6) {
    return { body: 'Your date is in a few hours. ♥', flags: { reminded_24: true, reminded_6: true, reminded_1 } };
  }
  if (hoursUntil <= 24 && hoursUntil > 6 && !reminded_24) {
    return { body: 'A date is coming up soon. ♥', flags: { reminded_24: true, reminded_6, reminded_1 } };
  }
  return null;
}
