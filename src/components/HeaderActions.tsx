import React, { useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Bell, Settings } from 'lucide-react-native';
import { api } from '@/lib/api';
import { useNotifications } from '@/lib/notifications';
import { successHaptic } from '@/lib/haptics';
import { AppPressable, IconButton } from '@/components/kit';
import { colors, radius, sp, text } from '@/theme';

/** ♥ button, sends a live "thinking of you" to your partner. */
export function NudgeButton() {
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const send = async () => {
    if (state !== 'idle') return;
    setState('sending');
    try {
      await api('/api/nudge', { method: 'POST' });
      successHaptic();
      setState('sent');
      if (resetTimer.current) clearTimeout(resetTimer.current);
      resetTimer.current = setTimeout(() => setState('idle'), 2500);
    } catch {
      setState('idle');
    }
  };

  return (
    <AppPressable onPress={send} style={styles.nudge}>
      <Text style={styles.nudgeText}>{state === 'sent' ? 'Sent ♥' : 'Nudge ♥'}</Text>
    </AppPressable>
  );
}

/** Bell with an unread dot; opens the notifications screen. */
export function BellButton() {
  const { unseen } = useNotifications();
  const router = useRouter();
  return (
    <IconButton onPress={() => router.push('/notifications')}>
      <Bell size={20} color={colors.ink} strokeWidth={1.75} />
      {unseen > 0 && <View style={styles.dot} />}
    </IconButton>
  );
}

export function SettingsButton() {
  const router = useRouter();
  return (
    <IconButton onPress={() => router.push('/settings')}>
      <Settings size={20} color={colors.ink} strokeWidth={1.75} />
    </IconButton>
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
  row: { flexDirection: 'row', alignItems: 'center', gap: sp.sm, marginRight: sp.base },
  nudge: {
    borderWidth: 1,
    borderColor: colors.hairline,
    borderRadius: radius.pill,
    paddingVertical: sp.sm,
    paddingHorizontal: sp.md,
    backgroundColor: colors.surfaceRaised,
  },
  nudgeText: { ...text.caption, color: colors.surfaceSealed, fontWeight: '600' },
  dot: {
    position: 'absolute',
    top: 8,
    right: 9,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.surfaceSealed,
    borderWidth: 1.5,
    borderColor: colors.surface,
  },
});
