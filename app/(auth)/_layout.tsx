import React from 'react';
import { Redirect, Stack, useLocalSearchParams } from 'expo-router';
import { useAuth } from '@/lib/auth';
import { colors } from '@/theme';

export default function AuthLayout() {
  const { status } = useAuth();
  // An invite link (/sign-up?join=CODE) tapped by someone who ALREADY has an
  // account would otherwise land here, get bounced home, and quietly lose the
  // code. Carry it to the pairing screen instead.
  const { join } = useLocalSearchParams<{ join?: string }>();

  if (status === 'loading') return null;
  if (status === 'signedIn') {
    return typeof join === 'string' && join.trim() ? (
      <Redirect href={`/pair?join=${encodeURIComponent(join.trim())}`} />
    ) : (
      <Redirect href="/" />
    );
  }
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.cream } }} />
  );
}
