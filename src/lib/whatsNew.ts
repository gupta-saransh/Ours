/**
 * "What's new": a lightweight changelog card shown once, the first time the
 * app opens after an update ships something user-facing. Web only, same "web
 * only, native skips" rule as the story-chapter ceremony key in
 * app/(tabs)/index.tsx, since native is not deployed and this only needs a
 * simple flag read on mount (no bundle-eval-time constraint like theme
 * presets, so no special handling beyond that).
 *
 * Deliberately shows only the LATEST entry, never a backlog: the point is a
 * quick "here is what changed", not homework.
 */

export interface WhatsNewEntry {
  /** Stable id; also the "have you seen this" marker written to storage. */
  id: string;
  title: string;
  bullets: string[];
}

// Newest first. Add an entry here whenever something user-facing ships.
export const WHATS_NEW: WhatsNewEntry[] = [
  {
    id: '2026-07-19-chat-and-game',
    title: 'A tidier chat, a quicker game',
    bullets: [
      'Chat now keeps one steady column: photos line up with your words, and long messages wrap without breaking words in half.',
      'The second This or That question opens three hours after you both play, instead of waiting half a day.',
      'Your daily question arrives at 9:30 in the morning, and the end-of-day nudge at 9:30 at night.',
    ],
  },
  {
    id: '2026-07-19-countdown',
    title: 'Countdown banners',
    bullets: [
      'Birthdays and anniversaries now count down on Home, starting however many days before you choose (set it per milestone).',
      'A shared to-do list lives in its own tab: add tasks for either of you, tick them off together.',
      'Notes and Memories now live together in one Timeline, sorted by the day each moment happened.',
    ],
  },
];

const STORAGE_KEY = 'ours.whats-new-seen';

export function latestEntry(): WhatsNewEntry | null {
  return WHATS_NEW[0] ?? null;
}

export function hasSeenLatest(): boolean {
  const entry = latestEntry();
  if (!entry) return true;
  try {
    if (typeof localStorage === 'undefined') return true; // native: never shown, never blocks
    return localStorage.getItem(STORAGE_KEY) === entry.id;
  } catch {
    return true;
  }
}

export function markLatestSeen(): void {
  const entry = latestEntry();
  if (!entry) return;
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, entry.id);
  } catch {}
}
