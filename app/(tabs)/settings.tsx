import React, { useState } from 'react';
import { ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { useAuth } from '@/lib/auth';
import { Button, Card, FormError } from '@/components/ui';
import { colors, font, space, type } from '@/theme';

export default function Settings() {
  const { user, couple, partner, updateProfile, signOut, deleteAccount } = useAuth();
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
    <ScrollView style={styles.screen} contentContainerStyle={styles.body}>
      <FormError message={error} />

      <Text style={styles.section}>Profile</Text>
      <Card style={styles.card}>
        <Text style={styles.label}>Your name</Text>
        <View style={styles.nameRow}>
          <TextInput value={name} onChangeText={setName} style={styles.nameInput} placeholderTextColor={colors.inkSoft} />
          <Button
            title={nameSaved ? 'Saved ✓' : 'Save'}
            variant="secondary"
            onPress={saveName}
            loading={savingName}
            disabled={!name.trim() || name.trim() === user?.display_name}
            style={styles.saveButton}
          />
        </View>
        <Text style={[styles.label, { marginTop: space(4) }]}>Email</Text>
        <Text style={styles.value}>{user?.email}</Text>
      </Card>

      <Text style={styles.section}>Your space</Text>
      <Card style={styles.card}>
        <View style={styles.row}>
          <Text style={styles.value}>Partner</Text>
          <Text style={styles.rowRight}>{partner ? partner.display_name : 'Not joined yet'}</Text>
        </View>
        <View style={[styles.row, styles.rowBorder]}>
          <Text style={styles.value}>Invite code</Text>
          <Text style={[styles.rowRight, styles.code]}>{couple?.invite_code ?? '—'}</Text>
        </View>
        <View style={[styles.row, styles.rowBorder]}>
          <Text style={styles.value}>Plan</Text>
          <Text style={styles.rowRight}>Free · everything included</Text>
        </View>
      </Card>

      <Text style={styles.section}>Notifications</Text>
      <Card style={styles.card}>
        <View style={styles.row}>
          <View style={{ flex: 1, paddingRight: space(4) }}>
            <Text style={styles.value}>Nudges & new notes</Text>
            <Text style={styles.hint}>
              Live while the app is open. Push to a closed app arrives once store credentials are set up.
            </Text>
          </View>
          <Switch
            value={user?.notifications_enabled ?? true}
            onValueChange={toggleNotifications}
            trackColor={{ true: colors.blush, false: colors.hairline }}
            thumbColor={user?.notifications_enabled ? colors.rose : '#FFFFFF'}
          />
        </View>
      </Card>

      <Text style={styles.section}>Account</Text>
      <Button title="Log out" variant="secondary" onPress={signOut} />
      <View style={{ height: space(3) }} />
      {confirmingDelete ? (
        <Card style={[styles.card, { borderColor: colors.danger }]}>
          <Text style={styles.value}>Delete your account?</Text>
          <Text style={styles.hint}>
            This permanently removes your account and everything you added. It can’t be undone.
          </Text>
          <View style={{ height: space(4) }} />
          <Button title="Yes, delete everything" variant="danger" onPress={removeAccount} loading={deleting} />
          <Button title="Keep my account" variant="ghost" onPress={() => setConfirmingDelete(false)} style={{ marginTop: space(2) }} />
        </Card>
      ) : (
        <Button title="Delete account" variant="danger" onPress={() => setConfirmingDelete(true)} />
      )}

      <Text style={styles.footer}>Ours · made for exactly two people ♥</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.cream },
  body: {
    padding: space(5),
    paddingBottom: space(16),
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
  },
  section: {
    fontFamily: font.displayMedium,
    fontSize: type.heading,
    color: colors.ink,
    marginBottom: space(3),
    marginTop: space(5),
  },
  card: { marginBottom: space(2) },
  label: { fontSize: type.small, color: colors.inkSoft, marginBottom: space(1.5) },
  value: { fontSize: type.body, color: colors.ink },
  hint: { fontSize: type.small, color: colors.inkSoft, marginTop: space(1), lineHeight: 19 },
  nameRow: { flexDirection: 'row', alignItems: 'center' },
  nameInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.hairline,
    borderRadius: 10,
    backgroundColor: colors.cream,
    paddingHorizontal: space(3),
    paddingVertical: space(2.5),
    fontSize: type.body,
    color: colors.ink,
  },
  saveButton: { marginLeft: space(3), minHeight: 44, paddingHorizontal: space(4) },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: space(2.5),
  },
  rowBorder: { borderTopWidth: 1, borderTopColor: colors.hairline },
  rowRight: { fontSize: type.body, color: colors.inkSoft },
  code: { letterSpacing: 3, fontWeight: '600', color: colors.rose },
  footer: {
    textAlign: 'center',
    color: colors.inkSoft,
    fontSize: type.small,
    marginTop: space(10),
    fontFamily: font.serifItalic,
  },
});
