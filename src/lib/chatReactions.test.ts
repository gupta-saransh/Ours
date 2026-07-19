import { describe, expect, it } from 'vitest';
import { applyReaction, groupReactions, nextReactionAction, QUICK_REACTIONS } from './chatReactions';

describe('QUICK_REACTIONS', () => {
  it('is a non-empty list of distinct emoji', () => {
    expect(QUICK_REACTIONS.length).toBeGreaterThan(0);
    expect(new Set(QUICK_REACTIONS).size).toBe(QUICK_REACTIONS.length);
  });
});

describe('groupReactions', () => {
  it('groups by emoji, counting each and flagging mine', () => {
    const grouped = groupReactions(
      [
        { user_id: 'a', emoji: '❤️' },
        { user_id: 'b', emoji: '❤️' },
        { user_id: 'a', emoji: '😂' },
      ],
      'a'
    );
    expect(grouped).toEqual([
      { emoji: '❤️', count: 2, mine: true },
      { emoji: '😂', count: 1, mine: true },
    ]);
  });

  it('mine is false when my id reacted with nothing', () => {
    const grouped = groupReactions([{ user_id: 'b', emoji: '👍' }], 'a');
    expect(grouped).toEqual([{ emoji: '👍', count: 1, mine: false }]);
  });

  it('an empty list produces an empty group', () => {
    expect(groupReactions([], 'a')).toEqual([]);
  });

  it('preserves first-seen emoji order', () => {
    const grouped = groupReactions(
      [
        { user_id: 'a', emoji: '😮' },
        { user_id: 'b', emoji: '❤️' },
        { user_id: 'c', emoji: '😮' },
      ],
      undefined
    );
    expect(grouped.map((g) => g.emoji)).toEqual(['😮', '❤️']);
  });
});

describe('nextReactionAction', () => {
  it('reacts fresh when I had nothing', () => {
    expect(nextReactionAction(null, '❤️')).toEqual({ action: 'react', emoji: '❤️' });
  });

  it('replaces my reaction with a different emoji', () => {
    expect(nextReactionAction('❤️', '😂')).toEqual({ action: 'react', emoji: '😂' });
  });

  it('clears my reaction when I tap the same emoji again', () => {
    expect(nextReactionAction('❤️', '❤️')).toEqual({ action: 'unreact' });
  });
});

describe('applyReaction', () => {
  const base = { id: 'm1', reactions: [{ user_id: 'a', emoji: '❤️' }] };

  it('adds a reaction for someone with none yet', () => {
    const out = applyReaction({ id: 'm1', reactions: [] }, 'b', '😂');
    expect(out.reactions).toEqual([{ user_id: 'b', emoji: '😂' }]);
  });

  it('replaces an existing reaction from the same person', () => {
    const out = applyReaction(base, 'a', '😮');
    expect(out.reactions).toEqual([{ user_id: 'a', emoji: '😮' }]);
  });

  it('removes the reaction when emoji is null', () => {
    const out = applyReaction(base, 'a', null);
    expect(out.reactions).toEqual([]);
  });

  it('leaves other people\'s reactions untouched', () => {
    const twoPeople = { id: 'm1', reactions: [{ user_id: 'a', emoji: '❤️' }, { user_id: 'b', emoji: '👍' }] };
    const out = applyReaction(twoPeople, 'a', null);
    expect(out.reactions).toEqual([{ user_id: 'b', emoji: '👍' }]);
  });
});
