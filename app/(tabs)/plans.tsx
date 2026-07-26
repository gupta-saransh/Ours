import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { tapHaptic } from '@/lib/haptics';
import Todos from './todos';
import Dates from './dates';
import Wishes from './wishlist';
import { colors, radius, sp, text } from '@/theme';

/**
 * Plans: everything the two of you are looking FORWARD to, in one tab.
 *
 * To-dos, Dates and Wishes used to hold three of the five tab slots between
 * them, which is a lot of the bar for three lists that are all the same kind of
 * thing (what we owe today, what we have planned, what we want someday). They
 * are now three pills here, the same pattern the Timeline already uses for its
 * calendar/feed split.
 *
 * THE SCREENS THEMSELVES ARE UNCHANGED. Each is still its own route, still
 * rendered by its own file, and still reachable directly at /todos, /dates and
 * /wishlist so a stored notification's deep link keeps working. This tab just
 * mounts them under a pill row, passing `embedded` so they skip their own
 * safe-area wrapper (see the Screen component) instead of insetting twice.
 */

type Pill = 'todos' | 'dates' | 'wishes';

const PILLS: { key: Pill; label: string }[] = [
  { key: 'todos', label: 'To-dos' },
  { key: 'dates', label: 'Dates' },
  { key: 'wishes', label: 'Wishes' },
];

const isPill = (v: unknown): v is Pill => PILLS.some((p) => p.key === v);

export default function Plans() {
  // The add menu deep-links straight to a pill (`/plans?pill=dates&compose=…`),
  // so "Propose a date" still lands on the right list with its composer open.
  const { pill } = useLocalSearchParams<{ pill?: string }>();
  const [active, setActive] = useState<Pill>('todos');

  useEffect(() => {
    if (isPill(pill)) setActive(pill);
  }, [pill]);

  return (
    <SafeAreaView edges={['top']} style={styles.screen}>
      <View style={styles.pills}>
        {PILLS.map((p) => {
          const on = p.key === active;
          return (
            <Pressable
              key={p.key}
              onPress={() => {
                tapHaptic();
                setActive(p.key);
              }}
              style={[styles.pill, on && styles.pillOn]}
            >
              <Text style={[styles.pillText, on && styles.pillTextOn]}>{p.label}</Text>
            </Pressable>
          );
        })}
      </View>

      {/* Mounted, not navigated to: switching pills must not push a route, or
          the back button would walk backwards through your own pill taps. */}
      <View style={styles.body}>
        {active === 'todos' && <Todos embedded />}
        {active === 'dates' && <Dates embedded />}
        {active === 'wishes' && <Wishes embedded />}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  pills: {
    flexDirection: 'row',
    gap: sp.xs,
    paddingHorizontal: sp.base,
    paddingTop: sp.sm,
    paddingBottom: sp.xs,
    width: '100%',
    maxWidth: 680,
    alignSelf: 'center',
  },
  pill: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 7,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  pillOn: { backgroundColor: colors.surfaceSealed, borderColor: colors.surfaceSealed },
  pillText: { ...text.caption, color: colors.inkMuted },
  pillTextOn: { color: colors.onSealed, fontWeight: '600' },
  body: { flex: 1 },
});
