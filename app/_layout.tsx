import React, { useEffect } from 'react';
import { View } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import {
  useFonts,
  Fraunces_400Regular,
  Fraunces_400Regular_Italic,
  Fraunces_500Medium,
  Fraunces_600SemiBold,
} from '@expo-google-fonts/fraunces';
import { AuthProvider } from '@/lib/auth';
import { RealtimeProvider } from '@/lib/realtime';
import { ToastProvider } from '@/lib/toast';
import { registerServiceWorker } from '@/lib/push-web';
import { colors } from '@/theme';

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    Fraunces_400Regular,
    Fraunces_400Regular_Italic,
    Fraunces_500Medium,
    Fraunces_600SemiBold,
  });

  // Register the Web Push service worker on web (no-op on native, no prompt).
  useEffect(() => {
    registerServiceWorker();
  }, []);

  if (!fontsLoaded) {
    return <View style={{ flex: 1, backgroundColor: colors.cream }} />;
  }

  return (
    <AuthProvider>
      <RealtimeProvider>
        <ToastProvider>
          <StatusBar style="dark" backgroundColor={colors.cream} />
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: colors.cream },
            }}
          />
        </ToastProvider>
      </RealtimeProvider>
    </AuthProvider>
  );
}
