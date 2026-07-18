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
import { usePathname, useRouter } from 'expo-router';
import {
  CalendarHeart,
  CheckSquare,
  Gift,
  Image as ImageIcon,
  Plus,
  Star,
  StickyNote,
  type LucideIcon,
} from 'lucide-react-native';
import { tapHaptic } from '@/lib/haptics';
import { useSafeBottom } from '@/lib/safeArea';
import { setFabMenuOpen } from '@/lib/fabMenu';
import { colors, motion, radius, sp, text } from '@/theme';

/**
 * Universal add button. A wax-seal FAB anchored bottom-right; tapping it raises
 * a vertical column of labelled actions (labels to the left of each disc, so
 * nothing can overlap). Each action deep-links to the right composer via a
 * `compose` param the target screen reads. Quiet motion: fade + rise, staggered,
 * no bounce.
 */

interface Action {
  key: string;
  label: string;
  Icon: LucideIcon;
  path: string;
  params?: Record<string, string>;
}

// Bottom-up: index 0 sits closest to the FAB. Note and Memory both open the
// merged Timeline; `kind` tells it which composer to focus (see timeline.tsx).
const ACTIONS: Action[] = [
  { key: 'milestone', label: 'Add a milestone', Icon: Star, path: '/milestones' },
  { key: 'date', label: 'Propose a date', Icon: CalendarHeart, path: '/dates' },
  { key: 'wish', label: 'Make a wish', Icon: Gift, path: '/wishlist' },
  { key: 'todo', label: 'Add a to-do', Icon: CheckSquare, path: '/todos' },
  { key: 'note', label: 'Add note', Icon: StickyNote, path: '/timeline' },
  { key: 'memory', label: 'Add memory', Icon: ImageIcon, path: '/timeline', params: { kind: 'memory' } },
];

// Routes that show the FAB. Hidden elsewhere (Settings, Notifications, etc.).
const VISIBLE_ON = new Set(['/', '/timeline', '/todos', '/dates', '/wishlist', '/milestones']);

const FAB_SIZE = 56;
const FAB_RIGHT = sp.xl; // gap from the screen's right edge
const ICON = 46; // diameter of each action's icon disc
const STEP = ICON + sp.md; // vertical distance between action rows

export function AddMenu() {
  const pathname = usePathname();
  const router = useRouter();
  const safeBottom = useSafeBottom();
  const { width } = useWindowDimensions();
  const wide = Platform.OS === 'web' && width >= 900;

  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false); // keeps the column alive through the close animation
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    setFabMenuOpen(open); // let the chat button (above the FAB) step aside
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

  const fabBottom = wide ? safeBottom + sp.xl : safeBottom + 54 + sp.base;

  const go = (action: Action) => {
    setOpen(false);
    // A fresh nonce each press so the target screen re-opens its composer even
    // when we're already on that tab.
    router.navigate({
      pathname: action.path as never,
      params: { compose: String(Date.now()), ...action.params },
    });
  };

  const rotate = anim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '45deg'] });
  const scrimOpacity = anim.interpolate({ inputRange: [0, 1], outputRange: [0, 1] });

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {mounted && (
        <>
          <Animated.View {...pan.panHandlers} style={[styles.scrim, { opacity: scrimOpacity }]} />
          {ACTIONS.map((action, i) => {
            const start = i * 0.07;
            const end = Math.min(start + 0.6, 1);
            const range = { inputRange: [start, end], extrapolate: 'clamp' as const };
            const translateY = anim.interpolate({ ...range, outputRange: [12, 0] });
            const opacity = anim.interpolate({ ...range, outputRange: [0, 1] });
            const { Icon } = action;
            return (
              // Positioned within the full-screen container (not a 0x0 anchor)
              // so the rows stay inside their parent's bounds and remain
              // tappable on Android. The discs line up over the FAB's centre.
              <Animated.View
                key={action.key}
                style={[
                  styles.action,
                  {
                    right: FAB_RIGHT + (FAB_SIZE - ICON) / 2,
                    bottom: fabBottom + FAB_SIZE + sp.md + i * STEP,
                    opacity,
                    transform: [{ translateY }],
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
  // Each row is right-anchored so the label grows leftward from its disc;
  // right/bottom are applied inline (they depend on the runtime safe inset).
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
