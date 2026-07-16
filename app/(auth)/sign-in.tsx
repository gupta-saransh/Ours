import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '@/lib/auth';
import { FormError, PrimaryButton, Screen, SecondaryButton, TextField } from '@/components/kit';
import { colors, sp, text } from '@/theme';

export default function SignIn() {
  const { signIn } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      await signIn(email.trim(), password);
    } catch (err: any) {
      setError(err?.message ?? 'Something went wrong');
      setBusy(false);
    }
  };

  return (
    <Screen keyboard>
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Text style={[text.display, { marginBottom: sp.sm }]}>Welcome back</Text>
        <Text style={[text.bodySerif, { color: colors.inkMuted, marginBottom: sp.xxl }]}>
          Your space is right where you left it.
        </Text>

        <TextField
          label="Email"
          value={email}
          onChangeText={setEmail}
          placeholder="you@ours.com"
          autoCapitalize="none"
          keyboardType="email-address"
          autoComplete="email"
        />
        <TextField
          label="Password"
          value={password}
          onChangeText={setPassword}
          placeholder="Your password"
          secureTextEntry
          autoComplete="current-password"
        />

        <FormError message={error} />
        <PrimaryButton title="Sign in" onPress={submit} loading={busy} />
        <SecondaryButton title="I need an account" onPress={() => router.replace('/sign-up')} style={{ marginTop: sp.md }} />
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
