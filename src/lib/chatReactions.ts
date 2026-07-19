/**
 * Pure reaction logic for the chat thread, kept free of React/react-native so
 * it runs under plain node in tests (see the vitest scope note in CLAUDE.md).
 * One reaction per person per message, WhatsApp/Telegram-style: tapping a new
 * emoji replaces your old one, tapping your own again clears it.
 */

export interface ReactionRow {
  user_id: string;
  emoji: string;
}

/** The long-press quick-reaction bar: WhatsApp/iMessage's own default six. */
export const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

export interface GroupedReaction {
  emoji: string;
  count: number;
  mine: boolean;
}

/** Distinct emoji in first-seen order, each with a count and whether I'm in it. */
export function groupReactions(reactions: ReactionRow[], myId: string | undefined): GroupedReaction[] {
  const order: string[] = [];
  const byEmoji = new Map<string, { count: number; mine: boolean }>();
  for (const r of reactions) {
    if (!byEmoji.has(r.emoji)) {
      order.push(r.emoji);
      byEmoji.set(r.emoji, { count: 0, mine: false });
    }
    const entry = byEmoji.get(r.emoji)!;
    entry.count += 1;
    if (r.user_id === myId) entry.mine = true;
  }
  return order.map((emoji) => ({ emoji, ...byEmoji.get(emoji)! }));
}

/** Tapping `tapped` while my current reaction is `mine`: set a new one, or clear a repeat. */
export function nextReactionAction(
  mine: string | null,
  tapped: string
): { action: 'react'; emoji: string } | { action: 'unreact' } {
  if (mine === tapped) return { action: 'unreact' };
  return { action: 'react', emoji: tapped };
}

/** Optimistic/settled local update: replace my entry, or drop it when emoji is null. */
export function applyReaction<T extends { reactions?: ReactionRow[] }>(
  message: T,
  userId: string,
  emoji: string | null
): T {
  const rest = (message.reactions ?? []).filter((r) => r.user_id !== userId);
  return { ...message, reactions: emoji ? [...rest, { user_id: userId, emoji }] : rest };
}
