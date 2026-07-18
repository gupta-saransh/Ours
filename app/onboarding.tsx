import React, { useCallback, useEffect, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { ChevronLeft } from 'lucide-react-native';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useCoupleEvent } from '@/lib/realtime';
import { successHaptic, tapHaptic } from '@/lib/haptics';
import { enableWebPush, webPushNeedsInstall, webPushSupported } from '@/lib/push-web';
import { isStandalone, shouldOfferInstall } from '@/lib/install';
import { AddToHomeScreen } from '@/components/AddToHomeScreen';
import { logEvent } from '@/lib/log';
import { markPushAskDeclined } from '@/lib/pushAsk';
import { nextStep, stepPosition, stepsFor, type OnboardingStep } from '@/lib/onboardingSteps';
import { AppPressable, FormError, PrimaryButton, Screen, TextField } from '@/components/kit';
import { colors, font, radius, sp, text } from '@/theme';

/**
 * The guided first run, shown once to a brand new signup and never to an
 * existing account (gated by users.needs_onboarding, v17).
 *
 * One route holding a step machine rather than five routes: the progress bar,
 * the back button and the skip rules all live in one place, and answering a
 * step can change which later steps apply (pairing unlocks the nickname step).
 * Which steps apply at all is decided by the pure rules in
 * `src/lib/onboardingSteps.ts`, which are unit-tested.
 *
 * NOTHING here is a gate. Every step can be skipped and leaves the field as
 * empty as it would have been, matching how pairing has always been optional.
 * Skipped ground is still reachable later from Settings and the Milestones
 * screen.
 */

interface Milestone {
  id: string;
  kind: string;
  person_id?: string | null;
  author_id: string;
}

