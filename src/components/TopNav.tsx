import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { usePathname, useRouter } from 'expo-router';
import { BellButton, NudgeButton } from './HeaderActions';
import { colors, font, space, type } from '@/theme';

const LINKS = [
  { href: '/', label: 'Home' },
  { href: '/memories', label: 'Memories' },
  { href: '/notes', label: 'Notes' },
  { href: '/milestones', label: 'Milestones' },
  { href: '/settings', label: 'Settings' },
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
                <View style={[styles.underline, active && { backgroundColor: colors.rose }]} />
              </Pressable>
            );
          })}
        </View>
        <View style={styles.actions}>
          <BellButton />
          <NudgeButton />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    backgroundColor: colors.cream,
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
    paddingHorizontal: space(6),
    height: 64,
  },
  wordmark: {
    fontFamily: font.display,
    fontSize: 24,
    color: colors.ink,
  },
  links: { flexDirection: 'row', gap: space(2) },
  link: { paddingHorizontal: space(3), paddingVertical: space(2), alignItems: 'center' },
  linkText: { fontSize: type.body, color: colors.inkSoft, fontWeight: '500' },
  linkActive: { color: colors.ink, fontWeight: '600' },
  underline: { height: 2, alignSelf: 'stretch', marginTop: 4, borderRadius: 1, backgroundColor: 'transparent' },
  actions: { flexDirection: 'row', alignItems: 'center', gap: space(3) },
});
