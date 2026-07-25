import React, { useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Bell, Settings } from 'lucide-react-native';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useNotifications } from '@/lib/notifications';
import { useToast } from '@/lib/toast';
import { successHaptic } from '@/lib/haptics';
import { AppPressable, IconButton } from '@/components/kit';
import { colors, radius, sp, text } from '@/theme';

// Same defensive pattern chat.tsx uses on its bubbles: a sustained press on
// web can trigger the browser's own text-selection/callout UI on top of the
// app's own onLongPress, which is exactly the "screen turns blue" bug that
// pushed chat's message bubbles off onLongPress entirely. Applied here since
// NudgeButton gains a real onLongPress below (chat's bubbles did not keep one).
const noSelect =
  Platform.OS === 'web'
    ? ({ userSelect: 'none', WebkitUserSelect: 'none', WebkitTouchCallout: 'none' } as any)
    : null;

/** ♥ button: tap sends a live "thinking of you"; hold opens Thumb Kiss. */
export function NudgeButton() {
  const [sending, setSending] = useState(false);
  const toast = useToast();
  const router = useRouter();
  const { partner } = useAuth();

  const send = async () => {
    if (sending) return; // debounce repeat taps
    setSending(true); // spinner shows on the next frame, before the network call
    try {
      await api('/api/nudge', { method: 'POST' });
      successHaptic();
      toast.show('Nudge sent.');
    } catch {
      toast.show('Could not send. Try again.');
    } finally {
      setSending(false);
    }
  };

  // Solo (no partner yet): nothing to hold hands with, so hold does nothing.
  const hold = () => {
    if (!partner) return;
    router.navigate('/thumb-kiss');
  };

  return (
    <AppPressable onPress={send} onLongPress={hold} style={[styles.nudge, noSelect]}>
      {sending ? (
        <ActivityIndicator size={14} color={colors.surfaceSealed} />
      ) : (
        <Text style={[styles.nudgeText, noSelect]}>Nudge ♥</Text>
      )}
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
    // Fixed footprint so swapping the label for the spinner does not resize it.
    minWidth: 84,
    minHeight: 32,
    alignItems: 'center',
    justifyContent: 'center',
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
