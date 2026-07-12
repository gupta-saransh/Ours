import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { usePathname, useRouter } from 'expo-router';
import { BellButton, NudgeButton, SettingsButton } from './HeaderActions';
import { colors, font, sp, text } from '@/theme';

const LINKS = [
  { href: '/', label: 'Home' },
  { href: '/memories', label: 'Memories' },
  { href: '/notes', label: 'Notes' },
  { href: '/dates', label: 'Dates' },
  { href: '/wishlist', label: 'Wishlist' },
] as const;

/** Top navigation bar, shown on wide (web) layouts instead of bottom tabs. */
export function TopNav() {
  const pathname = usePathname();
  const router = useRouter();

  return (
    <View style={styles.bar}>
      <View style={styles.inner}>
        <Pressable onPress={() => router.push('/')}>
          <Text style={styles.wordmark}>Ours ♥</Text>
        </Pressable>
        <View style={styles.links}>
          {LINKS.map((link) => {
            const active = pathname === link.href;
            return (
              <Pressable key={link.href} onPress={() => router.push(link.href)} style={styles.link}>
                <Text style={[styles.linkText, active && styles.linkActive]}>{link.label}</Text>
                <View style={[styles.underline, active && { backgroundColor: colors.accent }]} />
              </Pressable>
            );
          })}
        </View>
        <View style={styles.actions}>
          <BellButton />
          <SettingsButton />
          <NudgeButton />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
  },
  inner: {
    width: '100%',
    maxWidth: 1080,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: sp.xl,
    height: 64,
  },
  wordmark: {
    fontFamily: font.display,
    fontSize: 24,
    color: colors.ink,
  },
  links: { flexDirection: 'row', gap: sp.sm },
  link: { paddingHorizontal: sp.md, paddingVertical: sp.sm, alignItems: 'center' },
  linkText: { ...text.body, color: colors.inkMuted, fontWeight: '500' },
  linkActive: { color: colors.ink, fontWeight: '600' },
  underline: {
    height: 2,
    width: 20,
    marginTop: sp.xs,
    borderRadius: 1,
    backgroundColor: 'transparent',
  },
  actions: { flexDirection: 'row', alignItems: 'center', gap: sp.md },
});
