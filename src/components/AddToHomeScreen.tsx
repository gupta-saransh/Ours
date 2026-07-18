import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { MoreVertical, Share } from 'lucide-react-native';
import { successHaptic } from '@/lib/haptics';
import { logEvent } from '@/lib/log';
import {
  canPromptInstall,
  installTarget,
  onInstallAvailable,
  promptInstall,
  type InstallTarget,
} from '@/lib/install';
import { PrimaryButton } from '@/components/kit';
import { colors, font, radius, sp, text } from '@/theme';

/**
 * "Put Ours on your home screen", drawn rather than described.
 *
 * A little phone with the button you need circled in gold and an arrow pointing
 * at it, because "tap the share button" is useless if you do not know where the
 * share button lives, and it lives somewhere different in every browser:
 *
 *   iOS Safari   bottom toolbar, in the middle
 *   iOS others   top right, and they must switch to Safari anyway (only Safari
 *                installs a home-screen app that can receive notifications)
 *   Android      top right, three dots, or one real tap if the browser offers
 *                us its install prompt
 *
 * Everything is drawn with views and lucide icons, no images, so it inherits
 * the palette and works on any screen size.
 */

export function AddToHomeScreen({ onDone, onSkip }: { onDone: () => void; onSkip?: () => void }) {
  const target = installTarget();
  const [promptable, setPromptable] = useState(canPromptInstall());
  const [installing, setInstalling] = useState(false);

  // The browser's offer can arrive after this screen is already up.
  useEffect(() => onInstallAvailable(setPromptable), []);

  const install = async () => {
    setInstalling(true);
    logEvent('install.prompted');
    const accepted = await promptInstall();
    setInstalling(false);
    if (accepted) {
      successHaptic();
      logEvent('install.accepted');
      onDone();
    }
  };

  const copy = COPY[target];

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>{copy.title}</Text>
      <Text style={styles.line}>{copy.line}</Text>

      <PhoneMock target={target} />

      <View style={styles.steps}>
        {copy.steps.map((step, i) => (
          <View key={i} style={styles.stepRow}>
            <Text style={styles.stepNum}>{i + 1}</Text>
            <Text style={styles.stepText}>{step}</Text>
          </View>
        ))}
      </View>

      {/* Android and desktop Chromium hand us a real prompt: one tap beats five. */}
      {promptable ? (
        <PrimaryButton title="Add to home screen" onPress={install} loading={installing} />
      ) : (
        <PrimaryButton title="I have added it" onPress={onDone} />
      )}

      {onSkip && (
        <Pressable onPress={onSkip} hitSlop={8} style={styles.later}>
          <Text style={styles.laterText}>Maybe later</Text>
        </Pressable>
      )}

      <Text style={styles.foot}>
        Open Ours from your home screen afterwards and carry on right where you left off. We do this first so you
        never have to do it twice.
      </Text>
    </View>
  );
}

const COPY: Record<InstallTarget, { title: string; line: string; steps: string[] }> = {
  // Same instructions for every iOS browser: since iOS 16.4 they all install
  // from the share sheet. Only the share button's position differs, which the
  // arrow on the phone handles.
  'ios-safari': {
    title: 'Keep Ours on your home screen',
    line: 'It opens like a real app, and it is the only way an iPhone will let the two of you get notifications.',
    steps: [
      'Tap the share button at the bottom of the screen.',
      'Scroll down the list and choose Add to Home Screen.',
      'Tap Add, then open Ours from your home screen.',
    ],
  },
  'ios-other': {
    title: 'Keep Ours on your home screen',
    line: 'It opens like a real app, and it is the only way an iPhone will let the two of you get notifications.',
    steps: [
      'Tap the share button at the top of the screen.',
      'Scroll down the list and choose Add to Home Screen.',
      'Tap Add, then open Ours from your home screen.',
    ],
  },
  android: {
    title: 'Keep Ours on your home screen',
    line: 'It opens like a real app, full screen, a tap away from everything else you use.',
    steps: [
      'Tap the three dots at the top right.',
      'Choose Install app, or Add to Home screen.',
      'Confirm, then open Ours from your home screen.',
    ],
  },
  desktop: {
    title: 'Keep Ours on your home screen',
    line: 'Ours is happiest on a phone, where it can reach the two of you.',
    steps: ['Open Ours on your phone to add it there.'],
  },
  installed: {
    title: 'You are all set',
    line: 'Ours is already on your home screen.',
    steps: [],
  },
};

/**
 * The little phone, with the button you want circled and an arrow at it.
 * iOS puts the share button in the bottom bar; Android and the iOS browser
 * shells put their menu at the top right.
 */
