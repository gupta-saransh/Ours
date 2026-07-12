import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { colors, font, radius, space, type } from '@/theme';

export function Button({
  title,
  onPress,
  variant = 'primary',
  loading = false,
  disabled = false,
  style,
}: {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const inactive = disabled || loading;
  return (
    <Pressable
      onPress={onPress}
      disabled={inactive}
      style={({ pressed }) => [
        styles.button,
        variant === 'primary' && { backgroundColor: pressed ? colors.rosePressed : colors.rose },
        variant === 'secondary' && [styles.buttonSecondary, pressed && { backgroundColor: colors.blushSoft }],
        variant === 'ghost' && { backgroundColor: pressed ? colors.blushSoft : 'transparent' },
        variant === 'danger' && [styles.buttonSecondary, pressed && { backgroundColor: colors.blushSoft }],
        inactive && { opacity: 0.55 },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={variant === 'primary' ? colors.cream : colors.rose} />
      ) : (
        <Text
          style={[
            styles.buttonText,
            variant === 'primary' && { color: colors.onRose },
            (variant === 'secondary' || variant === 'ghost') && { color: colors.ink },
            variant === 'danger' && { color: colors.danger },
          ]}
        >
          {title}
        </Text>
      )}
    </Pressable>
  );
}

export function Field({
  label,
  error,
  ...inputProps
}: TextInputProps & { label: string; error?: string | null }) {
  return (
    <View style={{ marginBottom: space(4) }}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        placeholderTextColor={colors.inkSoft}
        {...inputProps}
        style={[styles.input, error ? { borderColor: colors.danger } : null, inputProps.style]}
      />
      {error ? <Text style={styles.fieldError}>{error}</Text> : null}
    </View>
  );
}

export function Card({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function EmptyState({ title, line }: { title: string; line: string }) {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyLine}>{line}</Text>
    </View>
  );
}

export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return <Text style={styles.formError}>{message}</Text>;
}

const styles = StyleSheet.create({
  button: {
    minHeight: 52,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space(6),
  },
  buttonSecondary: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  buttonText: {
    fontSize: type.body,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  fieldLabel: {
    fontSize: type.small,
    color: colors.inkSoft,
    marginBottom: space(1.5),
    letterSpacing: 0.3,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.hairline,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    paddingHorizontal: space(3.5),
    paddingVertical: space(3),
    fontSize: type.body,
    color: colors.ink,
  },
  fieldError: {
    color: colors.danger,
    fontSize: type.small,
    marginTop: space(1),
  },
  formError: {
    color: colors.danger,
    fontSize: type.small,
    marginBottom: space(3),
    textAlign: 'center',
  },
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.hairline,
    borderRadius: radius.md,
    padding: space(4),
  },
  empty: {
    alignItems: 'center',
    paddingVertical: space(16),
    paddingHorizontal: space(8),
  },
  emptyTitle: {
    fontFamily: font.displayMedium,
    fontSize: type.title,
    color: colors.ink,
    marginBottom: space(2),
    textAlign: 'center',
  },
  emptyLine: {
    fontSize: type.body,
    color: colors.inkSoft,
    textAlign: 'center',
    lineHeight: 24,
  },
});
