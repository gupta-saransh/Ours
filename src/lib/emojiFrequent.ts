/**
 * "Frequently used" for the chat emoji picker: web-only via localStorage, same
 * graceful-degradation pattern as ours.theme / ours.whats-new-seen (native has
 * no sync storage at module scope here, so it just starts empty each session).
 */

const KEY = 'ours.chat-emoji-frequent';
const MAX = 24;

/** Pure: move `emoji` to the front (inserting if new), capped at `max`, no duplicates. */
export function bumpEmoji(list: string[], emoji: string, max = MAX): string[] {
  return [emoji, ...list.filter((e) => e !== emoji)].slice(0, max);
}

function readList(): string[] {
  try {
    if (typeof localStorage === 'undefined') return [];
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function writeList(list: string[]): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // best effort; a full/blocked localStorage just means no memory of it
  }
}

export function getFrequentEmoji(): string[] {
  return readList();
}

export function recordEmojiUse(emoji: string): void {
  writeList(bumpEmoji(readList(), emoji));
}
