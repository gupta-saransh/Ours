import React, { useEffect, useState } from 'react';
import { Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Sparkles } from 'lucide-react-native';
import { useAuth } from '@/lib/auth';
import { hasSeenLatest, latestEntry, markLatestSeen, type WhatsNewEntry } from '@/lib/whatsNew';
import { PrimaryButton } from '@/components/kit';
import { colors, font, radius, sp, text } from '@/theme';

/** Let the tabs finish their first paint before anything pops up over them. */
const SHOW_DELAY_MS = 3500;

/**
 * A one-time "what's new" card, shown the first time the app opens after an
 * update ships. Mounted once in the tabs layout, gated on NOT being mid
 * onboarding (a brand new signup has nothing to compare "what's new" to yet),
 * and delayed past NotificationsInvite's own 2s delay so the two rarely
 * collide (both are one-time-ish and independent, so this is a soft mitigation
 * rather than a hard lock).
 */
export function WhatsNewModal() {
  const { status, needsOnboarding } = useAuth();
  const [entry, setEntry] = useState<WhatsNewEntry | null>(null);

  useEffect(() => {
    if (status !== 'signedIn' || needsOnboarding || Platform.OS !== 'web') return;
    const timer = setTimeout(() => {
      if (!hasSeenLatest()) setEntry(latestEntry());
    }, SHOW_DELAY_MS);
    return () => clearTimeout(timer);
  }, [status, needsOnboarding]);

  if (!entry) return null;

  const close = () => {
    markLatestSeen();
    setEntry(null);
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={close}>
      <Pressable style={styles.backdrop} onPress={close}>
        <Pressable style={styles.card} onPress={(e) => e.stopPropagation()}>
          <View style={styles.seal}>
            <Sparkles size={22} color={colors.onSealed} strokeWidth={1.75} />
          </View>
          <Text style={styles.flourish}>✦ what's new ✦</Text>
          <Text style={styles.title}>{entry.title}</Text>
          <View style={styles.bullets}>
            {entry.bullets.map((b, i) => (
              <View key={i} style={styles.bulletRow}>
                <Text style={styles.bulletMark}>♥</Text>
                <Text style={styles.bulletText}>{b}</Text>
              </View>
            ))}
          </View>
          <PrimaryButton title="Got it" onPress={close} />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(28, 18, 12, 0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: sp.xl,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.hairline,
    paddingHorizontal: sp.xl,
    paddingTop: sp.xxl,
    paddingBottom: sp.xl,
    alignItems: 'center',
  },
  seal: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.surfaceSealed,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: sp.md,
  },
  flourish: {
    color: colors.accent,
    fontSize: 12,
    marginBottom: sp.sm,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  title: {
    ...text.title,
    fontFamily: font.displayMedium,
    textAlign: 'center',
    marginBottom: sp.lg,
  },
  bullets: {
    width: '100%',
    marginBottom: sp.xl,
  },
  bulletRow: {
    flexDirection: 'row',
    gap: sp.sm,
    marginBottom: sp.md,
  },
  bulletMark: {
    color: colors.accent,
    fontSize: 13,
    marginTop: 2,
  },
  bulletText: {
    ...text.bodySerif,
    color: colors.inkMuted,
    flex: 1,
    lineHeight: 22,
  },
});
