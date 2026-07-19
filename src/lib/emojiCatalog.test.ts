import { describe, expect, it } from 'vitest';
import { EMOJI_CATEGORIES, searchEmoji } from './emojiCatalog';

describe('EMOJI_CATEGORIES', () => {
  it('every category has a name, icon, and a non-empty emoji list', () => {
    for (const c of EMOJI_CATEGORIES) {
      expect(c.name.length).toBeGreaterThan(0);
      expect(c.icon.length).toBeGreaterThan(0);
      expect(c.emoji.length).toBeGreaterThan(0);
    }
  });

  it('has no duplicate emoji within a single category', () => {
    for (const c of EMOJI_CATEGORIES) {
      expect(new Set(c.emoji).size).toBe(c.emoji.length);
    }
  });
});

describe('searchEmoji', () => {
  it('finds a common emoji by its plain-English keyword', () => {
    expect(searchEmoji('heart')).toContain('❤️');
    expect(searchEmoji('pizza')).toContain('🍕');
    expect(searchEmoji('laugh')).toContain('😂');
  });

  it('is case-insensitive and trims whitespace', () => {
    expect(searchEmoji('  HEART  ')).toContain('❤️');
  });

  it('returns nothing for an empty query', () => {
    expect(searchEmoji('')).toEqual([]);
    expect(searchEmoji('   ')).toEqual([]);
  });

  it('returns no duplicate emoji even if multiple keywords match', () => {
    const results = searchEmoji('love');
    expect(new Set(results).size).toBe(results.length);
  });

  it('returns an empty list for a nonsense query', () => {
    expect(searchEmoji('zzzznotarealword')).toEqual([]);
  });
});
