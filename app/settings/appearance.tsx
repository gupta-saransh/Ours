import React from 'react';
import { Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import { Check } from 'lucide-react-native';
import { useAuth } from '@/lib/auth';
import { AppPressable, Card, Screen, SubScreenHeader } from '@/components/kit';
import {
  colors,
  font,
  paletteFor,
  persistThemePreset,
  radius,
  sp,
  text,
  THEME_PRESETS,
  themePreset,
  type ThemePresetId,
} from '@/theme';

/** The shared look for the space: one of five presets, applied for both partners. */
export default function AppearanceSettings() {
  const { status, updateProfile } = useAuth();
  const router = useRouter();

  if (status === 'loading') return null;
  if (status !== 'signedIn') return <Redirect href="/welcome" />;
  // Theme switching relies on a synchronous localStorage read at bundle
  // evaluation, which only exists on web (the deployed platform).
  if (Platform.OS !== 'web') return <Redirect href="/settings" />;

  // Presets bake into module-scope styles, so applying one is: persist the id
  // (localStorage + account) and reload the page under the new palette.
  const chooseTheme = async (id: ThemePresetId) => {
    if (id === themePreset) return;
    persistThemePreset(id);
    try {
      await updateProfile({ themePreset: id });
    } catch {
      // The local choice still applies; the account catches up next save.
    }
    if (typeof window !== 'undefined') window.location.reload();
  };

  return (
    <Screen>
      <SubScreenHeader title="Appearance" onBack={() => router.back()} />
      <ScrollView contentContainerStyle={styles.body}>
        <Text style={[text.caption, { marginBottom: sp.md }]}>
          Dress your space, for both of you. Your partner wears the new look next time they open Ours.
        </Text>
        <Card>
          {THEME_PRESETS.map((p, i) => {
            const pal = paletteFor(p.id);
            const active = p.id === themePreset;
            return (
              <AppPressable key={p.id} onPress={() => chooseTheme(p.id)}>
                <View style={[styles.themeRow, i > 0 && styles.rowBorder]}>
                  <View style={[styles.themeTile, { backgroundColor: pal.surface, borderColor: pal.hairline }]}>
                    <View
                      style={[styles.themeTileCard, { backgroundColor: pal.surfaceRaised, borderColor: pal.hairline }]}
                    >
                      <Text style={[styles.themeTileAa, { color: pal.ink }]}>Aa</Text>
                      <View style={[styles.themeTileSeal, { backgroundColor: pal.surfaceSealed }]} />
                    </View>
                    <View style={[styles.themeTileRule, { backgroundColor: pal.accent }]} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={text.body}>{p.name}</Text>
                    <Text style={text.caption}>{p.line}</Text>
                  </View>
                  {active && <Check size={18} color={colors.accent} strokeWidth={2} />}
                </View>
              </AppPressable>
            );
          })}
        </Card>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: {
    padding: sp.lg,
    paddingBottom: sp.huge,
    width: '100%',
    maxWidth: 620,
    alignSelf: 'center',
  },
  rowBorder: { borderTopWidth: 1, borderTopColor: colors.hairline },
  themeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: sp.md,
    paddingVertical: sp.md,
  },
  // Mini mock of a themed screen: ground, one raised card with serif ink and a
  // wax-seal dot, one accent rule. Enough to read the palette at a glance.
  themeTile: {
    width: 64,
    height: 48,
    borderRadius: radius.sm,
    borderWidth: 1,
    padding: 6,
    justifyContent: 'space-between',
  },
  themeTileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  themeTileAa: { fontFamily: font.serif, fontSize: 11, lineHeight: 14 },
  themeTileSeal: { width: 8, height: 8, borderRadius: 4 },
  themeTileRule: { height: 2, borderRadius: 1, width: 24 },
});
