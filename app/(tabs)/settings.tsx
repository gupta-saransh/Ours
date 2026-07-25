import React, { useState } from 'react';
import { Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import {
  Bell,
  ChevronRight,
  Lock,
  LockKeyhole,
  Palette,
  Share2,
  User,
  Users,
} from 'lucide-react-native';
import { useAuth } from '@/lib/auth';
import { successHaptic } from '@/lib/haptics';
import { Sheet } from '@/components/Sheet';
import { Card, FormError, ListRow, PrimaryButton, Screen, SecondaryButton, Section, TextField } from '@/components/kit';
import { colors, sp, text } from '@/theme';

/**
 * Settings, as a flat list of single-line rows, each opening its own page
 * (`app/settings/*`) or (for the two lightweight account actions) a Sheet.
 * Chosen over the previous card-with-inline-controls layout after user
 * feedback that the page read as cluttered; every setting is now one tap away
 * from a focused screen rather than sharing a scroll with six others at once.
 */
export default function Settings() {
  const { user, partner, signOut, deleteAccount, changePassword } = useAuth();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showPwSheet, setShowPwSheet] = useState(false);
  const [curPw, setCurPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [pwBusy, setPwBusy] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwSaved, setPwSaved] = useState(false);

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

  const openPwSheet = () => {
    setCurPw('');
    setNewPw('');
    setConfirmPw('');
    setPwError(null);
    setPwSaved(false);
    setShowPwSheet(true);
  };

  const submitPassword = async () => {
    setPwError(null);
    if (newPw.length < 8) {
      setPwError('New password needs at least 8 characters');
      return;
    }
    if (newPw !== confirmPw) {
      setPwError('Those passwords do not match');
      return;
    }
    setPwBusy(true);
    try {
      await changePassword(curPw, newPw);
      successHaptic();
      setPwSaved(true);
      setTimeout(() => setShowPwSheet(false), 1200);
    } catch (err: any) {
      setPwError(err?.message ?? 'Something went wrong');
    } finally {
      setPwBusy(false);
    }
  };

  const chevron = <ChevronRight size={18} color={colors.inkFaint} strokeWidth={1.75} />;

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.body}>
        <FormError message={error} />

        <Section label="You">
          <Card>
            <ListRow
              leading={<User size={18} color={colors.inkMuted} strokeWidth={1.75} />}
              title="About you"
              caption={user?.display_name}
              trailing={chevron}
              onPress={() => router.push('/settings/profile')}
            />
            <ListRow
              leading={<Users size={18} color={colors.inkMuted} strokeWidth={1.75} />}
              title="Your space"
              caption={partner ? `Paired with ${partner.display_name}` : 'Just you so far, invite code and plan'}
              trailing={chevron}
              onPress={() => router.push('/settings/space')}
              last
            />
          </Card>
        </Section>

        <Section label="Preferences">
          <Card>
            <ListRow
              leading={<Bell size={18} color={colors.inkMuted} strokeWidth={1.75} />}
              title="Notifications"
              caption="Nudges, new notes, and delivery checks"
              trailing={chevron}
              onPress={() => router.push('/settings/notifications')}
            />
            {Platform.OS === 'web' && (
              <ListRow
                leading={<Palette size={18} color={colors.inkMuted} strokeWidth={1.75} />}
                title="Appearance"
                caption="Your space's shared look"
                trailing={chevron}
                onPress={() => router.push('/settings/appearance')}
              />
            )}
            <ListRow
              leading={<Lock size={18} color={colors.inkMuted} strokeWidth={1.75} />}
              title="Privacy"
              caption="Encryption at rest and your seal code"
              trailing={chevron}
              onPress={() => router.push('/settings/privacy')}
              last
            />
          </Card>
        </Section>

        <Section label="Share Ours">
          <Card>
            <ListRow
              leading={<Share2 size={18} color={colors.inkMuted} strokeWidth={1.75} />}
              title="Share Ours"
              caption="Send a friend your invite link"
              trailing={chevron}
              onPress={() => router.push('/settings/share')}
              last
            />
          </Card>
        </Section>

        <Section label="Account">
          <Card style={{ marginBottom: sp.md }}>
            <ListRow
              leading={<LockKeyhole size={18} color={colors.inkMuted} strokeWidth={1.75} />}
              title="Change password"
              caption="Update the password you sign in with"
              trailing={chevron}
              onPress={openPwSheet}
              last
            />
          </Card>
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

      <Sheet visible={showPwSheet} onClose={() => setShowPwSheet(false)} title="Change password">
        {pwSaved ? (
          <Text style={[text.bodySerif, { color: colors.positive }]}>Your password is updated ♥</Text>
        ) : (
          <View>
            <TextField
              label="Current password"
              value={curPw}
              onChangeText={setCurPw}
              placeholder="Your current password"
              secureTextEntry
              autoComplete="current-password"
            />
            <TextField
              label="New password"
              value={newPw}
              onChangeText={setNewPw}
              placeholder="At least 8 characters"
              secureTextEntry
              autoComplete="new-password"
            />
            <TextField
              label="Confirm new password"
              value={confirmPw}
              onChangeText={setConfirmPw}
              placeholder="Type it again"
              secureTextEntry
              autoComplete="new-password"
            />
            <FormError message={pwError} />
            <PrimaryButton title="Update password" onPress={submitPassword} loading={pwBusy} />
          </View>
        )}
      </Sheet>
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
  footer: {
    ...text.caption,
    textAlign: 'center',
    marginTop: sp.xxl,
    fontStyle: 'italic',
  },
});
