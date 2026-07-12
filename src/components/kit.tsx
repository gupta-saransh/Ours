// The Ours component kit. Every screen renders from these primitives; a raw
// View with ad hoc padding or a hardcoded hex outside theme.ts is a bug.

import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type PressableProps,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, motion, radius, sp, text } from '@/theme';

/* ---------------------------------- press --------------------------------- */

/** Pressable with the shared press scale (0.98, 120ms). Used by everything tappable. */
export function AppPressable({
  children,
  style,
  disabled,
  ...props
}: PressableProps & { children?: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const scale = useRef(new Animated.Value(1)).current;
  const to = (v: number) =>
    Animated.timing(scale, { toValue: v, duration: motion.press.duration, useNativeDriver: true }).start();
  return (
    <Pressable
      {...props}
      disabled={disabled}
      onPressIn={(e) => {
        to(motion.press.scale);
        props.onPressIn?.(e);
      }}
      onPressOut={(e) => {
        to(1);
        props.onPressOut?.(e);
      }}
    >
      <Animated.View style={[{ transform: [{ scale }] }, style]}>{children}</Animated.View>
    </Pressable>
  );
}

/** Fade + 4pt rise on mount. Cap staggers at 6 items. */
export function FadeIn({ children, delay = 0, style }: { children: React.ReactNode; delay?: number; style?: StyleProp<ViewStyle> }) {
  const opacity = useRef(new Animated.Value(0)).current;
  const rise = useRef(new Animated.Value(4)).current;
  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: motion.fade.duration, delay, useNativeDriver: true }),
      Animated.timing(rise, { toValue: 0, duration: motion.fade.duration, delay, useNativeDriver: true }),
    ]).start();
  }, [opacity, rise, delay]);
  return <Animated.View style={[{ opacity, transform: [{ translateY: rise }] }, style]}>{children}</Animated.View>;
}

/* --------------------------------- layout --------------------------------- */

/** Root wrapper: safe area, parchment ground, keyboard avoidance, 680 column on web. */
export function Screen({
  children,
  edges = ['top'],
  keyboard = false,
  style,
}: {
  children: React.ReactNode;
  edges?: ('top' | 'bottom')[];
  keyboard?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const inner = keyboard ? (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      {children}
    </KeyboardAvoidingView>
  ) : (
    children
  );
  return (
    <SafeAreaView edges={edges} style={[styles.screen, style]}>
      {inner}
    </SafeAreaView>
  );
}

/** Section header + content. space.md under the header, space.2xl below the block. */
export function Section({
  label,
  children,
  trailing,
  style,
}: {
  label?: string;
  children: React.ReactNode;
  trailing?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.section, style]}>
      {label ? (
        <View style={styles.sectionHeader}>
          <Text style={text.section}>{label}</Text>
          {trailing}
        </View>
      ) : null}
      {children}
    </View>
  );
}

export function Card({
  children,
  title,
  trailing,
  style,
  sealed = false,
}: {
  children: React.ReactNode;
  title?: string;
  trailing?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  sealed?: boolean;
}) {
  return (
    <View style={[styles.card, sealed && styles.cardSealed, style]}>
      {title ? (
        <View style={styles.cardHeader}>
          <Text style={[text.subtitle, sealed && { color: colors.onSealed }]}>{title}</Text>
          {trailing}
        </View>
      ) : null}
      {children}
    </View>
  );
}

export function PressableCard({
  children,
  onPress,
  style,
  sealed = false,
}: {
  children: React.ReactNode;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  sealed?: boolean;
}) {
  return (
    <AppPressable onPress={onPress} style={[styles.card, sealed && styles.cardSealed, style]}>
      {children}
    </AppPressable>
  );
}

/* --------------------------------- buttons -------------------------------- */

export function PrimaryButton({
  title,
  onPress,
  loading = false,
  disabled = false,
  inverted = false,
  style,
}: {
  title: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  /** parchment-on-oxblood, for use on sealed surfaces */
  inverted?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const inactive = disabled || loading;
  return (
    <AppPressable
      onPress={onPress}
      disabled={inactive}
      style={[
        styles.primaryButton,
        inverted && { backgroundColor: colors.surface },
        inactive && styles.buttonDisabled,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={inverted ? colors.surfaceSealed : colors.onSealed} />
      ) : (
        <Text style={[styles.primaryButtonText, inverted && { color: colors.surfaceSealed }]}>{title}</Text>
      )}
    </AppPressable>
  );
}

export function SecondaryButton({
  title,
  onPress,
  loading = false,
  disabled = false,
  destructive = false,
  style,
}: {
  title: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  destructive?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const inactive = disabled || loading;
  return (
    <AppPressable
      onPress={onPress}
      disabled={inactive}
      style={[styles.secondaryButton, inactive && { opacity: 0.45 }, style]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={colors.accent} />
      ) : (
        <Text style={[styles.secondaryButtonText, destructive && { color: colors.danger }]}>{title}</Text>
      )}
    </AppPressable>
  );
}

export function IconButton({
  children,
  onPress,
  style,
}: {
  children: React.ReactNode;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const [pressed, setPressed] = useState(false);
  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      hitSlop={6}
      style={[styles.iconButton, pressed && { backgroundColor: colors.surfaceRaised }, style]}
    >
      {children}
    </Pressable>
  );
}

/* ---------------------------------- forms --------------------------------- */

export function TextField({
  label,
  error,
  style,
  ...inputProps
}: TextInputProps & { label?: string; error?: string | null }) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={{ marginBottom: sp.base }}>
      {label ? <Text style={styles.fieldLabel}>{label}</Text> : null}
      <TextInput
        placeholderTextColor={colors.inkFaint}
        {...inputProps}
        onFocus={(e) => {
          setFocused(true);
          inputProps.onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          inputProps.onBlur?.(e);
        }}
        style={[
          styles.field,
          focused && { borderBottomColor: colors.accent },
          error ? { borderBottomColor: colors.danger } : null,
          style,
        ]}
      />
      {error ? <Text style={styles.fieldError}>{error}</Text> : null}
    </View>
  );
}

