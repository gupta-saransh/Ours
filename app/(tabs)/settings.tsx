import React, { useState } from 'react';
import { Platform, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Lock } from 'lucide-react-native';
import { useAuth } from '@/lib/auth';
import { disableWebPush, enableWebPush } from '@/lib/push-web';
import {
  Card,
  FormError,
  PrimaryButton,
  Screen,
  SecondaryButton,
  Section,
  TextField,
} from '@/components/kit';
import { colors, sp, text } from '@/theme';

export default function Settings() {
  const { user, couple, partner, encryption, updateProfile, signOut, deleteAccount } = useAuth();
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
          </Card>
        </Section>

        <Section label="Your space">
          <Card>
            <View style={styles.row}>
              <Text style={text.body}>Partner</Text>
              <Text style={[text.body, { color: colors.inkMuted }]}>
                {partner ? partner.display_name : 'Just you so far'}
              </Text>
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

        <Section label="Privacy">
          <Card>
            <View style={styles.privacyHead}>
              <Lock size={16} color={colors.accent} strokeWidth={1.75} />
              <Text style={text.subtitle}>Encrypted at rest</Text>
            </View>
            <Text style={[text.body, { color: colors.inkMuted, marginTop: sp.sm }]}>
              {encryption
                ? 'Your memories, notes, prompts, and reflections are encrypted before they reach our database. If our systems were ever exposed, the contents would be unreadable without our keys. We’re working toward end to end encryption, where only you and your partner hold the keys.'
                : 'We’re turning on encryption at rest for your private moments. Once it’s live, your memories, notes, prompts, and reflections are encrypted before they reach our database, so their contents would be unreadable if our systems were ever exposed.'}
            </Text>
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

        <Text style={styles.footer}>Ours · made for exactly two people ♥</Text>
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
