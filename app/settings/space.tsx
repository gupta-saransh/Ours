import React, { useState } from 'react';
import { Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import { ChevronRight, Heart, KeyRound, Users } from 'lucide-react-native';
import { useAuth } from '@/lib/auth';
import { Card, FormError, ListRow, Screen, SecondaryButton, SubScreenHeader, TextField } from '@/components/kit';
import { Avatar } from '@/components/Avatar';
import { colors, sp, text } from '@/theme';

/** "Your space": your partner, the invite code, the plan, and their nickname. */
export default function SpaceSettings() {
  const { status, couple, partner, updateProfile, refresh } = useAuth();
  const router = useRouter();
  const [nick, setNick] = useState(partner?.nickname ?? '');
  const [savingNick, setSavingNick] = useState(false);
  const [nickSaved, setNickSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (status === 'loading') return null;
  if (status !== 'signedIn') return <Redirect href="/welcome" />;

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

  return (
    <Screen>
      <SubScreenHeader title="Your space" onBack={() => router.back()} />
      <ScrollView contentContainerStyle={styles.body}>
        <FormError message={error} />
        <Card>
          <ListRow
            leading={
              partner ? (
                <Avatar id={partner.avatar} name={partner.display_name} size={22} />
              ) : (
                <Users size={18} color={colors.inkMuted} strokeWidth={1.75} />
              )
            }
            title={partner ? partner.display_name : 'Just you so far'}
            caption={partner ? 'Your person' : 'Link with your partner to share everything'}
            trailing={partner ? undefined : <ChevronRight size={18} color={colors.inkFaint} strokeWidth={1.75} />}
            onPress={partner ? undefined : () => router.push('/pair')}
          />
          <ListRow
            leading={<KeyRound size={18} color={colors.inkMuted} strokeWidth={1.75} />}
            title="Invite code"
            caption="Share it so your person can join this space"
            trailing={<Text style={styles.code}>{couple?.invite_code ?? '...'}</Text>}
          />
          <ListRow
            leading={<Heart size={18} color={colors.inkMuted} strokeWidth={1.75} />}
            title="Plan"
            caption="Everything is included, always"
            trailing={<Text style={[text.caption, { color: colors.positive }]}>Free</Text>}
            last={!partner}
          />
          {partner && (
            <View style={styles.nickBlock}>
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
              <Text style={text.caption}>Shows across the app in place of their name. Only you see it.</Text>
            </View>
          )}
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
  nickBlock: { paddingTop: sp.md },
  code: {
    ...text.body,
    color: colors.surfaceSealed,
    fontWeight: '600',
    letterSpacing: 3,
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
  },
});
