import { Platform } from 'react-native';
import { api } from './api';
import { logClientError, logEvent } from './log';

/**
 * Web Push (browser / installed PWA) client. Native builds use expo-notifications
 * instead and never call into here; every export is a no-op off web. The service
 * worker at /sw.js does the actual notification display and tap handling.
 */

const SW_URL = '/sw.js';

/** Whether this browser can do Web Push at all (Safari 16.4+, Chrome, etc.). */
export function webPushSupported(): boolean {
  return (
    Platform.OS === 'web' &&
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator &&
    typeof window !== 'undefined' &&
    'PushManager' in window &&
    'Notification' in window
  );
}

/** Convert the base64url VAPID public key into the Uint8Array subscribe() wants. */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output;
}

/**
 * Register the service worker on web. Called once on app mount. If the browser
 * is already subscribed, re-POST the subscription so the server stays in sync;
 * never prompts for permission here.
 */
export async function registerServiceWorker(): Promise<void> {
  if (Platform.OS !== 'web') return;
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    logEvent('push.sw_unavailable', { supported: false });
    return;
  }
  try {
    const reg = await navigator.serviceWorker.register(SW_URL);
    const existing = await reg.pushManager.getSubscription().catch(() => null);
    // The single most useful line when notifications "don't come": it says
    // whether this device is subscribed at all and what permission it holds.
    logEvent('push.sw_registered', {
      permission: typeof Notification !== 'undefined' ? Notification.permission : 'unavailable',
      subscribed: !!existing,
      endpoint_host: existing ? hostOf(existing.endpoint) : undefined,
    });
    if (existing) {
      // Re-POST so the server's copy cannot drift from the browser's.
      await api('/api/push/subscribe', {
        method: 'POST',
        body: { subscription: existing.toJSON() },
      }).catch(() => {});
    }
  } catch (err) {
    // Service workers are unavailable (private mode, unsupported browser). Fine.
    logClientError('push.sw_register_failed', { message: messageOf(err) });
  }
}

function hostOf(endpoint: string): string | undefined {
  try {
    return new URL(endpoint).host;
  } catch {
    return undefined;
  }
}

function messageOf(err: unknown): string {
  return String((err as Error)?.message ?? err ?? 'unknown').slice(0, 200);
}

/** True if a Web Push subscription is currently active. */
export async function isWebPushSubscribed(): Promise<boolean> {
  if (!webPushSupported()) return false;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    return !!sub;
  } catch {
    return false;
  }
}

/**
 * Prompt for permission and subscribe. Only call from an explicit user action
 * (the Settings toggle). Returns true when a subscription is active on the
 * server. Throws with a friendly message if permission is denied.
 */
export async function enableWebPush(): Promise<boolean> {
  if (!webPushSupported()) {
    logClientError('push.enable_failed', { step: 'unsupported' });
    throw new Error('This browser cannot show notifications. Try adding Ours to your home screen first.');
  }
  const reg =
    (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.register(SW_URL));
  await navigator.serviceWorker.ready;

  const permission = await Notification.requestPermission();
  logEvent('push.permission_requested', { permission });
  if (permission !== 'granted') {
    throw new Error('Notifications are blocked. Turn them on for this site in your browser settings.');
  }

  const { key } = await api<{ key: string | null }>('/api/push/vapid-public-key');
  if (!key) {
    logClientError('push.enable_failed', { step: 'no-server-key' });
    throw new Error('Notifications are not set up on the server yet.');
  }

  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    try {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(key),
      });
    } catch (err) {
      // Usually a VAPID key mismatch with an older subscription, or a browser
      // that granted permission but refuses the push service.
      logClientError('push.subscribe_failed', { message: messageOf(err) });
      throw err;
    }
  }
  await api('/api/push/subscribe', { method: 'POST', body: { subscription: sub.toJSON() } });
  logEvent('push.enabled', { endpoint_host: hostOf(sub.endpoint) });
  return true;
}

/** Unsubscribe and clear the token server-side so pushes stop. */
export async function disableWebPush(): Promise<void> {
  if (Platform.OS !== 'web') return;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    if (sub) await sub.unsubscribe().catch(() => {});
  } catch {
    // ignore
  }
  await api('/api/auth/profile', { method: 'PATCH', body: { pushToken: null } }).catch(() => {});
  logEvent('push.disabled');
}
