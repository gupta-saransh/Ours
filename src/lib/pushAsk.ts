/**
 * The record of how often we have asked for notifications, shared by the
 * onboarding step and the standalone invite card so the two can never disagree.
 *
 * A browser gives exactly one real permission prompt: once it is dismissed, the
 * answer is remembered and only browser settings can undo it. So asks are
 * spaced out and capped, and a definitive answer (granted, or blocked) stops
 * them for good. Nagging is what turns a "maybe later" into a permanent block.
 */

const ASK_KEY = 'ours.push-ask';

/** Days to wait before ask #1, #2, #3. After the last one we never ask again. */
export const WAIT_DAYS = [0, 3, 10];

export interface AskRecord {
  /** How many times the ask has been shown. */
  n: number;
  /** ISO timestamp of the last showing. */
  at: string;
  /** The "your partner joined" ask is allowed once, outside the schedule. */
  pairedAsked?: boolean;
  /** They granted, or the browser blocked us. Either way, stop asking. */
  done?: boolean;
  /**
   * Was the last ask made from the installed app? A "maybe later" given in a
   * browser tab is not a refusal of notifications: on an iPhone that tab could
   * not have subscribed at all. Installing changes the answer, so it earns one
   * fresh ask.
   */
  askedStandalone?: boolean;
}

export function readPushAsk(): AskRecord {
  try {
    const raw = localStorage.getItem(ASK_KEY);
    return raw ? (JSON.parse(raw) as AskRecord) : { n: 0, at: '' };
  } catch {
    return { n: 0, at: '' };
  }
}

export function writePushAsk(next: AskRecord): void {
  try {
    localStorage.setItem(ASK_KEY, JSON.stringify(next));
  } catch {
    // Private mode. We simply ask again next time.
  }
}

/**
 * Record that the ask has been answered for good (`final`) or merely deferred.
 * Onboarding calls this so a skip there feeds the same schedule the invite card
 * reads, instead of asking again the moment they reach Home.
 */
export function markPushAskDeclined(final: boolean, standalone = false): void {
  const record = readPushAsk();
  writePushAsk({
    ...record,
    n: record.n + 1,
    at: new Date().toISOString(),
    askedStandalone: standalone,
    ...(final ? { done: true } : {}),
  });
}

export function daysSince(iso: string): number {
  if (!iso) return Infinity;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return Infinity;
  return (Date.now() - then) / 86_400_000;
}

/**
 * Is another ask due right now?
 *
 * `standalone` is whether we are running from the home screen. Adding Ours to
 * the home screen is the one event that earns a fresh ask no matter what the
 * schedule says: every earlier "maybe later" was answered in a browser tab,
 * which on an iPhone could not have subscribed even if they had said yes, and
 * on Android shares this same storage so the cooldown would otherwise follow
 * them into the installed app. Someone who installed to get notifications must
 * not be met with silence. Only a definitive answer (`done`, meaning they
 * granted or the browser blocked us) still stops it.
 */
export function askIsDue(record: AskRecord, standalone = false): boolean {
  if (record.done) return false;
  if (standalone && record.n > 0 && !record.askedStandalone) return true;
  if (record.n >= WAIT_DAYS.length) return false;
  return daysSince(record.at) >= WAIT_DAYS[record.n];
}
