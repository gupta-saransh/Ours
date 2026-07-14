import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  PanResponder,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePathname, useRouter } from 'expo-router';
import {
  CalendarHeart,
  Gift,
  Image as ImageIcon,
  Milestone as MilestoneIcon,
  Plus,
  StickyNote,
  type LucideIcon,
} from 'lucide-react-native';
import { tapHaptic } from '@/lib/haptics';
import { colors, motion, radius, sp, text } from '@/theme';

/**
 * Universal add button. A wax-seal FAB anchored bottom-right; tapping it fans a
 * short arc of labelled actions (Apple Pencil tool-picker style). Each action
 * deep-links to the right composer via a `compose` param the target screen
 * reads. Quiet motion: fade + scale, staggered, no bounce.
 */

interface Action {
  key: string;
  label: string;
  Icon: LucideIcon;
  path: string;
}

// Order is top-of-arc first, so reading order (and web focus order) runs
// top → bottom-left.
const ACTIONS: Action[] = [
  { key: 'memory', label: 'Add memory', Icon: ImageIcon, path: '/memories' },
  { key: 'note', label: 'Add note', Icon: StickyNote, path: '/notes' },
  { key: 'wishlist', label: 'Add wishlist item', Icon: Gift, path: '/wishlist' },
  { key: 'date', label: 'Propose a date', Icon: CalendarHeart, path: '/dates' },
  { key: 'milestone', label: 'Add milestone', Icon: MilestoneIcon, path: '/milestones' },
];

// Routes that show the FAB. Hidden elsewhere (Settings, Milestones list, etc.).
const VISIBLE_ON = new Set(['/', '/memories', '/notes', '/dates', '/wishlist']);

const FAB_SIZE = 56;
const FAB_RIGHT = sp.xl; // gap from the screen's right edge
const ICON = 48; // diameter of each action's icon disc
const ARC_RADIUS = 132;

// Precomputed arc offsets (screen coords, y grows downward), fanning from
// straight-up to straight-left across a quarter circle.
const OFFSETS = ACTIONS.map((_, i) => {
  const theta = (90 + (i * 90) / (ACTIONS.length - 1)) * (Math.PI / 180);
  return { dx: ARC_RADIUS * Math.cos(theta), dy: -ARC_RADIUS * Math.sin(theta) };
});

export function AddMenu() {
  const pathname = usePathname();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const wide = Platform.OS === 'web' && width >= 900;

  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false); // keeps the arc alive through the close animation
  const anim = useRef(new Animated.Value(0)).current;

  const close = () => setOpen(false);

  useEffect(() => {
    if (open) {
      setMounted(true);
      Animated.timing(anim, {
        toValue: 1,
        duration: motion.fade.duration + 60,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    } else if (mounted) {
      Animated.timing(anim, {
        toValue: 0,
        duration: motion.fade.duration,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) setMounted(false);
      });
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Any navigation closes the menu.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Dismiss on tap outside or a downward swipe on the scrim.
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderRelease: () => setOpen(false),
    })
  ).current;

  if (!VISIBLE_ON.has(pathname)) return null;

  const fabBottom = wide ? insets.bottom + sp.xl : insets.bottom + 54 + sp.base;

  const go = (action: Action) => {
    setOpen(false);
    // A fresh nonce each press so the target screen re-opens its composer even
    // when we're already on that tab.
    router.navigate({ pathname: action.path as never, params: { compose: String(Date.now()) } });
  };

  const rotate = anim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '45deg'] });
  const scrimOpacity = anim.interpolate({ inputRange: [0, 1], outputRange: [0, 1] });

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {mounted && (
        <>
          <Animated.View
            {...pan.panHandlers}
            style={[styles.scrim, { opacity: scrimOpacity }]}
          />
          {ACTIONS.map((action, i) => {
            const { dx, dy } = OFFSETS[i];
            const start = i * 0.08;
            const end = Math.min(start + 0.6, 1);
            const range = { inputRange: [start, end], extrapolate: 'clamp' as const };
            const translateX = anim.interpolate({ ...range, outputRange: [0, dx] });
            const translateY = anim.interpolate({ ...range, outputRange: [0, dy] });
            const scale = anim.interpolate({ ...range, outputRange: [0.6, 1] });
            const opacity = anim.interpolate({ ...range, outputRange: [0, 1] });
            const { Icon } = action;
            return (
              // Positioned within the full-screen container (not a 0x0 anchor)
              // so the buttons stay inside their parent's bounds and remain
              // tappable on Android; the icon disc lines up on the FAB centre
              // when untranslated, then rides out to its arc point.
              <Animated.View
                key={action.key}
                style={[
                  styles.action,
                  {
                    right: FAB_RIGHT + FAB_SIZE / 2 - ICON / 2,
                    bottom: fabBottom + FAB_SIZE / 2 - ICON / 2,
                    opacity,
                    transform: [{ translateX }, { translateY }, { scale }],
                  },
                ]}
              >
                <Pressable
                  onPress={() => go(action)}
                  accessibilityRole="button"
                  accessibilityLabel={action.label}
                  style={styles.actionHit}
                >
                  <View style={styles.actionLabelWrap}>
                    <Text style={styles.actionLabel}>{action.label}</Text>
                  </View>
                  <View style={styles.actionIcon}>
                    <Icon size={22} color={colors.surfaceSealed} strokeWidth={1.75} />
                  </View>
                </Pressable>
              </Animated.View>
            );
          })}
        </>
      )}

      <Pressable
        onPress={() => {
          tapHaptic();
          setOpen((o) => !o);
        }}
        accessibilityRole="button"
        accessibilityLabel={open ? 'Close add menu' : 'Add'}
        accessibilityState={{ expanded: open }}
        style={[styles.fab, { right: FAB_RIGHT, bottom: fabBottom }]}
      >
        <Animated.View style={{ transform: [{ rotate }] }}>
          <Plus size={26} color={colors.onSealed} strokeWidth={2} />
        </Animated.View>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  scrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(51, 36, 28, 0.18)',
  },
  fab: {
    position: 'absolute',
    width: FAB_SIZE,
    height: FAB_SIZE,
    borderRadius: FAB_SIZE / 2,
    backgroundColor: colors.surfaceSealed,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Icon disc sits at the arc point; the label rides to its left. The row is
  // right-anchored so it grows leftward from the icon; right/bottom are applied
  // inline (they depend on the runtime safe-area inset).
  action: {
    position: 'absolute',
  },
  actionHit: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: sp.sm,
  },
  actionLabelWrap: {
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.hairline,
    borderRadius: radius.pill,
    paddingVertical: sp.xs,
    paddingHorizontal: sp.md,
  },
  actionLabel: {
    ...text.caption,
    color: colors.ink,
    fontWeight: '600',
  },
  actionIcon: {
    width: ICON,
    height: ICON,
    borderRadius: ICON / 2,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.hairline,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
