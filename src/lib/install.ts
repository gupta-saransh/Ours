import { Platform } from 'react-native';

/**
 * Adding Ours to the home screen.
 *
 * This matters beyond convenience: on iPhone, Web Push only works for an app
 * installed to the home screen FROM SAFARI. A browser tab can never subscribe,
 * no matter what it is told, so the honest move is to show people the way there.
 *
 * Android and desktop Chrome give us a real API (`beforeinstallprompt`), so
 * there we can offer one tap instead of instructions. iOS gives us nothing, so
 * there we illustrate where the button lives.
 */

export type InstallTarget =
  /** Already on the home screen. Nothing to do. */
  | 'installed'
  /** iPhone or iPad in Safari: can install, needs the share sheet. */
  | 'ios-safari'
  /** iPhone or iPad in Chrome, Edge, Firefox: must switch to Safari first. */
  | 'ios-other'
  /** Android browser: usually a real install prompt, otherwise the menu. */
  | 'android'
  /** A computer. Installing is possible but this flow is written for phones. */
  | 'desktop';

export function isStandalone(): boolean {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return false;
  return (
    (window.navigator as { standalone?: boolean }).standalone === true ||
    window.matchMedia?.('(display-mode: standalone)')?.matches === true
  );
}

export function installTarget(): InstallTarget {
  if (Platform.OS !== 'web' || typeof navigator === 'undefined') return 'installed';
  if (isStandalone()) return 'installed';

  const ua = navigator.userAgent;
  const isIOS =
    /iPad|iPhone|iPod/.test(ua) ||
    // iPadOS 13+ pretends to be a Mac; the touch points give it away.
    (navigator.platform === 'MacIntel' && ((navigator as { maxTouchPoints?: number }).maxTouchPoints ?? 0) > 1);

  if (isIOS) {
    // Since iOS 16.4 EVERY iOS browser can install to the home screen from the
    // share sheet (Safari, Chrome, Edge, Firefox, Orion), and the installed app
    // is the same WebKit home-screen app with push either way. So this split is
    // only about WHERE the share button sits: Safari keeps it in the bottom
    // toolbar, the others put it at the top. Nobody is sent to Safari.
    const isRealSafari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
    return isRealSafari ? 'ios-safari' : 'ios-other';
  }
  if (/Android/.test(ua)) return 'android';
  return 'desktop';
}

// ---------------------------------------------------------------------------
// The real install prompt (Chromium only).

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

let deferred: InstallPromptEvent | null = null;
const listeners = new Set<(available: boolean) => void>();

function announce(available: boolean) {
  for (const cb of listeners) cb(available);
}

/**
 * Start listening for the browser's install offer. Must run early (the event
 * fires soon after load and only once), so the root layout calls it on mount.
 */
export function captureInstallPrompt(): void {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return;
  window.addEventListener('beforeinstallprompt', (e) => {
    // Keep it for later instead of letting the browser show its own mini-bar.
    e.preventDefault();
    deferred = e as InstallPromptEvent;
    announce(true);
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    announce(false);
  });
}

export function canPromptInstall(): boolean {
  return deferred !== null;
}

/** Subscribe to availability; returns an unsubscribe. */
export function onInstallAvailable(cb: (available: boolean) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Show the browser's real install dialog. True if they accepted. */
export async function promptInstall(): Promise<boolean> {
  if (!deferred) return false;
  const event = deferred;
  deferred = null;
  announce(false);
  try {
    await event.prompt();
    const { outcome } = await event.userChoice;
    return outcome === 'accepted';
  } catch {
    return false;
  }
}

/**
 * Should the onboarding install step appear?
 *
 * On every phone that is not installed yet, iOS and Android alike. It is the
 * FIRST thing asked after signing up, deliberately: on iOS the home-screen app
 * has its own storage jar, so installing later means signing in again, and
 * doing that at the end would throw away a journey they had just finished.
 * Asking first costs one sign-in and nothing else.
 *
 * Android does not strictly need it (push works in a tab there) but the flow
 * stays the same on both platforms, and Android usually gets a real one-tap
 * install button instead of instructions.
 *
 * Desktop is excluded: this flow is written for a phone.
 */
export function shouldOfferInstall(): boolean {
  const target = installTarget();
  return target === 'ios-safari' || target === 'ios-other' || target === 'android';
}
