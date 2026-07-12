import React from 'react';
import { Platform, Text, useWindowDimensions, View } from 'react-native';
import { Redirect, Tabs } from 'expo-router';
import { useAuth } from '@/lib/auth';
import { NotificationsProvider } from '@/lib/notifications';
import { HeaderActions } from '@/components/HeaderActions';
import { TopNav } from '@/components/TopNav';
import { NudgeToast } from '@/components/NudgeToast';
import { colors, font, type } from '@/theme';

function TabIcon({ glyph, focused }: { glyph: string; focused: boolean }) {
  return <Text style={{ fontSize: 17, color: focused ? colors.rose : colors.inkSoft }}>{glyph}</Text>;
}

export default function TabsLayout() {
  const { status } = useAuth();
  const { width } = useWindowDimensions();
  const wide = Platform.OS === 'web' && width >= 900;

  if (status === 'loading') return null;
  if (status === 'signedOut') return <Redirect href="/welcome" />;

  return (
    <NotificationsProvider>
      <View style={{ flex: 1, backgroundColor: colors.cream }}>
        {wide && <TopNav />}
        <Tabs
          screenOptions={{
            headerShown: !wide,
            headerStyle: { backgroundColor: colors.cream },
            headerShadowVisible: false,
            headerTitleStyle: { fontFamily: font.display, fontSize: type.title, color: colors.ink },
            headerTitleAlign: 'left',
            headerRight: () => <HeaderActions />,
            tabBarStyle: wide
              ? { display: 'none' }
              : {
                  backgroundColor: colors.cream,
                  borderTopColor: colors.hairline,
                  borderTopWidth: 1,
                },
            tabBarActiveTintColor: colors.rose,
            tabBarInactiveTintColor: colors.inkSoft,
            tabBarLabelStyle: { fontSize: type.tiny, fontWeight: '600' },
            sceneStyle: { backgroundColor: colors.cream },
          }}
        >
          <Tabs.Screen
            name="index"
            options={{ title: 'Home', tabBarIcon: ({ focused }) => <TabIcon glyph="♥" focused={focused} /> }}
          />
          <Tabs.Screen
            name="memories"
            options={{ title: 'Memories', tabBarIcon: ({ focused }) => <TabIcon glyph="✧" focused={focused} /> }}
          />
          <Tabs.Screen
            name="notes"
            options={{ title: 'Notes', tabBarIcon: ({ focused }) => <TabIcon glyph="♡" focused={focused} /> }}
          />
          <Tabs.Screen
            name="milestones"
            options={{ title: 'Milestones', tabBarIcon: ({ focused }) => <TabIcon glyph="◷" focused={focused} /> }}
          />
          <Tabs.Screen
            name="settings"
            options={{ title: 'Settings', tabBarIcon: ({ focused }) => <TabIcon glyph="⚙" focused={focused} /> }}
          />
          <Tabs.Screen name="notifications" options={{ title: 'Activity', href: null }} />
        </Tabs>
        <NudgeToast />
      </View>
    </NotificationsProvider>
  );
}
