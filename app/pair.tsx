import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Redirect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import { useAuth } from '@/lib/auth';
import { Button, Field, FormError } from '@/components/ui';
import { colors, font, radius, space, type } from '@/theme';

/**
 * The pairing gate: signed in, but not yet linked to a partner.
 * Either start a space (and read the code to your person) or join theirs.
 */
export default function Pair() {
  const { status, user, couple, partner, createSpace, joinSpace, refresh, signOut } = useAuth();
  const [mode, setMode] = useState<'choose' | 'waiting' | 'join'>('choose');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const waiting = mode === 'waiting' && !!couple;

  // While showing the invite code, poll until the partner joins.
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => refresh().catch(() => {}), 3000);
    return () => clearInterval(timer);
  }, [waiting, refresh]);

  if (status === 'loading') return null;
  if (status === 'signedOut') return <Redirect href="/welcome" />;

  // Paired (either just now via polling, or already) → into the app.
  if (user?.couple_id && mode !== 'waiting') return <Redirect href="/" />;

  const begin = async () => {
    setError(null);
    setBusy(true);
    try {
      setMode('waiting');
      await createSpace();
    } catch (err: any) {
      setMode('choose');
      setError(err?.message ?? 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  const join = async () => {
    setError(null);
    setBusy(true);
    try {
      await joinSpace(code);
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
      <View style={styles.body}>
        {waiting ? (
          <>
            <Text style={styles.title}>Your space is ready</Text>
            <Text style={styles.sub}>
              Share this code with your person.{'\n'}The moment they join, you’re in together.
            </Text>
            <Pressable onPress={copy} style={styles.codeBox}>
              <Text style={styles.code}>{couple!.invite_code}</Text>
              <Text style={styles.codeHint}>{copied ? 'Copied ✓' : 'Tap to copy'}</Text>
            </Pressable>
            {partner ? (
              <>
                <Text style={styles.waiting}>{partner.display_name} is here ♥</Text>
                <Button title="Step inside together" onPress={() => setMode('choose')} style={{ marginTop: space(6) }} />
              </>
            ) : (
              <Text style={styles.waiting}>Waiting for your person…</Text>
            )}
          </>
        ) : mode === 'join' ? (
          <>
            <Text style={styles.title}>Join your person</Text>
            <Text style={styles.sub}>Enter the six-letter code they shared with you.</Text>
            <Field
              label="Invite code"
              value={code}
              onChangeText={(t) => setCode(t.toUpperCase())}
              placeholder="e.g. KMWQ38"
              autoCapitalize="characters"
              maxLength={8}
              style={styles.codeInput}
            />
            <FormError message={error} />
            <Button title="Join our space" onPress={join} loading={busy} disabled={code.trim().length < 6} />
            <Button title="Back" variant="ghost" onPress={() => { setMode('choose'); setError(null); }} style={{ marginTop: space(2) }} />
          </>
        ) : (
          <>
            <Text style={styles.hello}>Hi {user?.display_name} ♥</Text>
            <Text style={styles.title}>Two of you,{'\n'}one space</Text>
            <Text style={styles.sub}>
              Ours is private to you and your partner.{'\n'}Link up to open it.
            </Text>
            <FormError message={error} />
            <Button title="Begin our space" onPress={begin} loading={busy} />
            <View style={{ height: space(3) }} />
            <Button title="I have an invite code" variant="secondary" onPress={() => setMode('join')} />
            <Button title="Sign out" variant="ghost" onPress={signOut} style={{ marginTop: space(8) }} />
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.cream },
  body: {
    flex: 1,
    justifyContent: 'center',
    padding: space(7),
    width: '100%',
    maxWidth: 460,
    alignSelf: 'center',
  },
  hello: {
    fontSize: type.body,
    color: colors.rose,
    marginBottom: space(3),
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
    marginBottom: space(8),
  },
  codeBox: {
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    alignItems: 'center',
    paddingVertical: space(7),
    marginBottom: space(6),
  },
  code: {
    fontFamily: font.display,
    fontSize: 40,
    letterSpacing: 10,
    color: colors.ink,
  },
  codeHint: {
    marginTop: space(2),
    fontSize: type.small,
    color: colors.inkSoft,
  },
  codeInput: {
    letterSpacing: 6,
    fontSize: type.heading,
    textAlign: 'center',
  },
  waiting: {
    textAlign: 'center',
    color: colors.inkSoft,
    fontFamily: font.serifItalic,
    fontSize: type.body,
  },
});
