import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useCoupleEvent } from '@/lib/realtime';
import { useToast } from '@/lib/toast';
import { successHaptic } from '@/lib/haptics';
import { logEvent } from '@/lib/log';
import { enableWebPush, webPushNeedsInstall, webPushSupported } from '@/lib/push-web';
import { isStandalone } from '@/lib/install';
import { askIsDue, readPushAsk, writePushAsk, type AskRecord } from '@/lib/pushAsk';
import { PrimaryButton } from '@/components/kit';
import { colors, font, radius, sp, text } from '@/theme';

/**
 * The notification invitation.
 *
 * A browser gives you exactly ONE chance at its permission prompt: if someone
 * dismisses it, the answer is remembered and can only be undone in browser
 * settings, which nobody does. So we never fire it cold. This warm card asks
 * first, in our own words, and only the people who say yes ever see the real
 * prompt. (Standard "permission priming"; it is also why the Settings toggle
 * stays the only other path.)
 *
 * When to appear: signed in, on web, and the server holds no push subscription
 * for this account. The moment a partner joins is the most persuasive one there
 * is, so that gets its own copy and jumps the queue.
 *
 * How often: not every open. Dismissals are remembered and spaced out (today,
 * then 3 days, then 10), and after three asks we stop for good. Nagging is what
 * turns a "maybe later" into a permanent browser-level block, which would cost
 * us the user forever.
 */

/** Let the screen paint before asking for anything. */
const SHOW_DELAY_MS = 2000;

type Variant = 'paired' | 'solo' | 'install';

