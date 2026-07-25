import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';
import { useAuth } from '@/lib/auth';
import { FormError, PrimaryButton, Screen, SecondaryButton, TextField } from '@/components/kit';
import { colors, sp, text } from '@/theme';

type Step = 'email' | 'code' | 'password';

/**
 * Signed-out password reset: email -> 6-digit code -> new password. Lives in the
 * (auth) group so it shares the signed-out layout; a successful reset flips the
 * session to signed-in, and that layout redirects home on its own.
 *
 * The code is only truly verified by the final reset call (there is no separate
 * verify endpoint), so a wrong code surfaces on the last step with a way back to
 * re-enter it, rather than failing silently.
 */
export default function ForgotPassword() {
  const { requestPasswordReset, resetPassword } = useAuth();
  const router = useRouter();
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const sendCode = async () => {
    setError(null);
    if (!email.trim()) {
      setError('Enter the email you signed up with');
      return;
    }
    setBusy(true);
    try {
      await requestPasswordReset(email.trim());
      setStep('code');
    } catch (err: any) {
      setError(err?.message ?? 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  const continueWithCode = () => {
    setError(null);
    if (!/^\d{6}$/.test(code.trim())) {
      setError('Enter the 6-digit code from your email');
      return;
    }
    setStep('password');
  };

  const finish = async () => {
    setError(null);
    if (password.length < 8) {
      setError('Password needs at least 8 characters');
      return;
    }
    if (password !== confirm) {
      setError('Those passwords do not match');
      return;
    }
    setBusy(true);
    try {
      await resetPassword(email.trim(), code.trim(), password);
      // The (auth) layout sees the new signed-in status and redirects home.
    } catch (err: any) {
      setError(err?.message ?? 'Something went wrong');
      setBusy(false);
    }
  };

  const goBack = () => {
    setError(null);
    if (step === 'email') router.replace('/sign-in');
    else if (step === 'code') setStep('email');
    else setStep('code');
  };

  return (
    <Screen keyboard>
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Pressable onPress={goBack} hitSlop={8} style={styles.back}>
          <ChevronLeft size={18} color={colors.inkMuted} strokeWidth={1.75} />
          <Text style={[text.caption, { color: colors.inkMuted }]}>Back</Text>
        </Pressable>

        {step === 'email' && (
          <View>
            <Text style={[text.display, { marginBottom: sp.sm }]}>Reset your password</Text>
            <Text style={[text.bodySerif, { color: colors.inkMuted, marginBottom: sp.xxl }]}>
              Tell us your email and we will send you a code to set a new one.
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
            <FormError message={error} />
            <PrimaryButton title="Send me a code" onPress={sendCode} loading={busy} />
          </View>
        )}

        {step === 'code' && (
          <View>
            <Text style={[text.display, { marginBottom: sp.sm }]}>Check your email</Text>
            <Text style={[text.bodySerif, { color: colors.inkMuted, marginBottom: sp.xxl }]}>
              If an account uses {email.trim()}, a 6-digit code is on its way. It expires in 10 minutes.
            </Text>
            <TextField
              label="Your code"
              value={code}
              onChangeText={(t) => setCode(t.replace(/[^0-9]/g, '').slice(0, 6))}
              placeholder="123456"
              keyboardType="number-pad"
              maxLength={6}
              autoComplete="one-time-code"
            />
            <FormError message={error} />
            <PrimaryButton title="Continue" onPress={continueWithCode} />
            <SecondaryButton title="Send it again" onPress={sendCode} loading={busy} style={{ marginTop: sp.md }} />
          </View>
        )}

        {step === 'password' && (
          <View>
            <Text style={[text.display, { marginBottom: sp.sm }]}>Set a new password</Text>
            <Text style={[text.bodySerif, { color: colors.inkMuted, marginBottom: sp.xxl }]}>
              Choose something at least 8 characters long.
            </Text>
            <TextField
              label="New password"
              value={password}
              onChangeText={setPassword}
              placeholder="Your new password"
              secureTextEntry
              autoComplete="new-password"
            />
            <TextField
              label="Confirm new password"
              value={confirm}
              onChangeText={setConfirm}
              placeholder="Type it again"
              secureTextEntry
              autoComplete="new-password"
            />
            <FormError message={error} />
            <PrimaryButton title="Save and sign in" onPress={finish} loading={busy} />
          </View>
        )}
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
  back: { flexDirection: 'row', alignItems: 'center', gap: 2, marginBottom: sp.lg },
});
