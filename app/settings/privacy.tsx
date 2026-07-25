import React from 'react';
import { Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import { Lock } from 'lucide-react-native';
import { useAuth } from '@/lib/auth';
import { Card, Screen, SubScreenHeader } from '@/components/kit';
import { colors, sp, text } from '@/theme';

/** What "encrypted at rest" means here, and the seal code that proves it. */
export default function PrivacySettings() {
  const { status, encryption, encryptionCode } = useAuth();
  const router = useRouter();

  if (status === 'loading') return null;
  if (status !== 'signedIn') return <Redirect href="/welcome" />;

  return (
    <Screen>
      <SubScreenHeader title="Privacy" onBack={() => router.back()} />
      <ScrollView contentContainerStyle={styles.body}>
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
                  Made from your space's encryption key. Open Settings on your partner's phone and this code reads
                  the same there.
                </Text>
              </View>
              <Text style={styles.code}>{encryptionCode}</Text>
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
  privacyHead: { flexDirection: 'row', alignItems: 'center', gap: sp.sm },
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
});
