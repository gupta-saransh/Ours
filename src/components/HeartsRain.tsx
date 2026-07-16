import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useCoupleEvent } from '@/lib/realtime';
import { useAuth } from '@/lib/auth';
import { successHaptic } from '@/lib/haptics';
import { colors } from '@/theme';

// One instance lives in the tab layout; anything can set it off.
let trigger: (() => void) | null = null;

/** Shower the screen with hearts (used when a nudge is waiting as the app opens). */
export function showHearts() {
  trigger?.();
}

const HEART_COUNT = 18;
const PALETTE = [colors.surfaceSealed, colors.accent, colors.blush];

interface HeartSpec {
  left: number; // percent
  size: number;
  delay: number;
  duration: number;
  sway: number; // px drift while falling
  rotate: string;
  color: string;
}

function makeSpecs(): HeartSpec[] {
  return Array.from({ length: HEART_COUNT }, () => ({
    left: 4 + Math.random() * 88,
    size: 14 + Math.round(Math.random() * 14),
    delay: Math.round(Math.random() * 700),
    duration: 2000 + Math.round(Math.random() * 1100),
    sway: (Math.random() - 0.5) * 60,
    rotate: `${Math.round((Math.random() - 0.5) * 26)}deg`,
    color: PALETTE[Math.floor(Math.random() * PALETTE.length)],
  }));
}

/**
 * A brief rain of ♥ over the whole app when your partner's nudge lands: live
 * over Ably, or on open via showHearts() when /api/home says one was waiting.
 * Non-interactive overlay; hearts are content marks, so this stays within the
 * no-confetti spirit (short, quiet, then gone).
 */
export function HeartsRain() {
  const { user } = useAuth();
  const [burst, setBurst] = useState(0);

  useEffect(() => {
    trigger = () => setBurst((b) => b + 1);
    return () => {
      trigger = null;
    };
  }, []);

  useCoupleEvent('nudge', (data) => {
    if (data?.fromId && data.fromId === user?.id) return; // your own nudge
    setBurst((b) => b + 1);
  });

  if (burst === 0) return null;
  return <Burst key={burst} onDone={() => setBurst(0)} />;
}

function Burst({ onDone }: { onDone: () => void }) {
  const { height } = useWindowDimensions();
  const specs = useMemo(makeSpecs, []);
  const values = useRef(specs.map(() => new Animated.Value(0))).current;

  useEffect(() => {
    successHaptic();
    Animated.parallel(
      values.map((v, i) =>
        Animated.timing(v, {
          toValue: 1,
          delay: specs[i].delay,
          duration: specs[i].duration,
          useNativeDriver: true,
        })
      )
    ).start(() => onDone());
  }, []);

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {specs.map((s, i) => (
        <Animated.Text
          key={i}
          style={{
            position: 'absolute',
            left: `${s.left}%`,
            top: 0,
            fontSize: s.size,
            color: s.color,
            opacity: values[i].interpolate({
              inputRange: [0, 0.08, 0.75, 1],
              outputRange: [0, 0.9, 0.9, 0],
            }),
            transform: [
              {
                translateY: values[i].interpolate({
                  inputRange: [0, 1],
                  outputRange: [-40, height + 40],
                }),
              },
              {
                translateX: values[i].interpolate({
                  inputRange: [0, 1],
                  outputRange: [0, s.sway],
                }),
              },
              { rotate: s.rotate },
            ],
          }}
        >
          ♥
        </Animated.Text>
      ))}
    </View>
  );
}
