import React, { useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Redirect, Tabs } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import { NudgeToast } from '@/components/NudgeToast';
import { colors, font, type } from '@/theme';

function TabIcon({ glyph, focused }: { glyph: string; focused: boolean }) {
  return (
    <Text style={{ fontSize: 17, color: focused ? colors.rose : colors.inkSoft }}>{glyph}</Text>
  );
}

/** ♥ in the header — sends a live "thinking of you" to your partner. */
function NudgeButton() {
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const send = async () => {
    if (state !== 'idle') return;
    setState('sending');
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    }
    try {
      await api('/api/nudge', { method: 'POST' });
      setState('sent');
      if (resetTimer.current) clearTimeout(resetTimer.current);
      resetTimer.current = setTimeout(() => setState('idle'), 2500);
    } catch {
      setState('idle');
    }
  };

  return (
    <Pressable onPress={send} style={({ pressed }) => [styles.nudge, pressed && { backgroundColor: colors.blushSoft }]}>
      <Text style={styles.nudgeText}>{state === 'sent' ? 'Sent ♥' : 'Nudge ♥'}</Text>
    </Pressable>
  );
}

export default function TabsLayout() {
  const { status, user } = useAuth();
  if (status === 'loading') return null;
  if (status === 'signedOut') return <Redirect href="/welcome" />;
  if (!user?.couple_id) return <Redirect href="/pair" />;

  return (
    <View style={{ flex: 1 }}>
      <Tabs
        screenOptions={{
          headerShown: true,
          headerStyle: { backgroundColor: colors.cream },
          headerShadowVisible: false,
          headerTitleStyle: { fontFamily: font.display, fontSize: type.title, color: colors.ink },
          headerTitleAlign: 'left',
          headerRight: () => <NudgeButton />,
          tabBarStyle: {
            backgroundColor: colors.cream,
            borderTopColor: colors.hairline,
            borderTopWidth: 1,
            height: Platform.OS === 'web' ? 60 : undefined,
          },
          tabBarActiveTintColor: colors.rose,
          tabBarInactiveTintColor: colors.inkSoft,
          tabBarLabelStyle: { fontSize: type.tiny, fontWeight: '600' },
          sceneStyle: { backgroundColor: colors.cream },
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: 'Memories',
            tabBarIcon: ({ focused }) => <TabIcon glyph="✧" focused={focused} />,
          }}
        />
        <Tabs.Screen
          name="notes"
          options={{
            title: 'Notes',
            tabBarIcon: ({ focused }) => <TabIcon glyph="♡" focused={focused} />,
          }}
        />
        <Tabs.Screen
          name="milestones"
          options={{
            title: 'Milestones',
            tabBarIcon: ({ focused }) => <TabIcon glyph="◷" focused={focused} />,
          }}
        />
        <Tabs.Screen
          name="settings"
          options={{
            title: 'Settings',
            tabBarIcon: ({ focused }) => <TabIcon glyph="⚙" focused={focused} />,
          }}
        />
      </Tabs>
      <NudgeToast />
    </View>
  );
}

const styles = StyleSheet.create({
  nudge: {
    marginRight: 16,
    borderWidth: 1,
    borderColor: colors.blush,
    borderRadius: 999,
    paddingVertical: 7,
    paddingHorizontal: 14,
  },
  nudgeText: {
    color: colors.rose,
    fontSize: type.small,
    fontWeight: '600',
  },
});
