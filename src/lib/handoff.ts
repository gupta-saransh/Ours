import { Platform } from 'react-native';

/**
 * Carrying the session across the "add to home screen" boundary.
 *
 * THE PROBLEM (Apple's, not ours): on iOS the home-screen app gets a completely
 * separate storage jar from the browser. Cookies, localStorage and even the
 * service worker instance are not shared, so someone who installs Ours lands in
 * the installed app signed out, having just signed up seconds earlier in the
 * browser. There is no supported API that fixes this.
 *
 * THE ONE THING THAT DOES CROSS: Cache Storage is reportedly shared between the
 * two contexts on iOS. So just before someone installs, we leave the session
 * token there like a key under the mat, and the installed app picks it up on
 * its first launch.
 *
 * This is a documented trick rather than a guaranteed API, so it is written to
 * be worthless if it fails: every call is wrapped, and the fallback is simply
 * the sign-in screen (where the password manager will autofill). Treated as a
 * HAND-OFF, not as storage:
 *   - it expires in 15 minutes,
 *   - it is deleted the moment it is read (single use),
 *   - it is cleared on sign-out.
 * The token is the same one already sitting in localStorage on web, so this
 * adds no new class of exposure: both are readable by any script on the origin.
 */

const CACHE_NAME = 'ours-handoff';
// Any same-origin URL works as a cache key; this one is never fetched.
const KEY = '/__ours_session_handoff';
const TTL_MS = 15 * 60 * 1000;

function available(): boolean {
  return Platform.OS === 'web' && typeof caches !== 'undefined';
}

/** Leave the session where the installed app can find it. */
export async function stashSession(token: string): Promise<void> {
  if (!available() || !token) return;
  try {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(
      KEY,
      new Response(JSON.stringify({ token, exp: Date.now() + TTL_MS }), {
        headers: { 'Content-Type': 'application/json' },
      })
    );
  } catch {
    // No cache storage, private mode, quota. The sign-in screen still works.
  }
}

/**
 * Take the session left behind, if there is one and it is still fresh. Deletes
 * it either way, so it can never be picked up twice.
 */
export async function claimSession(): Promise<string | null> {
  if (!available()) return null;
  try {
    const cache = await caches.open(CACHE_NAME);
    const hit = await cache.match(KEY);
    if (!hit) return null;
    await cache.delete(KEY);
    const { token, exp } = (await hit.json()) as { token?: string; exp?: number };
    if (!token || !exp || Date.now() > exp) return null;
    return token;
  } catch {
    return null;
  }
}

/** Signing out must not leave a key under the mat. */
export async function clearStashedSession(): Promise<void> {
  if (!available()) return;
  try {
    await caches.delete(CACHE_NAME);
  } catch {
    // nothing to clear
  }
}
