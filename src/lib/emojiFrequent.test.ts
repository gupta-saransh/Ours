import { describe, expect, it } from 'vitest';
import { bumpEmoji } from './emojiFrequent';

describe('bumpEmoji', () => {
  it('inserts a new emoji at the front of an empty list', () => {
    expect(bumpEmoji([], '❤️')).toEqual(['❤️']);
  });

  it('moves an existing emoji to the front instead of duplicating it', () => {
    expect(bumpEmoji(['😂', '❤️', '👍'], '👍')).toEqual(['👍', '😂', '❤️']);
  });

  it('caps the list length, dropping the oldest', () => {
    const list = ['e0', 'e1', 'e2', 'e3', 'e4'];
    expect(bumpEmoji(list, 'new', 3)).toEqual(['new', 'e0', 'e1']);
  });

  it('re-bumping the most recent emoji is a no-op on order', () => {
    expect(bumpEmoji(['❤️', '😂'], '❤️')).toEqual(['❤️', '😂']);
  });
});
