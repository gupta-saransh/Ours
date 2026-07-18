import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useCoupleEvent } from '@/lib/realtime';
import { useAuth } from '@/lib/auth';
import { successHaptic } from '@/lib/haptics';
import { colors } from '@/theme';

type Variant = 'hearts' | 'confetti';

// One instance lives in the tab layout; anything can set it off.
let trigger: ((variant: Variant) => void) | null = null;

/** Shower the screen with hearts (used when a nudge is waiting as the app opens). */
export function showHearts() {
  trigger?.('hearts');
}

/**
 * A minimal confetti shower for the milestone countdown banner ("7 days to
 * X's birthday"). Deliberately NOT literal multicolor confetti: the design
 * system's "no confetti" rule stands, and there is exactly ONE sanctioned
 * shower engine (below) that every celebration reuses. This is that same
 * engine wearing small rectangles in the app's own palette instead of ♥
 * glyphs, not a second system.
 */
export function showConfetti() {
  trigger?.('confetti');
}

const PIECE_COUNT = 20;
const PALETTE = [colors.surfaceSealed, colors.accent, colors.blush];

interface PieceSpec {
  left: number; // percent
  size: number;
  delay: number;
  duration: number;
  sway: number; // px drift while falling
  rotate: string;
  color: string;
}

function makeSpecs(): PieceSpec[] {
  return Array.from({ length: PIECE_COUNT }, () => ({
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
 * A brief rain over the whole app: hearts on a nudge (live over Ably, or on
 * open via showHearts() when /api/home says one was waiting) or a streak win;
 * small theme-colored confetti pieces on a milestone countdown. Non-interactive
 * overlay, short, then gone, in the no-second-effect spirit of the design rule.
 */
export function HeartsRain() {
  const { user } = useAuth();
  const [burst, setBurst] = useState<{ n: number; variant: Variant } | null>(null);

  useEffect(() => {
    trigger = (variant) => setBurst((b) => ({ n: (b?.n ?? 0) + 1, variant }));
    return () => {
      trigger = null;
    };
  }, []);

  useCoupleEvent('nudge', (data) => {
    if (data?.fromId && data.fromId === user?.id) return; // your own nudge
    setBurst((b) => ({ n: (b?.n ?? 0) + 1, variant: 'hearts' }));
  });

  if (!burst) return null;
  return <Burst key={burst.n} variant={burst.variant} onDone={() => setBurst(null)} />;
}

function Burst({ variant, onDone }: { variant: Variant; onDone: () => void }) {
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
      {specs.map((s, i) => {
        const opacity = values[i].interpolate({
          inputRange: [0, 0.08, 0.75, 1],
          outputRange: [0, 0.9, 0.9, 0],
        });
        const transform = [
          { translateY: values[i].interpolate({ inputRange: [0, 1], outputRange: [-40, height + 40] }) },
          { translateX: values[i].interpolate({ inputRange: [0, 1], outputRange: [0, s.sway] }) },
          { rotate: s.rotate },
        ];
        if (variant === 'confetti') {
          return (
            <Animated.View
              key={i}
              style={{
                position: 'absolute',
                left: `${s.left}%`,
                top: 0,
                width: s.size * 0.55,
                height: s.size * 0.28,
                borderRadius: 1,
                backgroundColor: s.color,
                opacity,
                transform,
              }}
            />
          );
        }
        return (
          <Animated.Text
            key={i}
            style={{ position: 'absolute', left: `${s.left}%`, top: 0, fontSize: s.size, color: s.color, opacity, transform }}
          >
            ♥
          </Animated.Text>
        );
      })}
    </View>
  );
}
