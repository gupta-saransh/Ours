import { Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * Bottom safe-area inset that actually works in an iOS home-screen PWA.
 *
 * react-native-safe-area-context's web provider measures env() through a
 * transition listener that has proven unreliable in iOS standalone mode
 * (insets stay 0, so the tab bar sat under the home indicator). This helper
 * measures env(safe-area-inset-bottom) directly with a throwaway fixed
 * element, and falls back to 34px on home-indicator iPhones running
 * standalone if env() itself reports 0. Native platforms just use the
 * context value, which is solid there.
 */

let measured: number | null = null;

function webSafeBottom(): number {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return 0;
  if (measured !== null) return measured;

  const el = document.createElement('div');
  el.style.cssText =
    'position:fixed;left:0;bottom:0;width:1px;height:env(safe-area-inset-bottom);' +
    'visibility:hidden;pointer-events:none;';
  document.body.appendChild(el);
  let px = el.getBoundingClientRect().height;
  document.body.removeChild(el);

  if (px === 0) {
    // env() came back empty. On a home-indicator iPhone in standalone mode
    // that is a known WebKit lapse; those devices all have a screen aspect
    // ratio >= 2, older home-button models are ~1.78, so the check cannot
    // over-pad an SE or an 8.
    const nav = navigator as Navigator & { standalone?: boolean };
    const iOS = /iPhone|iPod/.test(navigator.userAgent);
    const standalone = nav.standalone === true || window.matchMedia?.('(display-mode: standalone)')?.matches;
    const ratio = screen.height > screen.width ? screen.height / screen.width : screen.width / screen.height;
    if (iOS && standalone && ratio >= 2) px = 34;
  }

  measured = px;
  return px;
}

/** The bottom inset in px: max of the safe-area context and a direct CSS measurement. */
export function useSafeBottom(): number {
  let fromContext = 0;
  try {
    // eslint-disable-next-line react-hooks/rules-of-hooks -- called unconditionally
    fromContext = useSafeAreaInsets().bottom;
  } catch {
    // no SafeAreaProvider above us (e.g. the root toast overlay); the web
    // measurement below still applies, native callers always have one.
  }
  return Math.max(fromContext, webSafeBottom());
}
