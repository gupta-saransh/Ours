/**
 * This-or-That round scheduling, and who still has an unplayed round.
 *
 * Pure on purpose: both the game route (deciding which round a player is
 * answering) and the reminder cron (deciding who to nudge) need the same rules,
 * and neither should have to spin up a DB to reason about them.
 */

/**
 * How long after round one is settled the second question opens. Was 12 hours,
 * which meant the second question rarely arrived on the same evening the first
 * was played; 3 hours puts it inside the same part of the day while still
 * reading as a reward for playing rather than a second chore.
 */
export const ROUND_TWO_DELAY_MS = 3 * 60 * 60 * 1000;

export interface AnswerRow {
  user_id: string;
  pick: 'a' | 'b';
  guess: 'a' | 'b';
  pick2: 'a' | 'b' | null;
  guess2: 'a' | 'b' | null;
  created_at: string;
}

/**
 * Which round is in play for a couple, and when the next one opens.
 *
 * Round one is always available. Round two opens ROUND_TWO_DELAY_MS after BOTH
 * partners have answered round one, measured from the later of the two answers.
 */
export function roundStateFor(rows: AnswerRow[], now = Date.now()) {
  const bothPlayedOne = rows.length >= 2;
  if (!bothPlayedOne) return { round: 1 as const, opensAt: null as string | null };

  const times = rows.map((r) => new Date(r.created_at).getTime()).filter((t) => Number.isFinite(t));
  // No usable timestamp: stay on round one rather than let a NaN comparison
  // (every comparison with NaN is false) quietly open the second question.
  if (times.length === 0) return { round: 1 as const, opensAt: null as string | null };

  const opens = Math.max(...times) + ROUND_TWO_DELAY_MS;
  if (now < opens) return { round: 1 as const, opensAt: new Date(opens).toISOString() };
  return { round: 2 as const, opensAt: null as string | null };
}

/**
 * Has this person got a question sitting open right now?
 *
 * "Open" means the round the couple is currently on, and that this person has
 * not answered it. Deliberately NOT "their partner has not played": waiting on
 * the other person is not something a nudge to YOU can fix, and pestering
 * someone about a question they already answered is exactly how a reminder
 * turns into noise.
 */
export function hasUnplayedRound(rows: AnswerRow[], userId: string, now = Date.now()): boolean {
  const { round } = roundStateFor(rows, now);
  const mine = rows.find((r) => r.user_id === userId) ?? null;
  if (!mine) return true; // has not played round one at all
  return round === 2 ? mine.pick2 == null : false;
}