export function NotificationsInvite() {
  const { status, user, partner, updateProfile, refresh } = useAuth();
  const toast = useToast();
  const [variant, setVariant] = useState<Variant | null>(null);
  const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState<string | null>(null);
  // One evaluation per app load, so a re-render can never re-open the card.
  const evaluated = useRef(false);

  const partnerName = partner?.display_name ?? 'your person';

  /** Has the server got a live subscription for this account? */
  const isSubscribed = useCallback(async (): Promise<boolean> => {
    try {
      const s = await api<{ hasSubscription: boolean }>('/api/push/subscribe');
      return s.hasSubscription;
    } catch {
      // Offline or the endpoint is unhappy: do not ask on a guess.
      return true;
    }
  }, []);

  const open = useCallback(
    (v: Variant, record: AskRecord) => {
      setVariant(v);
      writePushAsk({
        ...record,
        n: record.n + 1,
        at: new Date().toISOString(),
        // Remember whether this ask happened from the installed app, so an
        // install later can still earn a fresh one.
        askedStandalone: isStandalone(),
      });
      logEvent('push.invite_shown', { variant: v, ask_number: record.n + 1, standalone: isStandalone() });
    },
    []
  );

  // The scheduled ask, once per app load.
  useEffect(() => {
    if (status !== 'signedIn' || evaluated.current) return;
    if (Platform.OS !== 'web') return; // native push is not provisioned
    evaluated.current = true;

    const timer = setTimeout(async () => {
      const record = readPushAsk();
      if (record.done) return;
      // Already blocked at the browser level: asking again cannot help, and
      // Settings explains how to undo it.
      if (typeof Notification !== 'undefined' && Notification.permission === 'denied') return;

      const needsInstall = webPushNeedsInstall();
      if (!needsInstall && !webPushSupported()) return; // this browser simply cannot

      if (await isSubscribed()) return;
      // Spacing and the three-ask cap live in pushAsk.ts, shared with the
      // onboarding step so a skip there counts toward the same schedule.
      // Being installed overrides the cooldown once (see askIsDue).
      if (!askIsDue(record, isStandalone())) return;

      open(needsInstall ? 'install' : partner ? 'paired' : 'solo', record);
    }, SHOW_DELAY_MS);

    return () => clearTimeout(timer);
  }, [status, partner, isSubscribed, open]);

  // Someone just joined the space. That is the moment this matters most, so it
  // gets one ask of its own regardless of the schedule.
  useCoupleEvent('partner.joined', () => {
    if (Platform.OS !== 'web') return;
    setTimeout(async () => {
      const record = readPushAsk();
      if (record.done || record.pairedAsked) return;
      if (typeof Notification !== 'undefined' && Notification.permission === 'denied') return;
      if (!webPushNeedsInstall() && !webPushSupported()) return;
      if (await isSubscribed()) return;
      writePushAsk({ ...record, pairedAsked: true });
      open(webPushNeedsInstall() ? 'install' : 'paired', { ...record, pairedAsked: true });
    }, 1200);
  });

  const close = () => {
    setVariant(null);
    setBlocked(null);
  };

  const turnOn = async () => {
    setBusy(true);
    setBlocked(null);
    try {
      // Make sure the account wants them, then raise the real browser prompt.
      if (!user?.notifications_enabled) await updateProfile({ notificationsEnabled: true });
      await enableWebPush();
      await refresh().catch(() => {});
      writePushAsk({ ...readPushAsk(), done: true });
      successHaptic();
      logEvent('push.invite_accepted');
      close();
      toast.show('Lovely. We will keep you close ♥');
    } catch (err: any) {
      // Usually the browser prompt was dismissed or blocked. Say so plainly and
      // stop asking, since only browser settings can undo it now.
      const message = err?.message ?? 'Your browser would not allow it.';
      setBlocked(message);
      writePushAsk({ ...readPushAsk(), done: true });
      logEvent('push.invite_declined', { message: String(message).slice(0, 120) });
    } finally {
      setBusy(false);
    }
  };

  const later = () => {
    logEvent('push.invite_later', { variant: variant ?? 'unknown' });
    close();
  };

  if (!variant) return null;

  const copy =
    variant === 'install'
      ? {
          title: 'Add Ours to your home screen',
          body: `iPhone only lets apps on your home screen send notifications. Tap the share button, choose Add to Home Screen, then open Ours from there and we will ask again.`,
          cta: null,
        }
      : variant === 'paired'
        ? {
            title: `Hear from ${partnerName}`,
            body: `Let us tap you on the shoulder when ${partnerName} leaves a note, saves a memory, or is just thinking of you. Only the two of you, never anything else.`,
            cta: 'Yes, keep me close',
          }
        : {
            title: 'Never miss a little thing',
            body: 'Turn on notifications so a nudge, a new note, or a question waiting for you finds you, even when Ours is closed. Only the two of you, never anything else.',
            cta: 'Turn them on',
          };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={later}>
      <Pressable style={styles.backdrop} onPress={later}>
        {/* Stop taps inside the card from closing it. */}
        <Pressable style={styles.card} onPress={(e) => e.stopPropagation()}>
          <View style={styles.seal}>
            <Text style={styles.sealHeart}>♥</Text>
          </View>
          <Text style={styles.flourish}>✦</Text>
          <Text style={styles.title}>{copy.title}</Text>
          <Text style={styles.body}>{copy.body}</Text>

          {blocked ? (
            <>
              <Text style={styles.blocked}>{blocked}</Text>
              <PrimaryButton title="Close" onPress={close} />
            </>
          ) : copy.cta ? (
            <>
              <PrimaryButton title={copy.cta} onPress={turnOn} loading={busy} />
              <Pressable onPress={later} hitSlop={8} style={styles.later}>
                <Text style={styles.laterText}>Maybe later</Text>
              </Pressable>
            </>
          ) : (
            <PrimaryButton title="Got it" onPress={later} />
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    // Warm ink wash rather than flat black, to match the parchment ground.
    backgroundColor: 'rgba(28, 18, 12, 0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: sp.xl,
  },
  card: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.hairline,
    paddingHorizontal: sp.xl,
    paddingTop: sp.xxl,
    paddingBottom: sp.xl,
    alignItems: 'center',
  },
  seal: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.surfaceSealed,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: sp.md,
  },
  sealHeart: {
    color: colors.onSealed,
    fontSize: 24,
    lineHeight: 28,
  },
  flourish: {
    color: colors.accent,
    fontSize: 12,
    marginBottom: sp.sm,
  },
  title: {
    ...text.title,
    fontFamily: font.displayMedium,
    textAlign: 'center',
    marginBottom: sp.sm,
  },
  body: {
    ...text.bodySerif,
    color: colors.inkMuted,
    textAlign: 'center',
    marginBottom: sp.xl,
  },
  blocked: {
    ...text.caption,
    color: colors.danger,
    textAlign: 'center',
    marginBottom: sp.base,
  },
  later: {
    marginTop: sp.md,
    paddingVertical: sp.xs,
  },
  laterText: {
    ...text.caption,
    color: colors.inkFaint,
  },
});
