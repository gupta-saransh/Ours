import React, { useState } from 'react';
import { Platform, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Check, Lock } from 'lucide-react-native';
import { useAuth } from '@/lib/auth';
import { disableWebPush, enableWebPush } from '@/lib/push-web';
import {
  AppPressable,
  Card,
  FormError,
  PrimaryButton,
  Screen,
  SecondaryButton,
  Section,
  TextField,
} from '@/components/kit';
import { Avatar, AVATARS } from '@/components/Avatar';
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

export default function Settings() {
  const { user, couple, partner, encryption, encryptionCode, updateProfile, signOut, deleteAccount } = useAuth();
  const router = useRouter();
  const [name, setName] = useState(user?.display_name ?? '');
  const [savingName, setSavingName] = useState(false);
  const [nameSaved, setNameSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const saveName = async () => {
    setError(null);
    setSavingName(true);
    try {
      await updateProfile({ displayName: name.trim() });
      setNameSaved(true);
      setTimeout(() => setNameSaved(false), 2000);
    } catch (err: any) {
      setError(err?.message ?? 'Something went wrong');
    } finally {
      setSavingName(false);
    }
  };

  const toggleNotifications = async (value: boolean) => {
    setError(null);
    try {
      await updateProfile({ notificationsEnabled: value });
      // On web, enabling also asks the browser to allow push and subscribes.
      // Native keeps its own expo-notifications flow (unchanged).
      if (Platform.OS === 'web') {
        if (value) {
          await enableWebPush();
        } else {
          await disableWebPush();
        }
      }
    } catch (err: any) {
      setError(err?.message ?? 'Something went wrong');
    }
  };

  const chooseMark = async (id: string) => {
    if (id === user?.avatar) return;
    setError(null);
    try {
      await updateProfile({ avatar: id });
    } catch (err: any) {
      setError(err?.message ?? 'Something went wrong');
    }
  };

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

  const removeAccount = async () => {
    setDeleting(true);
    setError(null);
    try {
      await deleteAccount();
    } catch (err: any) {
      setError(err?.message ?? 'Something went wrong');
      setDeleting(false);
    }
  };

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.body}>
        <FormError message={error} />

        <Section label="Profile">
          <Card>
            <View style={styles.nameRow}>
              <View style={{ flex: 1 }}>
                <TextField label="Your name" value={name} onChangeText={setName} />
              </View>
              <SecondaryButton
                title={nameSaved ? 'Saved ✓' : 'Save'}
                onPress={saveName}
                loading={savingName}
                disabled={!name.trim() || name.trim() === user?.display_name}
                style={styles.saveButton}
              />
            </View>
            <Text style={text.caption}>Email</Text>
            <Text style={text.body}>{user?.email}</Text>
            <View style={styles.markBlock}>
              <Text style={text.body}>Your mark</Text>
              <Text style={[text.caption, { marginBottom: sp.md }]}>
                A little sign that stands for you.{' '}
                {partner ? `${partner.display_name} sees it beside everything you write.` : 'Your partner will see it beside everything you write.'}
              </Text>
              <View style={styles.markGrid}>
                {AVATARS.map((a) => {
                  const active = user?.avatar === a.id;
                  return (
                    <AppPressable
                      key={a.id}
                      onPress={() => chooseMark(a.id)}
                      style={[styles.markCell, active && styles.markCellActive]}
                    >
                      <Avatar id={a.id} size={40} />
                    </AppPressable>
                  );
                })}
              </View>
            </View>
          </Card>
        </Section>

        <Section label="Your space">
          <Card>
            <View style={styles.row}>
              <Text style={text.body}>Partner</Text>
              <View style={styles.partnerCell}>
                {partner && <Avatar id={partner.avatar} name={partner.display_name} size={24} />}
                <Text style={[text.body, { color: colors.inkMuted }]}>
                  {partner ? partner.display_name : 'Just you so far'}
                </Text>
              </View>
            </View>
            <View style={[styles.row, styles.rowBorder]}>
              <Text style={text.body}>Invite code</Text>
              <Text style={styles.code}>{couple?.invite_code ?? '...'}</Text>
            </View>
            <View style={[styles.row, styles.rowBorder]}>
              <Text style={text.body}>Plan</Text>
              <Text style={[text.body, { color: colors.inkMuted }]}>Free · everything included</Text>
            </View>
            {!partner && (
              <SecondaryButton
                title="Link with your partner"
                onPress={() => router.push('/pair')}
                style={{ marginTop: sp.md }}
              />
            )}
          </Card>
        </Section>

        <Section label="Notifications">
          <Card>
            <View style={styles.row}>
              <View style={{ flex: 1, paddingRight: sp.base }}>
                <Text style={text.body}>Nudges and new notes</Text>
                <Text style={text.caption}>
                  Get them even when Ours is closed. On iPhone, add Ours to your home screen first, then turn this on.
                </Text>
              </View>
              <Switch
                value={user?.notifications_enabled ?? true}
                onValueChange={toggleNotifications}
                trackColor={{ true: colors.blush, false: colors.hairline }}
                thumbColor={user?.notifications_enabled ? colors.surfaceSealed : '#FFFFFF'}
              />
            </View>
          </Card>
        </Section>

        {/* Theme switching relies on a synchronous localStorage read at bundle
            evaluation, which only exists on web (the deployed platform). */}
        {Platform.OS === 'web' && (
          <Section label="Appearance">
            <Card>
              <Text style={[text.caption, { marginBottom: sp.sm }]}>
                Dress your space, for both of you. Your partner wears the new look next time they open Ours.
              </Text>
              {THEME_PRESETS.map((p, i) => {
                const pal = paletteFor(p.id);
                const active = p.id === themePreset;
                return (
                  <AppPressable key={p.id} onPress={() => chooseTheme(p.id)}>
                    <View style={[styles.themeRow, i > 0 && styles.rowBorder]}>
                      <View style={[styles.themeTile, { backgroundColor: pal.surface, borderColor: pal.hairline }]}>
                        <View
                          style={[
                            styles.themeTileCard,
                            { backgroundColor: pal.surfaceRaised, borderColor: pal.hairline },
                          ]}
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
          </Section>
        )}

        <Section label="Privacy">
          <Card>
            <View style={styles.privacyHead}>
              <Lock size={16} color={colors.accent} strokeWidth={1.75} />
              <Text style={text.subtitle}>Encrypted at rest</Text>
            </View>
            <Text style={[text.body, { color: colors.inkMuted, marginTop: sp.sm }]}>
              {encryption
                ? 'Your memories, notes, prompts, and wishes are encrypted before they reach our database. If our systems were ever exposed, the contents would be unreadable without your seal code. What you keep here stays between the two of you.'
                : 'We’re turning on encryption at rest for your private moments. Once it’s live, your memories, notes, prompts, and wishes are encrypted before they reach our database, so their contents would be unreadable if our systems were ever exposed.'}
            </Text>
            {encryption && encryptionCode && (
              <View style={styles.sealRow}>
                <View style={{ flex: 1, paddingRight: sp.base }}>
                  <Text style={text.body}>Your seal code</Text>
                  <Text style={text.caption}>
                    Made from your space's encryption key. Open Settings on your partner's phone and this
                    code reads the same there.
                  </Text>
                </View>
                <Text style={styles.code}>{encryptionCode}</Text>
              </View>
            )}
          </Card>
        </Section>

        <Section label="Account">
          <SecondaryButton title="Log out" onPress={signOut} />
          <View style={{ height: sp.md }} />
          {confirmingDelete ? (
            <Card style={{ borderColor: colors.danger }}>
              <Text style={text.subtitle}>Delete your account?</Text>
              <Text style={[text.caption, { marginTop: sp.xs, marginBottom: sp.base }]}>
                This permanently removes your account and everything you added. It cannot be undone.
              </Text>
              <PrimaryButton title="Yes, delete everything" onPress={removeAccount} loading={deleting} />
              <SecondaryButton title="Keep my account" onPress={() => setConfirmingDelete(false)} style={{ marginTop: sp.md }} />
            </Card>
          ) : (
            <SecondaryButton title="Delete account" destructive onPress={() => setConfirmingDelete(true)} />
          )}
        </Section>

        <Text style={styles.footer}>Ours · a little home for the two of you ♥</Text>
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
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: sp.md },
  partnerCell: { flexDirection: 'row', alignItems: 'center', gap: sp.sm },
  markBlock: {
    marginTop: sp.base,
    paddingTop: sp.md,
    borderTopWidth: 1,
    borderTopColor: colors.hairline,
  },
  markGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm },
  markCell: {
    padding: 3,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  markCellActive: { borderColor: colors.accent },
  privacyHead: { flexDirection: 'row', alignItems: 'center', gap: sp.sm },
  saveButton: { height: 40, paddingHorizontal: sp.base, marginTop: sp.sm },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: sp.md,
    gap: sp.md,
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
  sealRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: sp.base,
    paddingTop: sp.md,
    borderTopWidth: 1,
    borderTopColor: colors.hairline,
  },
  code: {
    ...text.body,
    color: colors.surfaceSealed,
    fontWeight: '600',
    letterSpacing: 3,
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
  },
  footer: {
    ...text.caption,
    textAlign: 'center',
    marginTop: sp.xxl,
    fontStyle: 'italic',
  },
});
