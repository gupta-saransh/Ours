import React, { useEffect, useState } from 'react';
import { Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { Share2 } from 'lucide-react-native';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import { AppPressable, Card, Screen, SubScreenHeader } from '@/components/kit';
import { colors, radius, sp, text } from '@/theme';

/** Your personal invite link, and how many friends joined through it. */
export default function ShareSettings() {
  const { status } = useAuth();
  const router = useRouter();
  const [referral, setReferral] = useState<{ code: string | null; joined: number } | null>(null);
  const [referralCopied, setReferralCopied] = useState(false);

  useEffect(() => {
    api<{ code: string | null; joined: number }>('/api/referral')
      .then(setReferral)
      .catch(() => setReferral(null));
  }, []);

  if (status === 'loading') return null;
  if (status !== 'signedIn') return <Redirect href="/welcome" />;

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

  return (
    <Screen>
      <SubScreenHeader title="Share Ours" onBack={() => router.back()} />
      <ScrollView contentContainerStyle={styles.body}>
        <Card>
          <View style={styles.shareHead}>
            <Share2 size={16} color={colors.accent} strokeWidth={1.75} />
            <Text style={text.subtitle}>Pass it on</Text>
          </View>
          <Text style={[text.caption, { marginTop: sp.xs, marginBottom: sp.md }]}>
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
  shareHead: { flexDirection: 'row', alignItems: 'center', gap: sp.sm },
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
});
