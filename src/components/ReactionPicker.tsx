import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Sheet } from './Sheet';
import { EMOJI_CATEGORIES, searchEmoji } from '@/lib/emojiCatalog';
import { getFrequentEmoji, recordEmojiUse } from '@/lib/emojiFrequent';
import { tapHaptic } from '@/lib/haptics';
import { colors, radius, sp, text } from '@/theme';

const FREQUENT_TAB = '__frequent__';

/**
 * The chat's full emoji keyboard for reactions: search, category tabs, and a
 * "frequently used" tab (localStorage, web only, same graceful-degradation
 * pattern as ours.theme) that opens first once something has been picked
 * before. Distinct from src/components/EmojiPicker.tsx, which is the small
 * inline palette the note composer uses to insert emoji into typed text; this
 * one is a Sheet, browses hundreds of emoji across categories, and hands back
 * a single pick for a message reaction.
 */
export function ReactionPicker({
  visible,
  onClose,
  onSelect,
  title = 'React',
}: {
  visible: boolean;
  onClose: () => void;
  onSelect: (emoji: string) => void;
  title?: string;
}) {
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<string>(EMOJI_CATEGORIES[0].name);
  const [frequent, setFrequent] = useState<string[]>([]);

  useEffect(() => {
    if (!visible) return;
    setQuery('');
    const f = getFrequentEmoji();
    setFrequent(f);
    setTab(f.length > 0 ? FREQUENT_TAB : EMOJI_CATEGORIES[0].name);
  }, [visible]);

  const searching = query.trim().length > 0;
  const grid = searching
    ? searchEmoji(query)
    : tab === FREQUENT_TAB
      ? frequent
      : (EMOJI_CATEGORIES.find((c) => c.name === tab) ?? EMOJI_CATEGORIES[0]).emoji;

  const pick = (emoji: string) => {
    tapHaptic();
    recordEmojiUse(emoji);
    onSelect(emoji);
  };

  return (
    <Sheet visible={visible} onClose={onClose} title={title}>
      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder="Search emoji"
        placeholderTextColor={colors.inkFaint}
        style={styles.search}
      />
      {!searching && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.tabs}
          contentContainerStyle={styles.tabsContent}
        >
          {frequent.length > 0 && (
            <Pressable
              onPress={() => setTab(FREQUENT_TAB)}
              style={[styles.tab, tab === FREQUENT_TAB && styles.tabActive]}
            >
              <Text style={styles.tabGlyph}>★</Text>
            </Pressable>
          )}
          {EMOJI_CATEGORIES.map((c) => (
            <Pressable key={c.name} onPress={() => setTab(c.name)} style={[styles.tab, tab === c.name && styles.tabActive]}>
              <Text style={styles.tabGlyph}>{c.icon}</Text>
            </Pressable>
          ))}
        </ScrollView>
      )}
      {grid.length === 0 ? (
        <Text style={styles.emptyLine}>No emoji found for "{query.trim()}".</Text>
      ) : (
        <View style={styles.grid}>
          {grid.map((e, i) => (
            <Pressable key={`${e}-${i}`} onPress={() => pick(e)} hitSlop={2} style={styles.cell}>
              <Text style={styles.emoji}>{e}</Text>
            </Pressable>
          ))}
        </View>
      )}
    </Sheet>
  );
}

const CELL = 44;

const styles = StyleSheet.create({
  search: {
    height: 40,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.hairline,
    paddingHorizontal: sp.md,
    marginBottom: sp.md,
    ...text.body,
  },
  tabs: {
    marginBottom: sp.sm,
  },
  tabsContent: {
    gap: sp.xs,
  },
  tab: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  tabActive: {
    borderColor: colors.hairline,
    backgroundColor: colors.surfaceRaised,
  },
  tabGlyph: {
    fontSize: 18,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  cell: {
    width: CELL,
    height: CELL,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emoji: {
    fontSize: 26,
  },
  emptyLine: {
    ...text.caption,
    textAlign: 'center',
    paddingVertical: sp.xl,
  },
});
