import React from 'react';
import { ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Lock } from 'lucide-react-native';
import { Card, PrimaryButton, Screen, SecondaryButton } from '@/components/kit';
import { colors, font, sp, text } from '@/theme';

const FEATURES = [
  {
    glyph: '✧',
    title: 'A calendar of you two',
    line: 'Tap any day and keep a photo and a few lines. Days you have lived together fill up with hearts.',
  },
  {
    glyph: '♥',
    title: 'Notes that arrive instantly',
    line: 'Leave a note on your shared wall and it lands on their screen the moment you send it. Seal one as a time capsule for a future day.',
  },
  {
    glyph: '◷',
    title: 'Days counted, dates kept',
    line: 'A running count of your days together, a daily question you both answer, countdowns, and a little list of things you still want to do.',
  },
];

/** The public landing page: what Ours is, then sign in or start. */
export default function Welcome() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const wide = width >= 760;

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.nav}>
          <Text style={styles.wordmark}>Ours ♥</Text>
          <SecondaryButton title="Sign in" onPress={() => router.push('/sign-in')} style={styles.navButton} />
        </View>

        <View style={styles.hero}>
          <Text style={styles.heroKicker}>For you and your favorite person</Text>
          <Text style={[styles.heroTitle, wide && { fontSize: 58, lineHeight: 64 }]}>
            The quiet little{'\n'}corner of the internet{'\n'}that is only yours
          </Text>
          <Text style={styles.heroLine}>
            Ours is a private space for you and your person. No feed, no followers, no audience.
            Just your memories, your notes, your days counted.
          </Text>
          <View style={[styles.heroActions, wide && { flexDirection: 'row', gap: sp.md }]}>
            <PrimaryButton title="Start your space" onPress={() => router.push('/sign-up')} style={wide ? { minWidth: 220 } : undefined} />
            {!wide && (
              <SecondaryButton title="I already have one" onPress={() => router.push('/sign-in')} style={{ marginTop: sp.md }} />
            )}
          </View>
          <View style={styles.lockLine}>
            <Lock size={13} color={colors.inkMuted} strokeWidth={1.75} />
            <Text style={text.caption}>Everything you write is encrypted at rest. Your story stays yours.</Text>
          </View>
        </View>

        <View style={[styles.features, wide && styles.featuresWide]}>
          {FEATURES.map((f) => (
            <Card key={f.title} style={wide ? { flex: 1 } : undefined}>
              <Text style={styles.featureGlyph}>{f.glyph}</Text>
              <Text style={[text.title, { marginBottom: sp.sm }]}>{f.title}</Text>
              <Text style={[text.body, { color: colors.inkMuted }]}>{f.line}</Text>
            </Card>
          ))}
        </View>

        <View style={styles.closing}>
          <Text style={styles.closingLine}>
            You do not need a partner to begin. Start alone, add your memories, and share your invite
            code whenever you are ready. Everything you keep comes with you.
          </Text>
          <PrimaryButton title="Create your account" onPress={() => router.push('/sign-up')} style={{ alignSelf: 'center', minWidth: 260 }} />
        </View>

        <Text style={styles.footer}>Ours · a little home for the two of you ♥</Text>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: {
    paddingHorizontal: sp.xl,
    paddingBottom: sp.xxxl,
    width: '100%',
    maxWidth: 1040,
    alignSelf: 'center',
  },
  nav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: sp.base,
  },
  wordmark: { fontFamily: font.display, fontSize: 26, color: colors.ink },
  navButton: { height: 40, paddingHorizontal: sp.lg },
  hero: {
    alignItems: 'center',
    paddingVertical: sp.huge,
  },
  heroKicker: {
    ...text.section,
    marginBottom: sp.base,
  },
  heroTitle: {
    fontFamily: font.display,
    fontSize: 40,
    lineHeight: 48,
    color: colors.ink,
    textAlign: 'center',
    letterSpacing: -0.5,
  },
  heroLine: {
    ...text.bodySerif,
    fontSize: 18,
    lineHeight: 28,
    color: colors.inkMuted,
    textAlign: 'center',
    maxWidth: 560,
    marginTop: sp.lg,
    marginBottom: sp.xxl,
  },
  heroActions: {
    width: '100%',
    maxWidth: 420,
    alignSelf: 'center',
    alignItems: 'stretch',
    justifyContent: 'center',
  },
  lockLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: sp.sm,
    marginTop: sp.lg,
  },
  features: { gap: sp.lg, paddingVertical: sp.xl },
  featuresWide: { flexDirection: 'row', gap: sp.lg },
  featureGlyph: { fontSize: 24, color: colors.surfaceSealed, marginBottom: sp.md },
  closing: {
    alignItems: 'center',
    paddingVertical: sp.xxxl,
    gap: sp.xl,
  },
  closingLine: {
    ...text.bodySerif,
    fontStyle: 'italic',
    fontSize: 18,
    lineHeight: 28,
    color: colors.inkMuted,
    textAlign: 'center',
    maxWidth: 540,
  },
  footer: {
    ...text.caption,
    textAlign: 'center',
    paddingTop: sp.lg,
  },
});
