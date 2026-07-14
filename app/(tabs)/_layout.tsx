import React from 'react';
import { Platform, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Redirect, Tabs } from 'expo-router';
import { CalendarHeart, Gift, Home, Image as ImageIcon, StickyNote } from 'lucide-react-native';
import { useAuth } from '@/lib/auth';
import { NotificationsProvider } from '@/lib/notifications';
import { tapHaptic } from '@/lib/haptics';
import { HeaderActions } from '@/components/HeaderActions';
import { TopNav } from '@/components/TopNav';
import { NudgeToast } from '@/components/NudgeToast';
import { AddMenu } from '@/components/AddMenu';
import { colors, font, text } from '@/theme';

// Height of the interactive strip (icons + labels). The bar's background then
// extends BELOW this by the bottom safe-area inset, so on an iPhone PWA the
// parchment fills behind the home indicator while touch targets stay above it.
const TAB_BAR_CONTENT_HEIGHT = 54;

export default function TabsLayout() {
  const { status } = useAuth();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const wide = Platform.OS === 'web' && width >= 900;

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
                  height: TAB_BAR_CONTENT_HEIGHT + insets.bottom,
                  paddingBottom: insets.bottom,
                  paddingTop: 6,
                },
            tabBarActiveTintColor: colors.surfaceSealed,
            tabBarInactiveTintColor: colors.inkMuted,
            tabBarLabelStyle: { ...text.micro, textTransform: 'none' },
            sceneStyle: { backgroundColor: colors.surface },
          }}
        >
          <Tabs.Screen name="index" options={{ title: 'Home', headerShown: false, tabBarIcon: icon(Home) }} />
          <Tabs.Screen name="memories" options={{ title: 'Memories', tabBarIcon: icon(ImageIcon) }} />
          <Tabs.Screen name="notes" options={{ title: 'Notes', tabBarIcon: icon(StickyNote) }} />
          <Tabs.Screen name="dates" options={{ title: 'Dates', tabBarIcon: icon(CalendarHeart) }} />
          <Tabs.Screen name="wishlist" options={{ title: 'Wishlist', tabBarIcon: icon(Gift) }} />
          <Tabs.Screen name="milestones" options={{ title: 'Milestones', href: null }} />
          <Tabs.Screen name="settings" options={{ title: 'Settings', href: null }} />
          <Tabs.Screen name="notifications" options={{ title: 'Activity', href: null }} />
          <Tabs.Screen name="prompts" options={{ title: 'Prompts', href: null }} />
          <Tabs.Screen name="reflections" options={{ title: 'Reflections', href: null }} />
        </Tabs>
        <AddMenu />
        <NudgeToast />
      </View>
    </NotificationsProvider>
  );
}
