import React, { useEffect, useRef, useState } from 'react';
import { Animated, Platform, StyleSheet, Text } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useCoupleEvent } from '@/lib/realtime';
import { useAuth } from '@/lib/auth';
import { colors, font, radius, space, type } from '@/theme';

/** Warm top toast shown when your partner sends a nudge (or joins the space). */
export function NudgeToast() {
  const { user } = useAuth();
  const [message, setMessage] = useState<string | null>(null);
  const slide = useRef(new Animated.Value(-120)).current;
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = (text: string) => {
    setMessage(text);
    if (Platform.OS !== 'web') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    }
    Animated.spring(slide, { toValue: 0, useNativeDriver: true, damping: 16 }).start();
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      Animated.timing(slide, { toValue: -120, duration: 260, useNativeDriver: true }).start(() =>
        setMessage(null)
      );
    }, 4200);
  };

  useCoupleEvent('nudge', (data) => {
    if (data?.fromId && data.fromId === user?.id) return; // don't toast yourself
    show(`${data?.fromName ?? 'Your person'} is thinking of you ♥`);
  });

  useCoupleEvent('partner.joined', (data) => {
    if (data?.name) show(`${data.name} just joined your space ✦`);
  });

  useEffect(() => () => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
  }, []);

  if (!message) return null;
  return (
    <Animated.View style={[styles.toast, { transform: [{ translateY: slide }] }]} pointerEvents="none">
      <Text style={styles.text}>{message}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  toast: {
    position: 'absolute',
    top: space(14),
    alignSelf: 'center',
    maxWidth: 420,
    backgroundColor: colors.ink,
    borderRadius: radius.full,
    paddingVertical: space(3),
    paddingHorizontal: space(5),
    zIndex: 50,
  },
  text: {
    color: colors.onRose,
    fontFamily: font.displayMedium,
    fontSize: type.body,
    textAlign: 'center',
  },
});
