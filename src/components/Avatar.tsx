import React from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import {
  Bird,
  BookOpen,
  Cat,
  Coffee,
  Dog,
  Flower2,
  Heart,
  Leaf,
  Moon,
  Music,
  Star,
  Sun,
  type LucideIcon,
} from 'lucide-react-native';
import { colors, font } from '@/theme';

/**
 * A person's "mark": a small line icon on a tinted disc, picked in Settings and
 * shown beside everything they write. Curated set, no free-form uploads; ids
 * must match AVATAR_IDS in api/_routes/auth-profile.ts. No mark chosen falls
 * back to a serif initial, so the UI never shows an empty disc.
 */
export const AVATARS: { id: string; Icon: LucideIcon; color: string }[] = [
  { id: 'heart', Icon: Heart, color: colors.surfaceSealed },
  { id: 'flower', Icon: Flower2, color: colors.accent },
  { id: 'sun', Icon: Sun, color: colors.accent },
  { id: 'moon', Icon: Moon, color: colors.ink },
  { id: 'star', Icon: Star, color: colors.accent },
  { id: 'music', Icon: Music, color: colors.surfaceSealed },
  { id: 'coffee', Icon: Coffee, color: colors.ink },
  { id: 'cat', Icon: Cat, color: colors.ink },
  { id: 'dog', Icon: Dog, color: colors.positive },
  { id: 'bird', Icon: Bird, color: colors.positive },
  { id: 'leaf', Icon: Leaf, color: colors.positive },
  { id: 'book', Icon: BookOpen, color: colors.surfaceSealed },
];

export function Avatar({
  id,
  name,
  size = 28,
  style,
}: {
  id?: string | null;
  name?: string;
  size?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const mark = AVATARS.find((a) => a.id === id);
  const shape = { width: size, height: size, borderRadius: size / 2 };

  if (!mark) {
    return (
      <View style={[styles.disc, shape, styles.fallback, style]}>
        <Text style={[styles.initial, { fontSize: Math.round(size * 0.45), lineHeight: Math.round(size * 0.62) }]}>
          {(name || '?').trim().slice(0, 1).toUpperCase()}
        </Text>
      </View>
    );
  }

  const { Icon, color } = mark;
  return (
    <View style={[styles.disc, shape, { backgroundColor: `${color}1A` }, style]}>
      <Icon size={Math.round(size * 0.55)} color={color} strokeWidth={1.75} />
    </View>
  );
}

const styles = StyleSheet.create({
  disc: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  fallback: {
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  initial: {
    fontFamily: font.serif,
    color: colors.surfaceSealed,
  },
});
