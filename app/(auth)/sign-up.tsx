import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '@/lib/auth';
import { Button, Field, FormError } from '@/components/ui';
import { colors, font, space, type } from '@/theme';

export default function SignUp() {
  const { signUp } = useAuth();
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      await signUp(email.trim(), password, name.trim());
      // (auth) layout redirects to /pair once signed in
    } catch (err: any) {
      setError(err?.message ?? 'Something went wrong');
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.screen}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <Text style={styles.title}>Start your side{'\n'}of the story</Text>
          <Text style={styles.sub}>Start alone or together. You can invite your person any time.</Text>

          <Field label="Your name" value={name} onChangeText={setName} placeholder="Anisha" autoCapitalize="words" />
          <Field
            label="Email"
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.com"
            autoCapitalize="none"
            keyboardType="email-address"
            autoComplete="email"
          />
          <Field
            label="Password"
            value={password}
            onChangeText={setPassword}
            placeholder="At least 8 characters"
            secureTextEntry
            autoComplete="new-password"
          />

          <FormError message={error} />
          <Button title="Create account" onPress={submit} loading={busy} />
          <Button title="I already have an account" variant="ghost" onPress={() => router.replace('/sign-in')} style={{ marginTop: space(2) }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.cream },
  body: {
    padding: space(7),
    paddingTop: space(14),
    width: '100%',
    maxWidth: 460,
    alignSelf: 'center',
  },
  title: {
    fontFamily: font.display,
    fontSize: type.hero,
    lineHeight: 42,
    color: colors.ink,
    marginBottom: space(2),
  },
  sub: {
    fontSize: type.body,
    color: colors.inkSoft,
    marginBottom: space(8),
  },
});
