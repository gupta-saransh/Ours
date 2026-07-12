import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import { useAuth } from '@/lib/auth';
import { Button, Field, FormError } from '@/components/ui';
import { colors, font, radius, space, type } from '@/theme';

/**
 * Linking is optional: the app works solo from day one. This page shares
 * your invite code or joins your partner's space (your entries move with you).
 */
export default function Pair() {
  const { status, user, couple, partner, joinSpace, refresh } = useAuth();
  const router = useRouter();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  // Poll while unlinked so the moment they join, this page celebrates it.
  useEffect(() => {
    if (partner) return;
    const timer = setInterval(() => refresh().catch(() => {}), 3000);
    return () => clearInterval(timer);
  }, [partner, refresh]);

  if (status === 'loading') return null;
  if (status === 'signedOut') return <Redirect href="/welcome" />;

  const join = async () => {
    setError(null);
    setBusy(true);
    try {
      await joinSpace(code);
      router.replace('/');
    } catch (err: any) {
      setError(err?.message ?? 'Something went wrong');
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!couple) return;
    await Clipboard.setStringAsync(couple.invite_code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.body}>
        {partner ? (
          <>
            <Text style={styles.title}>You two are linked ♥</Text>
            <Text style={styles.sub}>
              {user?.display_name} and {partner.display_name}, one private space.
            </Text>
            <Button title="Back to your space" onPress={() => router.replace('/')} />
          </>
        ) : (
          <>
            <Text style={styles.title}>Bring your person in</Text>
            <Text style={styles.sub}>
              Share this code with them. When they join, everything you both add lives in one space.
            </Text>
            <Pressable onPress={copy} style={styles.codeBox}>
              <Text style={styles.code}>{couple?.invite_code ?? '······'}</Text>
              <Text style={styles.codeHint}>{copied ? 'Copied ✓' : 'Tap to copy'}</Text>
            </Pressable>

            <View style={styles.dividerRow}>
              <View style={styles.divider} />
              <Text style={styles.dividerText}>or join theirs</Text>
              <View style={styles.divider} />
            </View>

            <Field
              label="Their invite code"
              value={code}
              onChangeText={(t) => setCode(t.toUpperCase())}
              placeholder="e.g. KMWQ38"
              autoCapitalize="characters"
              maxLength={8}
              style={styles.codeInput}
            />
            <Text style={styles.joinHint}>
              Joining moves your memories, notes and milestones into their space. Nothing is lost.
            </Text>
            <FormError message={error} />
            <Button title="Join their space" onPress={join} loading={busy} disabled={code.trim().length < 6} />
            <Button title="Maybe later" variant="ghost" onPress={() => router.replace('/')} style={{ marginTop: space(2) }} />
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.cream },
  body: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: space(7),
    width: '100%',
    maxWidth: 460,
    alignSelf: 'center',
  },
  title: {
    fontFamily: font.display,
    fontSize: type.hero,
    lineHeight: 42,
    color: colors.ink,
    marginBottom: space(3),
  },
  sub: {
    fontSize: type.body,
    lineHeight: 24,
    color: colors.inkSoft,
    marginBottom: space(7),
  },
  codeBox: {
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    alignItems: 'center',
    paddingVertical: space(7),
  },
  code: {
    fontFamily: font.display,
    fontSize: 40,
    letterSpacing: 10,
    color: colors.ink,
  },
  codeHint: { marginTop: space(2), fontSize: type.small, color: colors.inkSoft },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(3),
    marginVertical: space(7),
  },
  divider: { flex: 1, height: 1, backgroundColor: colors.hairline },
  dividerText: { fontSize: type.small, color: colors.inkSoft },
  codeInput: { letterSpacing: 6, fontSize: type.heading, textAlign: 'center' },
  joinHint: { fontSize: type.small, color: colors.inkSoft, lineHeight: 19, marginBottom: space(4) },
});
