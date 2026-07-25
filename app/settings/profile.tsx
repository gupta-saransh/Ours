import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import { Mail } from 'lucide-react-native';
import { useAuth } from '@/lib/auth';
import {
  AppPressable,
  Card,
  FormError,
  ListRow,
  Screen,
  SecondaryButton,
  SubScreenHeader,
  TextField,
} from '@/components/kit';
import { Avatar, AVATARS } from '@/components/Avatar';
import { colors, radius, sp, text } from '@/theme';

/** "About you": your name, your mark (avatar), and your email (read-only). */
export default function ProfileSettings() {
  const { status, user, partner, updateProfile } = useAuth();
  const router = useRouter();
  const [name, setName] = useState(user?.display_name ?? '');
  const [savingName, setSavingName] = useState(false);
  const [nameSaved, setNameSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (status === 'loading') return null;
  if (status !== 'signedIn') return <Redirect href="/welcome" />;

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

  const chooseMark = async (id: string) => {
    if (id === user?.avatar) return;
    setError(null);
    try {
      await updateProfile({ avatar: id });
    } catch (err: any) {
      setError(err?.message ?? 'Something went wrong');
    }
  };

  return (
    <Screen>
      <SubScreenHeader title="About you" onBack={() => router.back()} />
      <ScrollView contentContainerStyle={styles.body}>
        <FormError message={error} />
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
          <ListRow
            leading={<Mail size={18} color={colors.inkMuted} strokeWidth={1.75} />}
            title="Email"
            caption={user?.email}
            last
          />
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
  saveButton: { height: 40, paddingHorizontal: sp.base, marginTop: sp.sm },
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
});
