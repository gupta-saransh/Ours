import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth } from '@/lib/auth';
import { FormError, PrimaryButton, Screen, SecondaryButton, TextField } from '@/components/kit';
import { colors, sp, text } from '@/theme';

export default function SignUp() {
  const { signUp } = useAuth();
  const router = useRouter();
  // A friend-referral link lands here as /sign-up?ref=CODE.
  const { ref } = useLocalSearchParams<{ ref?: string }>();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      await signUp(email.trim(), password, name.trim(), typeof ref === 'string' ? ref : null);
      // the (auth) layout redirects home once signed in
    } catch (err: any) {
      setError(err?.message ?? 'Something went wrong');
      setBusy(false);
    }
  };

  return (
    <Screen keyboard>
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Text style={[text.display, { marginBottom: sp.sm }]}>Start your side of the story</Text>
        <Text style={[text.bodySerif, { color: colors.inkMuted, marginBottom: sp.xxl }]}>
          Start alone or together. You can invite your person any time.
        </Text>
        {typeof ref === 'string' && ref.length > 0 && (
          <Text style={[text.caption, { color: colors.accent, marginTop: -sp.lg, marginBottom: sp.xl }]}>
            A friend sent you this way ♥
          </Text>
        )}

        <TextField label="Your name" value={name} onChangeText={setName} placeholder="Your cute name!" autoCapitalize="words" />
        <TextField
          label="Email"
          value={email}
          onChangeText={setEmail}
          placeholder="you@example.com"
          autoCapitalize="none"
          keyboardType="email-address"
          autoComplete="email"
        />
        <TextField
          label="Password"
          value={password}
          onChangeText={setPassword}
          placeholder="At least 8 characters"
          secureTextEntry
          autoComplete="new-password"
        />

        <FormError message={error} />
        <PrimaryButton title="Create account" onPress={submit} loading={busy} />
        <SecondaryButton title="I already have an account" onPress={() => router.replace('/sign-in')} style={{ marginTop: sp.md }} />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: {
    padding: sp.xl,
    paddingTop: sp.huge,
    width: '100%',
    maxWidth: 460,
    alignSelf: 'center',
  },
});
