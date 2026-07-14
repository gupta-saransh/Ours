import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Lock } from 'lucide-react-native';
import { useAuth } from '@/lib/auth';
import { colors, sp, text } from '@/theme';

/**
 * A quiet "encrypted at rest" cue for composer surfaces (feature 4). Renders
 * only when the server confirms envelope encryption is active, so it never
 * overclaims when the master key is not yet provisioned.
 */
export function LockBadge({ label = 'Encrypted at rest', style }: { label?: string; style?: object }) {
  const { encryption } = useAuth();
  if (!encryption) return null;
  return (
    <View style={[styles.row, style]}>
      <Lock size={12} color={colors.inkFaint} strokeWidth={1.75} />
      <Text style={styles.text}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: sp.xs },
  text: { ...text.micro, color: colors.inkFaint, textTransform: 'none', letterSpacing: 0.2 },
});
