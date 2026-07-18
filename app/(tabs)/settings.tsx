import React, { useCallback, useEffect, useState } from 'react';
import { Platform, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useRouter } from 'expo-router';
import { Check, Lock } from 'lucide-react-native';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
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

/** What the server can see about this account's notification delivery. */
interface PushStatus {
  serverConfigured: boolean;
  notificationsEnabled: boolean;
  hasSubscription: boolean;
  endpointHost: string | null;
}

/** Turn the server's machine-readable failure into something a person can act on. */
function reasonCopy(reason?: string): string {
  switch (reason) {
    case 'notifications-off':
      return 'Notifications are turned off for your account.';
    case 'no-subscription':
      return 'This device has not signed up yet. Turn the switch off, then on again.';
    case 'vapid-not-configured':
      return 'The server is missing its notification keys.';
    case 'subscription-expired':
      return 'This device signed up a while ago and it has lapsed. Turn the switch off, then on again.';
    case 'send-failed':
      return 'The notification service turned it away. The logs have the details.';
    case 'native-not-provisioned':
      return 'This build cannot receive them. Use Ours from your home screen.';
    default:
      return 'Could not send it.';
  }
}

export default function Settings() {
  const { user, couple, partner, encryption, encryptionCode, updateProfile, refresh, signOut, deleteAccount } = useAuth();
  const router = useRouter();
  const [name, setName] = useState(user?.display_name ?? '');
  const [savingName, setSavingName] = useState(false);
  const [nameSaved, setNameSaved] = useState(false);
  const [nick, setNick] = useState(partner?.nickname ?? '');
  const [savingNick, setSavingNick] = useState(false);
  const [nickSaved, setNickSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [pushStatus, setPushStatus] = useState<PushStatus | null>(null);
  const [pushResult, setPushResult] = useState<string | null>(null);
  const [testingPush, setTestingPush] = useState(false);
  const [referral, setReferral] = useState<{ code: string | null; joined: number } | null>(null);
  const [referralCopied, setReferralCopied] = useState(false);

  useEffect(() => {
    api<{ code: string | null; joined: number }>('/api/referral')
      .then(setReferral)
      .catch(() => setReferral(null));
  }, []);

  // The share link. On web this is the real deployed origin; native builds fall
  // back to the code alone, which signup also accepts typed by hand.
  const referralLink = (code: string) =>
    Platform.OS === 'web' && typeof window !== 'undefined'
      ? `${window.location.origin}/sign-up?ref=${code}`
      : `Join us on Ours with code ${code}`;

  const copyReferral = async () => {
    if (!referral?.code) return;
    await Clipboard.setStringAsync(referralLink(referral.code));
    setReferralCopied(true);
    setTimeout(() => setReferralCopied(false), 2000);
  };

  // Ask the server what it can see about this account's notifications.
  const loadPushStatus = useCallback(() => {
    api<PushStatus>('/api/push/subscribe')
      .then(setPushStatus)
      .catch(() => setPushStatus(null));
  }, []);
  useEffect(loadPushStatus, [loadPushStatus]);

  const sendTestPush = async () => {
    setPushResult(null);
    setTestingPush(true);
    try {
      const result = await api<{ delivered: boolean; reason?: string }>('/api/push/subscribe', {
        method: 'POST',
        body: { test: true },
      });
      setPushResult(
        result.delivered ? 'Sent. It should arrive in a moment.' : reasonCopy(result.reason)
      );
    } catch (err: any) {
      setPushResult(err?.message ?? 'Could not send it.');
    } finally {
      setTestingPush(false);
      loadPushStatus();
    }
  };

  // The switch must show DELIVERY, not intent. notifications_enabled defaults
  // to true for every new account, so binding the switch to it alone showed
  // "on" to people the server could never reach. On web it is only really on
  // when a subscription is stored too. (Native has its own flow, so intent is
  // all we have there.)
  const notificationsOn =
    Platform.OS === 'web' && pushStatus
      ? pushStatus.notificationsEnabled && pushStatus.hasSubscription
      : user?.notifications_enabled ?? true;

  // What to say before a test is run, from the server's own view of things.
  const pushLine =
    pushResult ??
    (pushStatus === null
      ? 'Checking this device.'
      : !pushStatus.serverConfigured
        ? 'Notifications are not set up on the server yet.'
        : !pushStatus.notificationsEnabled
          ? 'Turn the switch on to start getting them.'
          : !pushStatus.hasSubscription
            ? 'This device is not signed up yet. Turn the switch on, and allow notifications when your browser asks.'
            : 'This device is signed up. Send one to be sure.');

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

  const saveNick = async () => {
    setError(null);
    setSavingNick(true);
    try {
      await updateProfile({ partnerNickname: nick.trim() || null });
      // Re-resolve /api/auth/me so the partner's shown name updates everywhere.
      await refresh();
      setNickSaved(true);
      setTimeout(() => setNickSaved(false), 2000);
    } catch (err: any) {
      setError(err?.message ?? 'Something went wrong');
    } finally {
      setSavingNick(false);
    }
  };

  const toggleNotifications = async (value: boolean) => {
    setError(null);
    setPushResult(null);
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
    } finally {
      // Re-read the server's view so the switch settles on the truth, whether
      // the browser prompt was granted, dismissed, or blocked.
      loadPushStatus();
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
            {partner && (
              <View style={[styles.nickBlock, styles.rowBorder]}>
                <View style={styles.nameRow}>
                  <View style={{ flex: 1 }}>
                    <TextField
                      label={`Nickname for ${partner.realName ?? partner.display_name}`}
                      value={nick}
                      onChangeText={setNick}
                      placeholder={partner.realName ?? partner.display_name}
                      maxLength={40}
                    />
                  </View>
                  <SecondaryButton
                    title={nickSaved ? 'Saved ✓' : 'Save'}
                    onPress={saveNick}
                    loading={savingNick}
                    disabled={nick.trim() === (partner.nickname ?? '')}
                    style={styles.saveButton}
                  />
                </View>
                <Text style={text.caption}>
                  Shows across the app in place of their name. Only you see it.
                </Text>
              </View>
            )}
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
                value={notificationsOn}
                onValueChange={toggleNotifications}
                trackColor={{ true: colors.blush, false: colors.hairline }}
                thumbColor={notificationsOn ? colors.surfaceSealed : '#FFFFFF'}
              />
            </View>
            {/* Delivery has several moving parts (server keys, browser
                permission, a subscription that can quietly expire). This asks
                the server what it sees, and can send a real one to prove it. */}
            <View style={[styles.row, styles.rowBorder, styles.testRow]}>
              <View style={{ flex: 1, paddingRight: sp.base }}>
                <Text style={text.body}>Check they are working</Text>
                <Text style={text.caption}>{pushLine}</Text>
              </View>
              <SecondaryButton title="Send a test" onPress={sendTestPush} loading={testingPush} />
            </View>
          </Card>
        </Section>

        <Section label="Share Ours">
          <Card>
            <Text style={[text.caption, { marginBottom: sp.md }]}>
              Know another pair who would love a little home like this? Send them your link.
            </Text>
            <AppPressable onPress={copyReferral} style={styles.referralChip} disabled={!referral?.code}>
              <Text style={styles.referralLink} numberOfLines={1}>
                {referral?.code ? referralLink(referral.code) : 'Getting your link...'}
              </Text>
              <Text style={text.caption}>{referralCopied ? 'Copied ✓' : 'Tap to copy'}</Text>
            </AppPressable>
            {referral && referral.joined > 0 && (
              <Text style={[text.caption, { marginTop: sp.sm, textAlign: 'center' }]}>
                {referral.joined === 1 ? 'One friend joined through you ♥' : `${referral.joined} friends joined through you ♥`}
              </Text>
            )}
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
  nickBlock: { paddingTop: sp.md },
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
  testRow: { alignItems: 'flex-start' },
  referralChip: {
    borderWidth: 1,
    borderColor: colors.hairline,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    paddingVertical: sp.md,
    paddingHorizontal: sp.base,
    alignItems: 'center',
    gap: sp.xs,
  },
  referralLink: {
    ...text.caption,
    color: colors.ink,
    fontWeight: '600',
  },
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