function PhoneMock({ target }: { target: InstallTarget }) {
  const pointsDown = target === 'ios-safari'; // Safari keeps share in the bottom bar
  const Glyph = target === 'android' ? MoreVertical : Share;
  const label = target === 'android' ? 'Menu' : 'Share';

  const ring = (
    <View style={styles.ring}>
      <Glyph size={18} color={colors.surfaceSealed} strokeWidth={2} />
    </View>
  );

  return (
    <View style={styles.mockWrap}>
      <View style={styles.phone}>
        <View style={styles.notch} />

        {/* Top bar: where Android and the iOS shells keep their menu. */}
        <View style={styles.topBar}>
          <View style={styles.urlPill} />
          {!pointsDown && ring}
        </View>

        <View style={styles.phoneScreen}>
          <Text style={styles.mockWordmark}>Ours</Text>
          <Text style={styles.mockHeart}>♥</Text>
        </View>

        {/* Bottom bar: where Safari keeps the share button. */}
        <View style={styles.bottomBar}>
          {pointsDown ? (
            <>
              <View style={styles.barDot} />
              <View style={styles.barDot} />
              {ring}
              <View style={styles.barDot} />
              <View style={styles.barDot} />
            </>
          ) : (
            <>
              <View style={styles.barDot} />
              <View style={styles.barDot} />
              <View style={styles.barDot} />
            </>
          )}
        </View>
      </View>

      {/* The pointer: a dashed lead into an arrowhead, aimed at the ring. */}
      <View style={[styles.pointer, pointsDown ? styles.pointerBottom : styles.pointerTop]}>
        <Text style={styles.pointerLabel}>{label}</Text>
        <Text style={styles.pointerArrow}>{pointsDown ? '↓' : '↑'}</Text>
      </View>
    </View>
  );
}

const PHONE_WIDTH = 190;

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  title: {
    ...text.display,
    fontFamily: font.displayMedium,
    marginBottom: sp.sm,
  },
  line: {
    ...text.bodySerif,
    color: colors.inkMuted,
    marginBottom: sp.xl,
  },
  mockWrap: {
    alignItems: 'center',
    marginBottom: sp.xl,
  },
  phone: {
    width: PHONE_WIDTH,
    aspectRatio: 0.52,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.surfaceRaised,
    paddingVertical: sp.sm,
    paddingHorizontal: sp.sm,
    justifyContent: 'space-between',
  },
  notch: {
    width: 54,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.hairline,
    alignSelf: 'center',
    marginBottom: sp.xs,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: sp.sm,
    paddingBottom: sp.sm,
  },
  urlPill: {
    flex: 1,
    height: 16,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  phoneScreen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: sp.xs,
  },
  mockWordmark: {
    ...text.subtitle,
    fontFamily: font.displayMedium,
    color: colors.surfaceSealed,
  },
  mockHeart: { color: colors.accent, fontSize: 12 },
  bottomBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingTop: sp.sm,
    borderTopWidth: 1,
    borderTopColor: colors.hairline,
  },
  barDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.hairline,
  },
  // The gold ring is the whole point: it is the thing to tap.
  ring: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 2,
    borderColor: colors.accent,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pointer: {
    position: 'absolute',
    alignItems: 'center',
    gap: 2,
  },
  // Safari's share button sits at the bottom, so the arrow comes from below.
  pointerBottom: { bottom: -6, left: PHONE_WIDTH / 2 + 34 },
  // Android and the iOS shells keep their menu at the top right.
  pointerTop: { top: 4, left: PHONE_WIDTH / 2 + 52 },
  pointerLabel: {
    ...text.caption,
    color: colors.accent,
    fontStyle: 'italic',
    fontFamily: font.serif,
  },
  pointerArrow: {
    color: colors.accent,
    fontSize: 20,
    lineHeight: 22,
  },
  steps: { marginBottom: sp.xl, gap: sp.md },
  stepRow: { flexDirection: 'row', gap: sp.md, alignItems: 'flex-start' },
  stepNum: {
    ...text.caption,
    fontFamily: font.displayMedium,
    color: colors.accent,
    width: 16,
    textAlign: 'center',
  },
  stepText: { ...text.body, flex: 1 },
  later: { alignSelf: 'center', marginTop: sp.base, paddingVertical: sp.xs },
  laterText: { ...text.caption, color: colors.inkFaint },
  foot: {
    ...text.caption,
    color: colors.inkFaint,
    textAlign: 'center',
    marginTop: sp.base,
  },
});
