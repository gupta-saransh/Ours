import React from 'react';
import { Redirect, Stack } from 'expo-router';
import { useAuth } from '@/lib/auth';
import { colors } from '@/theme';

export default function AuthLayout() {
  const { status, user } = useAuth();
  if (status === 'loading') return null;
  if (status === 'signedIn') {
    return <Redirect href={user?.couple_id ? '/' : '/pair'} />;
  }
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.cream } }} />
  );
}