/* ---------------------------------- bits ----------------------------------- */

export function Pill({
  label,
  tone = 'accent',
  style,
}: {
  label: string;
  tone?: 'accent' | 'positive' | 'danger' | 'neutral';
  style?: StyleProp<ViewStyle>;
}) {
  const toneColor =
    tone === 'positive' ? colors.positive : tone === 'danger' ? colors.danger : tone === 'neutral' ? colors.ink : colors.accent;
  return (
    <View style={[styles.pill, { backgroundColor: `${toneColorHex(toneColor)}14` }, style]}>
      <Text style={[text.micro, { color: toneColor }]}>{label}</Text>
    </View>
  );
}

// rgba tones need a hex for the 8% fill; map the known role colors.
function toneColorHex(c: string): string {
  return c.startsWith('#') ? c : '#33241C';
}

export function ListRow({
  leading,
  title,
  caption,
  trailing,
  onPress,
  last = false,
}: {
  leading?: React.ReactNode;
  title: string;
  caption?: string;
  trailing?: React.ReactNode;
  onPress?: () => void;
  last?: boolean;
}) {
  const body = (
    <View style={[styles.listRow, !last && styles.listRowBorder]}>
      {leading ? <View style={styles.listLeading}>{leading}</View> : null}
      <View style={{ flex: 1 }}>
        <Text style={text.body} numberOfLines={1}>
          {title}
        </Text>
        {caption ? (
          <Text style={text.caption} numberOfLines={2}>
            {caption}
          </Text>
        ) : null}
      </View>
      {trailing}
    </View>
  );
  if (!onPress) return body;
  return <AppPressable onPress={onPress}>{body}</AppPressable>;
}

export function Empty({ line, actionTitle, onAction }: { line: string; actionTitle?: string; onAction?: () => void }) {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyGlyph}>✦</Text>
      <Text style={styles.emptyLine}>{line}</Text>
      {actionTitle && onAction ? <SecondaryButton title={actionTitle} onPress={onAction} style={{ marginTop: sp.lg }} /> : null}
    </View>
  );
}

/** Olive-tinted placeholder block matching final content shape. Fades in after 400ms. */
export function Skeleton({
  height,
  width = '100%',
  round = radius.sm,
  style,
}: {
  height: number;
  width?: number | `${number}%`;
  round?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const opacity = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(opacity, { toValue: 1, duration: motion.fade.duration, delay: 400, useNativeDriver: true }).start();
  }, [opacity]);
  return (
    <Animated.View
      style={[{ height, width, borderRadius: round, backgroundColor: 'rgba(119, 116, 63, 0.08)', opacity }, style]}
    />
  );
}

export function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyLine}>Something did not load. Try again?</Text>
      <SecondaryButton title="Retry" onPress={onRetry} style={{ marginTop: sp.lg }} />
    </View>
  );
}

export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return <Text style={styles.formError}>{message}</Text>;
}

/* ---------------------------------- styles --------------------------------- */

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  section: {
    marginBottom: sp.xxl,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: sp.md,
  },
  card: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.hairline,
    padding: sp.lg,
  },
  cardSealed: {
    backgroundColor: colors.surfaceSealed,
    borderColor: 'rgba(249, 239, 220, 0.18)',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: sp.md,
  },
  primaryButton: {
    height: 44,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceSealed,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: sp.xl,
  },
  primaryButtonText: {
    ...text.body,
    fontWeight: '600',
    color: colors.onSealed,
  },
  buttonDisabled: {
    backgroundColor: 'rgba(51, 36, 28, 0.20)',
  },
  secondaryButton: {
    height: 44,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.hairline,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: sp.xl,
    backgroundColor: 'transparent',
  },
  secondaryButtonText: {
    ...text.body,
    fontWeight: '600',
    color: colors.ink,
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fieldLabel: {
    ...text.caption,
    marginBottom: sp.sm,
  },
  field: {
    height: 44,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
    backgroundColor: 'transparent',
    ...({ fontSize: 15, color: colors.ink } as TextStyle),
    paddingHorizontal: 0,
  },
  fieldError: {
    ...text.caption,
    color: colors.danger,
    marginTop: sp.xs,
  },
  formError: {
    ...text.caption,
    color: colors.danger,
    textAlign: 'center',
    marginBottom: sp.md,
  },
  pill: {
    borderRadius: radius.pill,
    paddingHorizontal: sp.md,
    paddingVertical: sp.xs,
    alignSelf: 'flex-start',
  },
  listRow: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: sp.sm,
    gap: sp.md,
  },
  listRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
  },
  listLeading: {
    width: 28,
    alignItems: 'center',
  },
  empty: {
    alignItems: 'center',
    paddingVertical: sp.huge,
    paddingHorizontal: sp.xxl,
  },
  emptyGlyph: {
    fontSize: 28,
    color: colors.accent,
    opacity: 0.3,
    marginBottom: sp.md,
  },
  emptyLine: {
    ...text.bodySerif,
    fontStyle: 'italic',
    color: colors.inkMuted,
    textAlign: 'center',
  },
});
