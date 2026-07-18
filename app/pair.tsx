import React, { useEffect, useState } from 'react';
import { Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { useAuth } from '@/lib/auth';
import { successHaptic } from '@/lib/haptics';
import { inviteLink, inviteMessage, shareOrCopy } from '@/lib/share';
import {
  AppPressable,
  Card,
  FormError,
  PrimaryButton,
  Screen,
  SecondaryButton,
  TextField,
} from '@/components/kit';
import { colors, radius, sp, text } from '@/theme';

/**
 * Linking is optional: the app works solo from day one. This page shares
 * your invite code or joins your partner's space (your entries move with you).
 */
export default function Pair() {
  const { status, user, couple, partner, joinSpace, refresh } = useAuth();
  const router = useRouter();
  // An invite link tapped by someone who already had an account arrives as
  // /pair?join=CODE, so the field is already filled in for them.
  const { join: joinParam } = useLocalSearchParams<{ join?: string }>();
  const [code, setCode] = useState(typeof joinParam === 'string' ? joinParam.toUpperCase() : '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [shared, setShared] = useState<string | null>(null);

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
      successHaptic();
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

  // Hand the invite to WhatsApp or iMessage as a link, so they tap once and
  // land in this space instead of typing a code.
  const share = async () => {
    if (!couple) return;
    const outcome = await shareOrCopy(inviteMessage(user?.display_name), inviteLink(couple.invite_code));
    if (outcome === 'copied') {
      setShared('Invite copied. Paste it to them ♥');
      setTimeout(() => setShared(null), 3000);
    }
  };

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.body}>
        {partner ? (
          <>
            <Text style={[text.display, { marginBottom: sp.md }]}>You two are linked ♥</Text>
            <Text style={[text.bodySerif, { color: colors.inkMuted, marginBottom: sp.xxl }]}>
              {user?.display_name} and {partner.display_name}, one private space.
            </Text>
            <PrimaryButton title="Back to your space" onPress={() => router.replace('/')} />
          </>
        ) : (
          <>
            <Text style={[text.display, { marginBottom: sp.md }]}>Bring your person in</Text>
            <Text style={[text.bodySerif, { color: colors.inkMuted, marginBottom: sp.xl }]}>
              Send them an invite and they land straight in here with you. When they join, everything you both
              add lives in one space.
            </Text>
            <PrimaryButton title="Send the invite" onPress={share} disabled={!couple} />
            {shared ? (
              <Text style={[text.caption, { color: colors.accent, textAlign: 'center', marginTop: sp.sm }]}>
                {shared}
              </Text>
            ) : null}
            <Text style={[text.micro, { textAlign: 'center', marginTop: sp.lg, marginBottom: sp.sm }]}>
              Or read them the code
            </Text>
            <AppPressable onPress={copy}>
              <Card style={styles.codeBox}>
                <Text style={styles.code}>{couple?.invite_code ?? '······'}</Text>
                <Text style={text.caption}>{copied ? 'Copied ✓' : 'Tap to copy'}</Text>
              </Card>
            </AppPressable>

            <View style={styles.dividerRow}>
              <View style={styles.divider} />
              <Text style={text.caption}>or join theirs</Text>
              <View style={styles.divider} />
            </View>

            <TextField
              label="Their invite code"
              value={code}
              onChangeText={(t) => setCode(t.toUpperCase())}
              placeholder="e.g. KMWQ38"
              autoCapitalize="characters"
              maxLength={8}
              style={styles.codeInput}
            />
            <Text style={[text.caption, { marginBottom: sp.base }]}>
              Joining moves your memories, notes and milestones into their space. Nothing is lost.
            </Text>
            <FormError message={error} />
            <PrimaryButton title="Join their space" onPress={join} loading={busy} disabled={code.trim().length < 6} />
            <SecondaryButton title="Maybe later" onPress={() => router.replace('/')} style={{ marginTop: sp.md }} />
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: sp.xl,
    width: '100%',
    maxWidth: 460,
    alignSelf: 'center',
  },
  codeBox: {
    alignItems: 'center',
    paddingVertical: sp.xl,
  },
  code: {
    ...text.title,
    fontSize: 36,
    lineHeight: 44,
    letterSpacing: 10,
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
  },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: sp.md,
    marginVertical: sp.xl,
  },
  divider: { flex: 1, height: 1, backgroundColor: colors.hairline },
  codeInput: {
    letterSpacing: 6,
    fontSize: 18,
    textAlign: 'center',
    borderRadius: radius.sm,
  },
});