export default function Onboarding() {
  const { status, user, couple, partner, needsOnboarding, joinSpace, updateProfile, refresh } = useAuth();
  const router = useRouter();

  const [steps, setSteps] = useState<OnboardingStep[] | null>(null);
  const [current, setCurrent] = useState<OnboardingStep | null>(null);
  const [history, setHistory] = useState<OnboardingStep[]>([]);
  const [finishing, setFinishing] = useState(false);
  // Does the server already hold a subscription for this account? Only changes
  // the notifications step's wording, never whether it is shown.
  const [alreadySubscribed, setAlreadySubscribed] = useState(false);

  const paired = !!partner;

  /** Work out what this person still needs, from what they already have. */
  const plan = useCallback(async (): Promise<OnboardingStep[]> => {
    const [milestones, pushed] = await Promise.all([
      api<{ milestones: Milestone[] }>('/api/milestones')
        .then((d) => d.milestones)
        .catch(() => [] as Milestone[]),
      Platform.OS === 'web'
        ? api<{ hasSubscription: boolean }>('/api/push/subscribe')
            .then((s) => s.hasSubscription)
            .catch(() => false)
        : Promise.resolve(true),
    ]);
    setAlreadySubscribed(pushed);
    return stepsFor({
      paired,
      hasAnniversary: milestones.some((m) => m.kind === 'anniversary'),
      // person_id is v17; author_id is the honest fallback for older rows,
      // since before onboarding a birthday was always added by its owner.
      hasOwnBirthday: milestones.some(
        (m) => m.kind === 'birthday' && (m.person_id ?? m.author_id) === user?.id
      ),
      hasNickname: !!partner?.nickname,
      canNotify: Platform.OS === 'web' && (webPushSupported() || webPushNeedsInstall()),
      offerInstall: shouldOfferInstall(),
      needsInstallFirst: webPushNeedsInstall(),
    });
  }, [paired, partner?.nickname, user?.id]);

  // The space is created during signup, but only /auth/me carries it. If we
  // arrived without it, pull it in so the first step can show the invite code.
  useEffect(() => {
    if (status === 'signedIn' && !couple) refresh().catch(() => {});
  }, [status, couple, refresh]);

  useEffect(() => {
    if (status !== 'signedIn') return;
    let cancelled = false;
    plan().then((next) => {
      if (cancelled) return;
      setSteps(next);
      setCurrent(next[0] ?? null);
      logEvent('onboarding.started', { steps: next.length });
    });
    return () => {
      cancelled = true;
    };
    // Deliberately once per mount: re-planning mid-flow would yank the screen
    // out from under someone. `advance` re-plans at each step boundary instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  // Their person joined while this screen is open (they shared the code and it
  // was accepted). Move on rather than leaving them staring at the code.
  useCoupleEvent('partner.joined', () => {
    if (current === 'partner') advance();
  });

  const finish = useCallback(async () => {
    setFinishing(true);
    logEvent('onboarding.finished');
    // Mark done first, so a failure to refresh cannot loop them back in here.
    await updateProfile({ onboarded: true }).catch(() => {});
    await refresh().catch(() => {});
    router.replace('/');
  }, [updateProfile, refresh, router]);

  /** Move to the next applicable step, re-planning as we go. */
  const advance = useCallback(async () => {
    const from = current;
    const fresh = await plan().catch(() => steps ?? []);
    setSteps(fresh);
    const next = from ? nextStep(fresh, from) : (fresh[0] ?? null);
    if (!next) {
      await finish();
      return;
    }
    if (from) setHistory((h) => [...h, from]);
    setCurrent(next);
  }, [current, plan, steps, finish]);

  const back = () => {
    tapHaptic();
    setHistory((h) => {
      const prev = h[h.length - 1];
      if (prev) setCurrent(prev);
      return h.slice(0, -1);
    });
  };

  const skip = () => {
    logEvent('onboarding.skipped', { step: current ?? 'unknown' });
    if (current === 'notifications') markPushAskDeclined(false, isStandalone());
    advance();
  };

  if (status === 'loading') return null;
  if (status === 'signedOut') return <Redirect href="/welcome" />;
  // Someone who has already been through this (or an existing account) must
  // never be held here.
  if (!needsOnboarding) return <Redirect href="/" />;
  // Planning which steps apply takes a request or two; hold the ground quietly
  // rather than flashing a half-built first screen.
  if (!steps || !current) return <Screen><View /></Screen>;

  const total = steps.length;
  const position = stepPosition(steps, current);

  return (
    <Screen keyboard>
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <View style={styles.chrome}>
          {history.length > 0 ? (
            <Pressable onPress={back} hitSlop={10} style={styles.backBtn}>
              <ChevronLeft size={22} color={colors.inkMuted} strokeWidth={1.75} />
            </Pressable>
          ) : (
            <View style={styles.backBtn} />
          )}
          <View style={styles.progress}>
            {steps.map((s, i) => (
              <View key={s} style={[styles.progressDot, i < position && styles.progressDotDone]} />
            ))}
          </View>
          <Pressable onPress={skip} hitSlop={10} style={styles.skipBtn}>
            <Text style={styles.skipText}>Skip</Text>
          </Pressable>
        </View>

        {current === 'partner' && (
          <PartnerStep
            code={couple?.invite_code ?? null}
            onJoin={joinSpace}
            onDone={advance}
            firstName={user?.display_name?.split(' ')[0] ?? null}
          />
        )}
        {current === 'anniversary' && <AnniversaryStep onDone={advance} />}
        {current === 'birthday' && <BirthdayStep name={user?.display_name ?? 'me'} userId={user?.id ?? ''} onDone={advance} />}
        {current === 'nickname' && (
          <NicknameStep
            partnerName={partner?.realName ?? partner?.display_name ?? 'them'}
            onSave={async (nickname) => {
              await updateProfile({ partnerNickname: nickname });
              await refresh().catch(() => {});
            }}
            onDone={advance}
          />
        )}
        {current === 'install' && <AddToHomeScreen onDone={advance} onSkip={skip} />}
        {current === 'notifications' && (
          <NotificationsStep
            partnerName={partner?.display_name ?? null}
            alreadyOn={alreadySubscribed}
            onDone={advance}
          />
        )}

        {finishing ? <Text style={styles.finishing}>Taking you in ✦</Text> : null}
      </ScrollView>
    </Screen>
  );
}

/** Shared step frame: a serif question, a warm line, then the step's own body. */
function StepFrame({ title, line, children }: { title: string; line: string; children: React.ReactNode }) {
  return (
    <View style={styles.step}>
      <Text style={styles.stepTitle}>{title}</Text>
      <Text style={styles.stepLine}>{line}</Text>
      {children}
    </View>
  );
}

function PartnerStep({
  code,
  onJoin,
  onDone,
  firstName,
}: {
  code: string | null;
  onJoin: (code: string) => Promise<void>;
  onDone: () => void;
  firstName: string | null;
}) {
  const [theirCode, setTheirCode] = useState('');
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const copy = async () => {
    if (!code) return;
    await Clipboard.setStringAsync(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const join = async () => {
    setBusy(true);
    setError(null);
    try {
      await onJoin(theirCode.trim().toUpperCase());
      successHaptic();
      onDone();
    } catch (err: any) {
      setError(err?.message ?? 'That code did not work');
    } finally {
      setBusy(false);
    }
  };

  return (
    <StepFrame
      title={firstName ? `Welcome, ${firstName}` : 'Welcome'}
      line="Ours is built for two. Share your code with your person, or put theirs in if they got here first."
    >
      <View style={styles.codeBlock}>
        <Text style={styles.codeLabel}>Your code</Text>
        <AppPressable onPress={copy} style={styles.codeChip}>
          <Text style={styles.code}>{code ?? '······'}</Text>
          <Text style={text.caption}>{copied ? 'Copied ✓' : 'Tap to copy'}</Text>
        </AppPressable>
      </View>

      <Text style={styles.or}>or</Text>

      <TextField
        label="Their code"
        value={theirCode}
        onChangeText={(t) => setTheirCode(t.toUpperCase())}
        placeholder="ABC123"
        autoCapitalize="characters"
      />
      <FormError message={error} />
      <PrimaryButton
        title="Join their space"
        onPress={join}
        loading={busy}
        disabled={theirCode.trim().length < 6}
      />
      <Text style={styles.helper}>
        You can do this any time. Everything you add on your own comes with you when you pair.
      </Text>
    </StepFrame>
  );
}

/** Milestone date fields are validated YYYY-MM-DD text, no native picker. */
function DateStep({
  title,
  line,
  label,
  cta,
  onSubmit,
  helper,
}: {
  title: string;
  line: string;
  label: string;
  cta: string;
  onSubmit: (date: string) => Promise<void>;
  helper?: string;
}) {
  const [date, setDate] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const valid = /^\d{4}-\d{2}-\d{2}$/.test(date.trim()) && !Number.isNaN(Date.parse(date.trim()));

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await onSubmit(date.trim());
      successHaptic();
    } catch (err: any) {
      setError(err?.message ?? 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  return (
    <StepFrame title={title} line={line}>
      <TextField
        label={label}
        value={date}
        onChangeText={setDate}
        placeholder="YYYY-MM-DD"
        autoCapitalize="none"
        keyboardType="numbers-and-punctuation"
      />
      <FormError message={error} />
      <PrimaryButton title={cta} onPress={submit} loading={busy} disabled={!valid} />
      {helper ? <Text style={styles.helper}>{helper}</Text> : null}
    </StepFrame>
  );
}

function AnniversaryStep({ onDone }: { onDone: () => void }) {
  return (
    <DateStep
      title="The day it began"
      line="Put in the day you two started. Ours will count every day since, right on your home screen."
      label="Your anniversary"
      cta="Start counting"
      helper="Not sure of the exact day? Pick the one you both call it."
      onSubmit={async (date) => {
        await api('/api/milestones', {
          method: 'POST',
          body: { title: 'Anniversary', date, kind: 'anniversary' },
        });
        onDone();
      }}
    />
  );
}

function BirthdayStep({ name, userId, onDone }: { name: string; userId: string; onDone: () => void }) {
  const first = name.split(' ')[0] || name;
  return (
    <DateStep
      title="Your birthday"
      line="So they never have to keep it in their head alone. Ours counts it down for you both."
      label="Your birthday"
      cta="Add it"
      helper="Your partner adds theirs when they set up their own side."
      onSubmit={async (date) => {
        await api('/api/milestones', {
          method: 'POST',
          // person_id is what makes this "whose"; the title stays readable on
          // its own for older clients and the milestone list.
          body: { title: `${first}'s birthday`, date, kind: 'birthday', personId: userId },
        });
        onDone();
      }}
    />
  );
}

function NicknameStep({
  partnerName,
  onSave,
  onDone,
}: {
  partnerName: string;
  onSave: (nickname: string) => Promise<void>;
  onDone: () => void;
}) {
  const [nickname, setNickname] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await onSave(nickname.trim());
      successHaptic();
      onDone();
    } catch (err: any) {
      setError(err?.message ?? 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  return (
    <StepFrame
      title={`What do you call ${partnerName}?`}
      line="The name you actually use. Ours will use it everywhere instead of their real one. It is only yours, and they set their own name for you."
    >
      <TextField label="Your name for them" value={nickname} onChangeText={setNickname} placeholder="Love" />
      <FormError message={error} />
      <PrimaryButton title="That is them" onPress={submit} loading={busy} disabled={!nickname.trim()} />
    </StepFrame>
  );
}

/**
 * The notification ask, inline as a step. Same job as the standalone invite
 * card: warm words first, so the browser's own prompt (which you only get one
 * shot at) fires only for people who already said yes here.
 */
function NotificationsStep({
  partnerName,
  alreadyOn,
  onDone,
}: {
  partnerName: string | null;
  alreadyOn: boolean;
  onDone: () => void;
}) {
  const { user, updateProfile } = useAuth();
  const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState<string | null>(null);

  // This device already granted permission, so the account is subscribed
  // without anyone tapping anything. Confirm it rather than asking again.
  if (alreadyOn) {
    return (
      <StepFrame
        title="Notifications are on"
        line={
          partnerName
            ? `We will let you know when ${partnerName} leaves a note, saves a memory, or is just thinking of you. You can change this any time in Settings.`
            : 'We will let you know when your person joins and starts leaving things for you. You can change this any time in Settings.'
        }
      >
        <PrimaryButton title="Lovely" onPress={onDone} />
      </StepFrame>
    );
  }

  // An uninstalled iPhone never reaches this step: the install step comes
  // first and this ask returns once they reopen Ours from the home screen.

  const turnOn = async () => {
    setBusy(true);
    setBlocked(null);
    try {
      if (!user?.notifications_enabled) await updateProfile({ notificationsEnabled: true });
      await enableWebPush();
      markPushAskDeclined(true, isStandalone());
      successHaptic();
      logEvent('onboarding.notifications_granted');
      onDone();
    } catch (err: any) {
      // The browser prompt was dismissed or is blocked. Only browser settings
      // can undo that, so stop the resurfacing schedule too.
      setBlocked(err?.message ?? 'Your browser would not allow it.');
      markPushAskDeclined(true, isStandalone());
      logEvent('onboarding.notifications_denied');
    } finally {
      setBusy(false);
    }
  };

  return (
    <StepFrame
      title={partnerName ? `Hear from ${partnerName}` : 'Stay close'}
      line={
        partnerName
          ? `Let us tap you on the shoulder when ${partnerName} leaves a note, saves a memory, or is just thinking of you. Only the two of you, never anything else.`
          : 'A nudge, a new note, a question waiting for you. Only the two of you, never anything else.'
      }
    >
      {blocked ? (
        <>
          <Text style={styles.blocked}>{blocked}</Text>
          <PrimaryButton title="Carry on" onPress={onDone} />
        </>
      ) : (
        <PrimaryButton title="Yes, keep me close" onPress={turnOn} loading={busy} />
      )}
    </StepFrame>
  );
}

const styles = StyleSheet.create({
  body: {
    padding: sp.xl,
    paddingTop: sp.lg,
    paddingBottom: sp.huge,
    width: '100%',
    maxWidth: 460,
    alignSelf: 'center',
    flexGrow: 1,
  },
  chrome: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: sp.xxl,
  },
  backBtn: { width: 44, height: 32, justifyContent: 'center' },
  skipBtn: { minWidth: 44, height: 32, alignItems: 'flex-end', justifyContent: 'center' },
  // Gold and underlined, like every other quiet link in the app. It was
  // inkFaint before, which read as disabled text rather than something to tap.
  skipText: {
    ...text.caption,
    color: colors.accent,
    textDecorationLine: 'underline',
    fontWeight: '600',
  },
  progress: { flexDirection: 'row', gap: sp.xs, alignItems: 'center' },
  progressDot: {
    width: 20,
    height: 3,
    borderRadius: 2,
    backgroundColor: colors.hairline,
  },
  progressDotDone: { backgroundColor: colors.accent },
  step: { flex: 1 },
  stepTitle: {
    ...text.display,
    fontFamily: font.displayMedium,
    marginBottom: sp.sm,
  },
  stepLine: {
    ...text.bodySerif,
    color: colors.inkMuted,
    marginBottom: sp.xxl,
  },
  codeBlock: { marginBottom: sp.base },
  codeLabel: { ...text.micro, marginBottom: sp.sm },
  codeChip: {
    borderWidth: 1,
    borderColor: colors.hairline,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceRaised,
    paddingVertical: sp.lg,
    alignItems: 'center',
    gap: sp.xs,
  },
  code: {
    ...text.display,
    fontFamily: font.displayMedium,
    letterSpacing: 6,
    color: colors.surfaceSealed,
  },
  or: {
    ...text.caption,
    color: colors.inkFaint,
    textAlign: 'center',
    marginVertical: sp.base,
  },
  helper: {
    ...text.caption,
    color: colors.inkFaint,
    textAlign: 'center',
    marginTop: sp.base,
  },
  blocked: {
    ...text.caption,
    color: colors.danger,
    marginBottom: sp.base,
  },
  finishing: {
    ...text.caption,
    color: colors.inkFaint,
    textAlign: 'center',
    marginTop: sp.xl,
  },
});
