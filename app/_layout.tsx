import React, { useEffect } from 'react';
import { View, Platform } from 'react-native';
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
import { installGlobalLogging } from '@/lib/log';
import { captureInstallPrompt } from '@/lib/install';
import { colors } from '@/theme';

// Import Vercel Analytics for web only
let Analytics: React.ComponentType<any> | null = null;
if (Platform.OS === 'web') {
  Analytics = require('@vercel/analytics/react').Analytics;
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    Fraunces_400Regular,
    Fraunces_400Regular_Italic,
    Fraunces_500Medium,
    Fraunces_600SemiBold,
  });

  // Catch uncaught errors app-wide, then register the Web Push service worker on
  // web (no-op on native, no prompt). Logging goes first so a failure in the
  // registration itself is recorded.
  useEffect(() => {
    installGlobalLogging();
    // Must be early: the browser's install offer fires soon after load, once.
    captureInstallPrompt();
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
          {Analytics && <Analytics />}
        </ToastProvider>
      </RealtimeProvider>
    </AuthProvider>
  );
}
