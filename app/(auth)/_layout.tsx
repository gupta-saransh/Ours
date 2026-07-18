import React from 'react';
import { Redirect, Stack, useGlobalSearchParams } from 'expo-router';
import { useAuth } from '@/lib/auth';
import { colors } from '@/theme';

export default function AuthLayout() {
  const { status } = useAuth();
  // An invite link (/sign-up?join=CODE) tapped by someone who ALREADY has an
  // account would otherwise land here, get bounced home, and quietly lose the
  // code. Carry it to the pairing screen instead.
  //
  // useGLOBALSearchParams, not useLocalSearchParams: inside a LAYOUT the local
  // hook reports the params of the layout's own segment, and a route group has
  // none, so `join` always read as undefined and every invite opened by an
  // already-signed-in person died here. That is the exact case you hit when you
  // test your own invite link on your own phone.
  const { join } = useGlobalSearchParams<{ join?: string }>();

  if (status === 'loading') return null;
  if (status === 'signedIn') {
    const code = typeof join === 'string' ? join.trim() : '';
    return code ? <Redirect href={`/pair?join=${encodeURIComponent(code)}`} /> : <Redirect href="/" />;
  }
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.cream } }} />
  );
}
