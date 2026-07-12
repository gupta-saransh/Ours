import React, { useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { api } from '@/lib/api';
import { useNotifications } from '@/lib/notifications';
import { colors, type } from '@/theme';

/** ♥ button, sends a live "thinking of you" to your partner. */
export function NudgeButton() {
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const send = async () => {
    if (state !== 'idle') return;
    setState('sending');
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    }
    try {
      await api('/api/nudge', { method: 'POST' });
      setState('sent');
      if (resetTimer.current) clearTimeout(resetTimer.current);
      resetTimer.current = setTimeout(() => setState('idle'), 2500);
    } catch {
      setState('idle');
    }
  };

  return (
    <Pressable
      onPress={send}
      style={({ pressed }) => [styles.nudge, pressed && { backgroundColor: colors.blushSoft }]}
    >
      <Text style={styles.nudgeText}>{state === 'sent' ? 'Sent ♥' : 'Nudge ♥'}</Text>
    </Pressable>
  );
}

/** Bell with an unread dot; opens the notifications screen. */
export function BellButton() {
  const { unseen } = useNotifications();
  const router = useRouter();
  return (
    <Pressable
      onPress={() => router.push('/notifications')}
      style={({ pressed }) => [styles.bell, pressed && { backgroundColor: colors.blushSoft }]}
      hitSlop={6}
    >
      <Text style={styles.bellGlyph}>◍</Text>
      {unseen > 0 && <View style={styles.dot} />}
    </Pressable>
  );
}

export function HeaderActions() {
  return (
    <View style={styles.row}>
      <BellButton />
      <NudgeButton />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, marginRight: 16 },
  nudge: {
    borderWidth: 1,
    borderColor: colors.blush,
    borderRadius: 999,
    paddingVertical: 7,
    paddingHorizontal: 14,
  },
  nudgeText: { color: colors.rose, fontSize: type.small, fontWeight: '600' },
  bell: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bellGlyph: { fontSize: 18, color: colors.ink },
  dot: {
    position: 'absolute',
    top: 6,
    right: 7,
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: colors.rose,
    borderWidth: 1.5,
    borderColor: colors.cream,
  },
});
