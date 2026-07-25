import React, { useEffect, useRef, useState } from 'react';
import { AppState, Platform, StyleSheet, Text, View } from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useChatPresence, useCoupleEvent, usePartnerPresence } from '@/lib/realtime';
import { useToast } from '@/lib/toast';
import { AppPressable, Empty, Screen, SecondaryButton, SubScreenHeader } from '@/components/kit';
import { Burst } from '@/components/HeartsRain';
import { colors, sp, text } from '@/theme';

/**
 * Both partners open this screen and hold the disc at the same time. There is
 * no timing window to hit: holding is a continuous state, so any moment where
 * both presence entries say "holding" simultaneously is a match, which is
 * generous to ordinary network jitter by construction. No "you missed it"
 * state exists because there is nothing to miss.
 *
 * Reused as-is: useChatPresence/usePartnerPresence (src/lib/realtime.tsx),
 * generically named from chat's push-suppression feature but not chat
 * specific; entering with `{screen: 'thumbkiss'}` here simply replaces
 * whatever presence data the chat screen may have left, since a person is
 * only ever on one screen at a time.
 *
 * The celebration renders <Burst/> LOCALLY rather than calling the global
 * showHearts()/showConfetti(): this screen is presented as a normal pushed
 * route, and CLAUDE.md's Sheet is built on React Native's own <Modal/>, which
 * paints in a layer above everything else in the JS tree, including the
 * <HeartsRain/> singleton mounted once in the tabs layout. Rendering Burst
 * here keeps it the same one sanctioned shower engine, just called from
 * wherever it will actually be visible.
 */

const noSelect =
  Platform.OS === 'web'
    ? ({ userSelect: 'none', WebkitUserSelect: 'none', WebkitTouchCallout: 'none' } as any)
    : null;

function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

export default function ThumbKissScreen() {
  const { status, user, partner } = useAuth();
  const router = useRouter();
  const toast = useToast();

  const [foregrounded, setForegrounded] = useState(true);
  useEffect(() => {
    if (Platform.OS === 'web') {
      const onVis = () => setForegrounded(document.visibilityState === 'visible');
      onVis();
      document.addEventListener('visibilitychange', onVis);
      return () => document.removeEventListener('visibilitychange', onVis);
    }
    const sub = AppState.addEventListener('change', (state) => setForegrounded(state === 'active'));
    return () => sub.remove();
  }, []);

  const updatePresence = useChatPresence(foregrounded, { screen: 'thumbkiss', holding: false });
  const partnerPresence = usePartnerPresence();
  const partnerHere = partnerPresence?.screen === 'thumbkiss';
  const partnerHolding = partnerHere && partnerPresence?.holding === true;

  const [holding, setHolding] = useState(false);
  const [burst, setBurst] = useState<{ n: number } | null>(null);
  const [matchInfo, setMatchInfo] = useState<{ count: number | null } | null>(null);
  const matchedRef = useRef(false);
  const [nudging, setNudging] = useState(false);

  // Deterministic tie-break so only ONE side reports a match, matching the
  // ordered-pair pattern agreementStatsFor already uses in game.ts.
  const isReporter = !!user && !!partner && user.id < partner.id;

  useEffect(() => {
    if (holding && partnerHolding) {
      if (matchedRef.current) return;
      matchedRef.current = true;
      setMatchInfo({ count: null });
      setBurst((b) => ({ n: (b?.n ?? 0) + 1 }));
      if (isReporter) {
        api<{ count: number }>('/api/thumb-kiss', { method: 'POST' })
          .then((data) => setMatchInfo((m) => (m ? { ...m, count: data.count } : m)))
          .catch(() => {});
      }
    } else {
      matchedRef.current = false;
    }
  }, [holding, partnerHolding, isReporter]);

  useCoupleEvent('thumbkiss.matched', (data: any) => {
    if (typeof data?.count !== 'number') return;
    setMatchInfo((m) => (m ? { ...m, count: data.count } : { count: data.count }));
  });

  if (status === 'loading') return null;
  if (status !== 'signedIn') return <Redirect href="/welcome" />;

  const partnerName = partner?.display_name ?? 'your person';

  const letThemKnow = async () => {
    if (nudging) return;
    setNudging(true);
    try {
      await api('/api/nudge', { method: 'POST' });
      toast.show('Let them know.');
    } catch {
      toast.show('Could not send. Try again.');
    } finally {
      setNudging(false);
    }
  };

  const press = (next: boolean) => {
    setHolding(next);
    updatePresence({ holding: next });
    if (next) setMatchInfo(null); // a fresh hold starts a fresh round
  };

  let statusLine: string;
  if (!partnerHere) {
    statusLine = holding ? `Keep holding. ${partnerName} is not here yet.` : `Waiting for ${partnerName} to join you here.`;
  } else if (matchInfo && !holding) {
    statusLine = 'You found each other ♥';
  } else if (holding && partnerHolding) {
    statusLine = 'Right on time.';
  } else if (holding) {
    statusLine = `Keep holding. Waiting on ${partnerName}.`;
  } else if (partnerHolding) {
    statusLine = `${partnerName} is holding. Go ahead.`;
  } else {
    statusLine = `${partnerName} is here. Hold whenever you're ready.`;
  }

  return (
    <Screen edges={['top', 'bottom']}>
      <SubScreenHeader title="Thumb Kiss" onBack={() => router.back()} />
      {burst && <Burst key={burst.n} variant="hearts" onDone={() => setBurst(null)} />}
      {!partner ? (
        <Empty line="Thumb Kiss is for two. Pair with your person first." />
      ) : (
        <View style={styles.body}>
          <Text style={styles.statusLine}>{statusLine}</Text>
          {matchInfo && !holding && (
            <Text style={styles.countLine}>
              {matchInfo.count != null ? `That's your ${ordinal(matchInfo.count)} thumb kiss.` : 'Counting…'}
            </Text>
          )}

          <AppPressable
            onPressIn={() => press(true)}
            onPressOut={() => press(false)}
            style={[styles.disc, holding && styles.discHeld, noSelect]}
          >
            <Text style={[styles.discGlyph, noSelect]}>♥</Text>
          </AppPressable>

          <Text style={styles.hint}>Hold the seal. See if you match.</Text>

          {!partnerHere && (
            <SecondaryButton title="Let them know" onPress={letThemKnow} loading={nudging} style={{ marginTop: sp.xl }} />
          )}
        </View>
      )}
    </Screen>
  );
}

const DISC_SIZE = 220;

const styles = StyleSheet.create({
  body: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: sp.xl,
    maxWidth: 480,
    alignSelf: 'center',
    width: '100%',
  },
  statusLine: {
    ...text.bodySerif,
    color: colors.ink,
    textAlign: 'center',
    marginBottom: sp.sm,
  },
  countLine: {
    ...text.caption,
    color: colors.inkMuted,
    textAlign: 'center',
    marginBottom: sp.xl,
  },
  disc: {
    width: DISC_SIZE,
    height: DISC_SIZE,
    borderRadius: DISC_SIZE / 2,
    backgroundColor: colors.surfaceSealed,
    borderWidth: 2,
    borderColor: 'rgba(249, 239, 220, 0.18)',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: sp.xl,
  },
  discHeld: {
    borderColor: colors.accent,
    borderWidth: 3,
  },
  discGlyph: {
    fontSize: 64,
    lineHeight: 64,
    color: colors.onSealed,
  },
  hint: {
    ...text.caption,
    color: colors.inkFaint,
    textAlign: 'center',
    marginTop: sp.xl,
  },
});
