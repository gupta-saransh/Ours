import React from 'react';
import { ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '@/components/ui';
import { colors, font, radius, space, type } from '@/theme';

const FEATURES = [
  {
    glyph: '✧',
    title: 'A calendar of you two',
    line: 'Tap any day and keep a photo and a few lines. Days you have lived together fill up with hearts.',
  },
  {
    glyph: '♥',
    title: 'Notes that arrive instantly',
    line: 'Leave a note on your shared wall and it lands on their screen the moment you send it. Pin the ones worth keeping.',
  },
  {
    glyph: '◷',
    title: 'Days counted, dates kept',
    line: 'A running count of your days together, countdowns to anniversaries and birthdays, and a little list of things you still want to do.',
  },
];

/** The public landing page: what Ours is, then sign in or start. */
export default function Welcome() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const wide = width >= 760;

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.nav}>
          <Text style={styles.wordmark}>Ours ♥</Text>
          <Button title="Sign in" variant="secondary" onPress={() => router.push('/sign-in')} style={styles.navButton} />
        </View>

        <View style={styles.hero}>
          <Text style={styles.heroKicker}>For exactly two people</Text>
          <Text style={[styles.heroTitle, wide && { fontSize: 58, lineHeight: 64 }]}>
            The quiet little{'\n'}corner of the internet{'\n'}that is only yours
          </Text>
          <Text style={styles.heroLine}>
            Ours is a private space for you and your person. No feed, no followers, no audience.
            Just your memories, your notes, your days counted.
          </Text>
          <View style={[styles.heroActions, wide && { flexDirection: 'row', gap: space(3) }]}>
            <Button title="Start your space" onPress={() => router.push('/sign-up')} style={wide ? { minWidth: 220 } : undefined} />
            {!wide && (
              <Button title="I already have one" variant="ghost" onPress={() => router.push('/sign-in')} style={{ marginTop: space(2) }} />
            )}
          </View>
        </View>

        <View style={[styles.features, wide && styles.featuresWide]}>
          {FEATURES.map((f) => (
            <View key={f.title} style={[styles.feature, wide && { flex: 1 }]}>
              <Text style={styles.featureGlyph}>{f.glyph}</Text>
              <Text style={styles.featureTitle}>{f.title}</Text>
              <Text style={styles.featureLine}>{f.line}</Text>
            </View>
          ))}
        </View>

        <View style={styles.closing}>
          <Text style={styles.closingLine}>
            You do not need a partner to begin. Start alone, add your memories, and share your invite
            code whenever you are ready. Everything you keep comes with you.
          </Text>
          <Button title="Create your account" onPress={() => router.push('/sign-up')} style={{ alignSelf: 'center', minWidth: 260 }} />
        </View>

        <Text style={styles.footer}>Ours · made for exactly two people ♥</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.cream },
  body: {
    paddingHorizontal: space(7),
    paddingBottom: space(10),
    width: '100%',
    maxWidth: 1040,
    alignSelf: 'center',
  },
  nav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: space(4),
  },
  wordmark: { fontFamily: font.display, fontSize: 26, color: colors.ink },
  navButton: { minHeight: 42, paddingHorizontal: space(5) },
  hero: {
    alignItems: 'center',
    paddingVertical: space(14),
  },
  heroKicker: {
    fontSize: type.small,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    color: colors.gold,
    fontWeight: '700',
    marginBottom: space(4),
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
    fontSize: type.heading,
    lineHeight: 29,
    color: colors.inkSoft,
    textAlign: 'center',
    maxWidth: 560,
    marginTop: space(5),
    marginBottom: space(8),
    fontFamily: font.serif,
  },
  heroActions: { width: '100%', maxWidth: 420, alignSelf: 'center', alignItems: 'stretch', justifyContent: 'center' },
  features: { gap: space(4), paddingVertical: space(6) },
  featuresWide: { flexDirection: 'row', gap: space(5) },
  feature: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.hairline,
    borderRadius: radius.md,
    padding: space(6),
  },
  featureGlyph: { fontSize: 24, color: colors.rose, marginBottom: space(3) },
  featureTitle: {
    fontFamily: font.displayMedium,
    fontSize: type.title,
    color: colors.ink,
    marginBottom: space(2.5),
  },
  featureLine: { fontSize: type.body, lineHeight: 24, color: colors.inkSoft },
  closing: {
    alignItems: 'center',
    paddingVertical: space(12),
    gap: space(6),
  },
  closingLine: {
    fontFamily: font.serifItalic,
    fontSize: type.heading,
    lineHeight: 29,
    color: colors.inkSoft,
    textAlign: 'center',
    maxWidth: 540,
  },
  footer: {
    textAlign: 'center',
    color: colors.inkSoft,
    fontSize: type.small,
    paddingTop: space(6),
  },
});
