import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors, space, type } from '@/theme';

const CATEGORIES: { label: string; emojis: string[] }[] = [
  {
    label: 'Love',
    emojis: ['❤️', '🩷', '🧡', '💛', '💚', '💙', '💜', '🤎', '🖤', '🤍', '💕', '💞', '💓', '💗', '💖', '💘', '💝', '💟', '❣️', '💌', '💋', '😍', '🥰', '😘', '😻', '🫶', '💑', '💏', '🌹', '💐'],
  },
  {
    label: 'Faces',
    emojis: ['😊', '😁', '😂', '🤣', '😅', '😉', '😌', '😎', '🤗', '🤭', '😏', '😜', '🤪', '😇', '🥹', '🥺', '😢', '😭', '😤', '😴', '🤤', '🫠', '🙃', '😬', '🤔', '🫣', '😳', '🥴', '🤧', '🤒'],
  },
  {
    label: 'Together',
    emojis: ['🍕', '🍝', '🍜', '🍣', '🍦', '🍰', '☕', '🍷', '🥂', '🍿', '🎬', '🎵', '🎶', '🎮', '🏖️', '🏔️', '🌅', '🌇', '🌃', '✈️', '🚗', '🏠', '🛋️', '🛏️', '🧸', '🎁', '🎊', '🎂', '🎈', '🎉'],
  },
  {
    label: 'Nature',
    emojis: ['✨', '⭐', '🌟', '💫', '🌙', '☀️', '🌈', '☁️', '🌧️', '❄️', '🔥', '🌊', '🌸', '🌺', '🌻', '🌼', '🌷', '🍀', '🍂', '🍁', '🌵', '🌴', '🦋', '🐝', '🐞', '🐢', '🐬', '🐶', '🐱', '🐧'],
  },
];

/**
 * WhatsApp-style emoji palette: a toggle button opens a categorized grid,
 * tapping an emoji inserts it. No native dependency, works on all platforms.
 */
export function EmojiPicker({ onPick }: { onPick: (emoji: string) => void }) {
  const [tab, setTab] = useState(0);
  return (
    <View style={styles.panel}>
      <View style={styles.tabs}>
        {CATEGORIES.map((c, i) => (
          <Pressable key={c.label} onPress={() => setTab(i)} style={[styles.tab, i === tab && styles.tabActive]}>
            <Text style={[styles.tabText, i === tab && styles.tabTextActive]}>{c.label}</Text>
          </Pressable>
        ))}
      </View>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.grid}>
        {CATEGORIES[tab].emojis.map((e) => (
          <Pressable
            key={e}
            onPress={() => onPick(e)}
            style={({ pressed }) => [styles.cell, pressed && { backgroundColor: colors.blushSoft }]}
          >
            <Text style={styles.emoji}>{e}</Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    borderTopWidth: 1,
    borderTopColor: colors.hairline,
    backgroundColor: colors.surface,
    height: 236,
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
  },
  tabs: {
    flexDirection: 'row',
    paddingHorizontal: space(3),
    paddingTop: space(2),
    gap: space(1),
  },
  tab: {
    paddingVertical: space(1.5),
    paddingHorizontal: space(3),
    borderRadius: 999,
  },
  tabActive: { backgroundColor: colors.blushSoft },
  tabText: { fontSize: type.small, color: colors.inkSoft, fontWeight: '600' },
  tabTextActive: { color: colors.rose },
  scroll: { flex: 1 },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    padding: space(2),
  },
  cell: {
    width: '10%',
    minWidth: 40,
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
  },
  emoji: { fontSize: 24 },
});
