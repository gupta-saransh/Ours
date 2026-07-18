import React, { useEffect } from 'react';
import { Platform, useWindowDimensions, View } from 'react-native';
import { Redirect, Tabs } from 'expo-router';
import { CalendarHeart, Gift, Home, Image as ImageIcon, StickyNote } from 'lucide-react-native';
import { useAuth } from '@/lib/auth';
import { NotificationsProvider } from '@/lib/notifications';
import { tapHaptic } from '@/lib/haptics';
import { HeaderActions } from '@/components/HeaderActions';
import { TopNav } from '@/components/TopNav';
import { NudgeToast } from '@/components/NudgeToast';
import { HeartsRain } from '@/components/HeartsRain';
import { AddMenu } from '@/components/AddMenu';
import { ChatButton } from '@/components/ChatButton';
import { NotificationsInvite } from '@/components/NotificationsInvite';
import { ensureWebPushSubscribed } from '@/lib/push-web';
import { useSafeBottom } from '@/lib/safeArea';
import { colors, font, text } from '@/theme';

// Height of the interactive strip (icons + labels). The bar's background then
// extends BELOW this by the bottom safe-area inset, so on an iPhone PWA the
// parchment fills behind the home indicator while touch targets stay above it.
const TAB_BAR_CONTENT_HEIGHT = 58;

export default function TabsLayout() {
  const { status, user } = useAuth();
  const { width } = useWindowDimensions();
  const safeBottom = useSafeBottom();
  const wide = Platform.OS === 'web' && width >= 900;

  // Signed in and notifications are meant to be on: make sure the server
  // actually holds a live subscription. Silent (never prompts), and it fixes
  // accounts whose push_token went missing or was never stored.
  const notificationsOn = user?.notifications_enabled;
  useEffect(() => {
    if (status === 'signedIn' && notificationsOn) ensureWebPushSubscribed();
  }, [status, notificationsOn]);

  if (status === 'loading') return null;
  if (status === 'signedOut') return <Redirect href="/welcome" />;

  const icon =
    (Glyph: typeof Home) =>
    ({ focused }: { focused: boolean }) => (
      <Glyph size={22} strokeWidth={1.75} color={focused ? colors.surfaceSealed : colors.inkMuted} />
    );

  return (
    <NotificationsProvider>
      <View style={{ flex: 1, backgroundColor: colors.surface }}>
        {wide && <TopNav />}
        <Tabs
          screenListeners={{ tabPress: () => tapHaptic() }}
          screenOptions={{
            headerShown: !wide,
            headerStyle: { backgroundColor: colors.surface },
            headerShadowVisible: false,
            headerTitleStyle: { fontFamily: font.displayMedium, fontSize: 24, color: colors.ink },
            headerTitleAlign: 'left',
            headerRight: () => <HeaderActions />,
            tabBarStyle: wide
              ? { display: 'none' }
              : {
                  backgroundColor: colors.surface,
                  borderTopColor: colors.hairline,
                  borderTopWidth: 1,
                  // Fill the home-indicator area with the bar's own background,
                  // but keep icons and labels above it via paddingBottom.
                  height: TAB_BAR_CONTENT_HEIGHT + safeBottom,
                  paddingBottom: safeBottom,
                  paddingTop: 6,
                },
            tabBarActiveTintColor: colors.surfaceSealed,
            tabBarInactiveTintColor: colors.inkMuted,
            // Explicit lineHeight + no font scaling: label height must never
            // exceed the fixed bar height (clipped labels otherwise).
            tabBarLabelStyle: { ...text.micro, textTransform: 'none', lineHeight: 14 },
            tabBarAllowFontScaling: false,
            sceneStyle: { backgroundColor: colors.surface },
          }}
        >
          <Tabs.Screen name="index" options={{ title: 'Home', headerShown: false, tabBarIcon: icon(Home) }} />
          <Tabs.Screen name="memories" options={{ title: 'Memories', tabBarIcon: icon(ImageIcon) }} />
          <Tabs.Screen name="notes" options={{ title: 'Notes', tabBarIcon: icon(StickyNote) }} />
          <Tabs.Screen name="dates" options={{ title: 'Dates', tabBarIcon: icon(CalendarHeart) }} />
          <Tabs.Screen name="wishlist" options={{ title: 'Wishes', tabBarIcon: icon(Gift) }} />
          <Tabs.Screen name="milestones" options={{ title: 'Milestones', href: null }} />
          <Tabs.Screen name="settings" options={{ title: 'Settings', href: null }} />
          <Tabs.Screen name="notifications" options={{ title: 'Activity', href: null }} />
          <Tabs.Screen name="prompts" options={{ title: 'Prompts', href: null }} />
          <Tabs.Screen name="reflections" options={{ title: 'Reflections', href: null }} />
        </Tabs>
        <ChatButton />
        <AddMenu />
        <NudgeToast />
        <HeartsRain />
        <NotificationsInvite />
      </View>
    </NotificationsProvider>
  );
}
