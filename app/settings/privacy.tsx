import React, { useEffect, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import { KeyRound, Lock } from 'lucide-react-native';
import { useAuth } from '@/lib/auth';
import { ApiError } from '@/lib/api';
import { codeStatus, setCode } from '@/lib/secretChat';
import { useToast } from '@/lib/toast';
import { successHaptic } from '@/lib/haptics';
import { Card, PrimaryButton, Screen, SubScreenHeader } from '@/components/kit';
import { Sheet } from '@/components/Sheet';
import { colors, radius, sp, text } from '@/theme';

/** What "encrypted at rest" means here, the seal code that proves it, and the secret-chat lock. */
export default function PrivacySettings() {
  const { status, encryption, encryptionCode } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const [hasCode, setHasCode] = useState<boolean | null>(null);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (status !== 'signedIn') return;
    codeStatus()
      .then((s) => setHasCode(s.hasCode))
      .catch(() => setHasCode(null));
  }, [status]);

  if (status === 'loading') return null;
  if (status !== 'signedIn') return <Redirect href="/welcome" />;

  return (
    <Screen>
      <SubScreenHeader title="Privacy" onBack={() => router.back()} />
      <ScrollView contentContainerStyle={styles.body}>
        <Card>
          <View style={styles.privacyHead}>
            <Lock size={16} color={colors.accent} strokeWidth={1.75} />
            <Text style={text.subtitle}>Encrypted at rest</Text>
          </View>
          <Text style={[text.body, { color: colors.inkMuted, marginTop: sp.sm }]}>
            {encryption
              ? 'Your memories, notes, prompts, and wishes are encrypted before they reach our database. If our systems were ever exposed, the contents would be unreadable without your seal code. What you keep here stays between the two of you.'
              : 'We’re turning on encryption at rest for your private moments. Once it’s live, your memories, notes, prompts, and wishes are encrypted before they reach our database, so their contents would be unreadable if our systems were ever exposed.'}
          </Text>
          {encryption && encryptionCode && (
            <View style={styles.sealRow}>
              <View style={{ flex: 1, paddingRight: sp.base }}>
                <Text style={text.body}>Your seal code</Text>
                <Text style={text.caption}>
                  Made from your space's encryption key. Open Settings on your partner's phone and this code reads
                  the same there.
                </Text>
              </View>
              <Text style={styles.code}>{encryptionCode}</Text>
            </View>
          )}
        </Card>

        <Card style={{ marginTop: sp.base }}>
          <View style={styles.privacyHead}>
            <KeyRound size={16} color={colors.accent} strokeWidth={1.75} />
            <Text style={text.subtitle}>Secret chat code</Text>
          </View>
          <Text style={[text.body, { color: colors.inkMuted, marginTop: sp.sm }]}>
            {hasCode
              ? 'Your secret chat opens with a 4-digit code. If you have forgotten it, set a new one here with your account password. Nobody can look the old one up, not even us, so a new code is the only way back in.'
              : 'The secret chat is locked with a 4-digit code you choose. Messages in there disappear on a timer and cannot be recovered afterwards, by you or by us.'}
          </Text>
          <Pressable style={styles.actionLink} onPress={() => setEditing(true)}>
            <Text style={styles.actionLinkText}>{hasCode ? 'Set a new code' : 'Choose a code'}</Text>
          </Pressable>
        </Card>
      </ScrollView>

      <SecretCodeSheet
        visible={editing}
        replacing={!!hasCode}
        onClose={() => setEditing(false)}
        onSaved={() => {
          setEditing(false);
          setHasCode(true);
          toast.show('Your secret chat code is set.');
        }}
      />
    </Screen>
  );
}

/**
 * Set or reset the secret-chat code. Always asks for the account password, even
 * the first time: without it, anyone holding an unlocked phone could put their
 * own lock on their partner's secret thread, or quietly change it.
 *
 * There is no "show me my code" here on purpose. Revealing one means storing it
 * reversibly, which is weaker than the scrypt hash we keep AND more to build
 * than this single form. A forgotten code gets replaced, never recovered.
 */
function SecretCodeSheet({
  visible,
  replacing,
  onClose,
  onSaved,
}: {
  visible: boolean;
  replacing: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [code, setCodeText] = useState('');
  const [confirm, setConfirm] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setCodeText('');
    setConfirm('');
    setPassword('');
    setError(null);
  }, [visible]);

  const submit = async () => {
    setError(null);
    if (!/^\d{4}$/.test(code)) {
      setError('Your code needs to be 4 digits.');
      return;
    }
    if (code !== confirm) {
      setError('Those two codes are not the same.');
      return;
    }
    setBusy(true);
    try {
      await setCode(password, code);
      successHaptic();
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet visible={visible} onClose={onClose} title={replacing ? 'Set a new code' : 'Choose a code'}>
      <Text style={[text.body, { color: colors.inkMuted, marginBottom: sp.lg }]}>
        {replacing
          ? 'This replaces your old code. Anything already in the secret chat stays there, on whatever timer it was sent with.'
          : 'Pick 4 digits. Your person sets their own, so you never need to share it.'}
      </Text>
      <TextInput
        value={code}
        onChangeText={(t) => setCodeText(t.replace(/\D/g, '').slice(0, 4))}
        placeholder="••••"
        placeholderTextColor={colors.inkFaint}
        keyboardType="number-pad"
        secureTextEntry
        style={styles.codeInput}
      />
      <TextInput
        value={confirm}
        onChangeText={(t) => setConfirm(t.replace(/\D/g, '').slice(0, 4))}
        placeholder="Type it again"
        placeholderTextColor={colors.inkFaint}
        keyboardType="number-pad"
        secureTextEntry
        style={styles.codeInput}
      />
      <TextInput
        value={password}
        onChangeText={setPassword}
        placeholder="Your account password"
        placeholderTextColor={colors.inkFaint}
        secureTextEntry
        autoComplete="current-password"
        style={styles.codePassword}
      />
      {error && <Text style={styles.error}>{error}</Text>}
      <PrimaryButton
        title={busy ? 'One moment…' : 'Save'}
        onPress={submit}
        disabled={busy}
        style={{ marginTop: sp.lg }}
      />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: {
    padding: sp.lg,
    paddingBottom: sp.huge,
    width: '100%',
    maxWidth: 620,
    alignSelf: 'center',
  },
  privacyHead: { flexDirection: 'row', alignItems: 'center', gap: sp.sm },
  sealRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: sp.base,
    paddingTop: sp.md,
    borderTopWidth: 1,
    borderTopColor: colors.hairline,
  },
  code: {
    ...text.body,
    color: colors.surfaceSealed,
    fontWeight: '600',
    letterSpacing: 3,
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
  },
  actionLink: {
    marginTop: sp.base,
    paddingTop: sp.md,
    borderTopWidth: 1,
    borderTopColor: colors.hairline,
  },
  actionLinkText: { ...text.body, color: colors.surfaceSealed, fontWeight: '600' },
  codeInput: {
    ...text.title,
    color: colors.ink,
    textAlign: 'center',
    letterSpacing: 12,
    paddingVertical: sp.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
    marginBottom: sp.md,
    borderRadius: radius.sm,
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : null),
  },
  codePassword: {
    ...text.body,
    color: colors.ink,
    paddingVertical: sp.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : null),
  },
  error: { ...text.caption, color: colors.danger, marginTop: sp.md },
});
